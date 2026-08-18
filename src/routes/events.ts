// ── Events routes (authenticated, org-scoped) ────────────────────────────────
// Everything an owner/collaborator does with their events lives here: event
// CRUD + clone, participant management (manual + CSV), the QR check-in scan,
// self-registration links, and real-time stats. All records are scoped to the
// session's org, so one tenant can never touch another's data.

import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../context.ts";
import { config } from "../config.ts";
import { requireAuth } from "../middleware/auth.ts";
import { fail, optionalString, randomId, requireEmail, requireString } from "../lib/validate.ts";
import { parseCsv, type RawRow } from "../lib/csv.ts";
import { qrPngBuffer } from "../lib/qr.ts";
import { participantHash } from "../lib/hash.ts";
import { createEvent, deleteEvent, getEvent, listEvents, updateEvent } from "../db/events.ts";
import {
  checkIn,
  deleteParticipant,
  getParticipant,
  listParticipants,
  updateParticipant,
} from "../db/participants.ts";
import { createLink, deleteLink, getLink, listLinks, updateLink } from "../db/links.ts";
import { acceptApplication, registerParticipant, resendQr } from "../services/registerParticipant.ts";
import { sendEmail } from "../lib/email.ts";
import { failureReportEmail, type FailureRow } from "../lib/emailTemplates.ts";
import { listCollaborators } from "../db/orgs.ts";
import { broadcast, roomKey } from "../socket/hub.ts";
import type { EventDoc, EventField, EventMode, Participant, SelfRegLink } from "../types.ts";

const events = new Hono<AppEnv>();
events.use("*", requireAuth);

const MODES: EventMode[] = ["in_person", "virtual", "hybrid"];

function parseMode(v: unknown): EventMode {
  return MODES.includes(v as EventMode) ? (v as EventMode) : "in_person";
}

function parseQuota(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) ||
  "field";

/** Parse the team-defined field schema off an event create/patch body. */
function parseEventFields(raw: unknown): EventField[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: EventField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const label = requireString(rec.label, "field label", 60);
    let key = typeof rec.key === "string" && rec.key ? slugify(rec.key) : slugify(label);
    while (seen.has(key)) key += "_";
    seen.add(key);
    out.push({ key, label, required: Boolean(rec.required) });
    if (out.length >= 20) break;
  }
  return out;
}

/** Validate + collect a participant's custom field values against an event's schema. */
function pickParticipantFields(ev: EventDoc, raw: unknown): Record<string, string> {
  const src = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
  const out: Record<string, string> = {};
  for (const f of ev.fields ?? []) {
    const v = typeof src[f.key] === "string" ? (src[f.key] as string).trim().slice(0, 300) : "";
    if (v) out[f.key] = v;
    else if (f.required) fail(400, `${f.label} is required.`);
  }
  return out;
}

/** Loads the :id event for the current org or throws 404. */
async function loadEvent(c: Context<AppEnv>): Promise<EventDoc> {
  const session = c.get("session");
  const orgId = session.orgId;
  const ev = await getEvent(orgId, c.req.param("id") ?? "");
  if (!ev) fail(404, "Event not found.");
  // Collaborators are scoped to the events they've been granted.
  if (session.role === "collaborator" && session.eventIds !== undefined) {
    if (!session.eventIds.includes(ev.id)) {
      fail(403, "You don't have access to this event.");
    }
  }
  return ev!;
}

// ── Event CRUD ───────────────────────────────────────────────────────────────

events.get("/", async (c) => {
  const session = c.get("session");
  const list = await listEvents(session.orgId);
  // Collaborators only see the events they've been granted.
  if (session.role === "collaborator" && session.eventIds !== undefined) {
    const allowed = new Set(session.eventIds);
    return c.json({ events: list.filter((ev) => allowed.has(ev.id)) });
  }
  return c.json({ events: list });
});

events.post("/", async (c) => {
  const orgId = c.get("session").orgId;
  const body = await c.req.json().catch(() => ({}));
  const ev: EventDoc = {
    id: randomId(8),
    orgId,
    name: requireString(body.name, "name", 160),
    description: optionalString(body.description, 4000),
    location: optionalString(body.location, 300),
    mode: parseMode(body.mode),
    date: optionalString(body.date, 40),
    quota: parseQuota(body.quota),
    fields: parseEventFields(body.fields),
    clonedFrom: null,
    createdAt: new Date().toISOString(),
  };
  await createEvent(ev);

  return c.json({ event: ev }, 201);
});

events.get("/:id", async (c) => c.json({ event: await loadEvent(c) }));

events.patch("/:id", async (c) => {
  const ev = await loadEvent(c);
  const body = await c.req.json().catch(() => ({}));
  const updated: EventDoc = {
    ...ev,
    name: body.name != null ? requireString(body.name, "name", 160) : ev.name,
    description: body.description != null ? optionalString(body.description, 4000) : ev.description,
    location: body.location != null ? optionalString(body.location, 300) : ev.location,
    mode: body.mode != null ? parseMode(body.mode) : ev.mode,
    date: body.date != null ? optionalString(body.date, 40) : ev.date,
    quota: body.quota !== undefined ? parseQuota(body.quota) : ev.quota,
    fields: body.fields !== undefined ? parseEventFields(body.fields) : (ev.fields ?? []),
  };
  await updateEvent(updated);

  return c.json({ event: updated });
});

events.delete("/:id", async (c) => {
  const ev = await loadEvent(c);
  await deleteEvent(ev.orgId, ev.id);
  return c.json({ ok: true });
});

events.post("/:id/clone", async (c) => {
  const src = await loadEvent(c);
  const body = await c.req.json().catch(() => ({}));
  const clone: EventDoc = {
    ...src,
    id: randomId(8),
    name: body.name ? requireString(body.name, "name", 160) : `${src.name} (copy)`,
    date: body.date != null ? optionalString(body.date, 40) : src.date,
    clonedFrom: src.id,
    createdAt: new Date().toISOString(),
  };
  await createEvent(clone);
  return c.json({ event: clone }, 201);
});

// ── Stats (real-time) ─────────────────────────────────────────────────────────

events.get("/:id/stats", async (c) => {
  const ev = await loadEvent(c);
  const list = await listParticipants(ev.orgId, ev.id);
  const registered = list.filter((p) => p.registered);
  // "By country" is a best-effort breakdown: prefer a `country` custom field,
  // fall back to the legacy built-in column on pre-existing participants.
  const byCountry: Record<string, number> = {};
  const bySource: Record<string, number> = { manual: 0, csv: 0, self: 0 };
  for (const p of list) {
    const country = (p.fields?.country ?? p.country ?? "").trim();
    if (country) byCountry[country] = (byCountry[country] ?? 0) + 1;
    bySource[p.source] = (bySource[p.source] ?? 0) + 1;
  }

  return c.json({
    total: list.length,
    checkedIn: registered.length,
    pending: list.length - registered.length,
    rate: list.length ? Math.round((registered.length / list.length) * 100) : 0,
    quota: ev.quota,
    byCountry,
    bySource,
  });
});

// ── Participants ───────────────────────────────────────────────────────────────

events.get("/:id/participants", async (c) => {
  const ev = await loadEvent(c);
  return c.json({ participants: await listParticipants(ev.orgId, ev.id) });
});

/** Enforces the event quota; throws 409 if adding `incoming` would exceed it. */
async function assertQuota(ev: EventDoc, incoming: number): Promise<void> {
  if (ev.quota == null) return;
  const current = (await listParticipants(ev.orgId, ev.id)).length;
  if (current + incoming > ev.quota) {
    fail(409, `Quota reached: ${current}/${ev.quota} spots used.`);
  }
}

events.post("/:id/participants", async (c) => {
  const ev = await loadEvent(c);
  const org = c.get("org");
  const createdBy = c.get("session").email;
  const body = await c.req.json().catch(() => ({}));

  await assertQuota(ev, 1);
  const outcome = await registerParticipant(org, ev, {
    name: requireString(body.name, "name", 160),
    email: requireEmail(body.email),
    fields: pickParticipantFields(ev, body.fields),
    source: "manual",
    createdBy,
  });
  return c.json(outcome, outcome.created ? 201 : 200);
});

events.post("/:id/participants/csv", async (c) => {
  const ev = await loadEvent(c);
  const org = c.get("org");
  const createdBy = c.get("session").email;
  const body = await c.req.json().catch(() => ({}));

  // Accept either pre-parsed rows or raw CSV text.
  let rows: RawRow[] = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0 && typeof body.csv === "string") rows = parseCsv(body.csv);
  if (rows.length === 0) fail(400, "No rows to import.");
  if (rows.length > 2000) fail(400, "Too many rows (max 2000 per upload).");

  await assertQuota(ev, rows.length);

  const results = { created: 0, skipped: 0, emailed: 0, errors: [] as string[] };
  for (const [i, row] of rows.entries()) {
    const name = String(row.name ?? "").trim();
    const email = String(row.email ?? "").trim().toLowerCase();
    if (!name || !email) {
      results.errors.push(`Row ${i + 1}: name and email are required.`);
      continue;
    }
    try {
      // Custom field values arrive keyed by field.key (mapped client-side).
      // Imported participants are created PENDING (no email); a collaborator
      // sends each QR manually from the dashboard when ready.
      const out = await registerParticipant(org, ev, {
        name,
        email,
        fields: pickParticipantFields(ev, row),
        source: "csv",
        createdBy,
      }, { sendInvite: false });
      if (out.created) results.created++;
      else results.skipped++;
      if (out.emailed) results.emailed++;
    } catch (err) {
      results.errors.push(`Row ${i + 1}: ${(err as Error).message}`);
    }
  }
  return c.json(results);
});

// Bulk action over selected participants (or the whole list with `all: true`).
// Reuses the same per-participant primitives so behavior can't drift.
events.post("/:id/participants/bulk", async (c) => {
  const ev = await loadEvent(c);
  const org = c.get("org");
  const body = await c.req.json().catch(() => ({}));
  const action = body.action;
  if (action !== "resend" && action !== "delete") fail(400, "Unknown bulk action.");

  let hashes: string[] = Array.isArray(body.hashes) ? body.hashes.map(String) : [];
  if (body.all === true) hashes = (await listParticipants(ev.orgId, ev.id)).map((p) => p.hash);
  if (hashes.length === 0) fail(400, "No participants selected.");
  if (hashes.length > 2000) fail(400, "Too many participants (max 2000 per action).");

  const results = { ok: 0, failed: 0, errors: [] as string[] };
  for (const hash of hashes) {
    try {
      const p = await getParticipant(ev.orgId, ev.id, hash);
      if (!p) {
        results.failed++;
        continue;
      }
      if (action === "resend") await resendQr(org, ev, p);
      else await deleteParticipant(ev.orgId, ev.id, hash);
      results.ok++;
    } catch (err) {
      results.failed++;
      if (results.errors.length < 10) results.errors.push((err as Error).message);
    }
  }
  return c.json(results);
});

// Sequential QR send with LIVE progress. Sends one email at a time (throttled by
// config.sendDelayMs to dodge Gmail's burst limits), broadcasting each step to
// every teammate watching this event over the WebSocket room. Any failures are
// aggregated into a single report emailed to the owner + collaborators.
events.post("/:id/participants/send", async (c) => {
  const ev = await loadEvent(c);
  const org = c.get("org");
  const body = await c.req.json().catch(() => ({}));

  let hashes: string[] = Array.isArray(body.hashes) ? body.hashes.map(String) : [];
  if (body.all === true) hashes = (await listParticipants(ev.orgId, ev.id)).map((p) => p.hash);
  if (hashes.length === 0) fail(400, "No participants selected.");
  if (hashes.length > 2000) fail(400, "Too many participants (max 2000 per send).");

  const room = roomKey(ev.orgId, ev.id);
  const total = hashes.length;
  const by = c.get("session").email;
  broadcast(room, { t: "start", total, by });

  const failures: FailureRow[] = [];
  let sent = 0;

  for (let i = 0; i < hashes.length; i++) {
    const hash = hashes[i];
    const p = await getParticipant(ev.orgId, ev.id, hash);
    if (!p) {
      failures.push({
        name: "(unknown)",
        email: hash.slice(0, 16),
        reason: "Participant not found",
        source: "-",
        extra: [],
      });
      broadcast(room, {
        t: "item",
        i,
        total,
        hash,
        name: "(unknown)",
        email: "",
        status: "failed",
        reason: "Participant not found",
      });
      continue;
    }
    broadcast(room, { t: "item", i, total, hash, name: p.name, email: p.email, status: "sending" });
    try {
      await resendQr(org, ev, p);
      sent++;
      broadcast(room, { t: "item", i, total, hash, name: p.name, email: p.email, status: "sent" });
    } catch (err) {
      const reason = (err as Error).message || "Send failed";
      failures.push({
        name: p.name,
        email: p.email,
        reason,
        source: p.source,
        extra: (ev.fields ?? []).map((f) => ({ label: f.label, value: p.fields?.[f.key] ?? "" })),
      });
      broadcast(room, {
        t: "item",
        i,
        total,
        hash,
        name: p.name,
        email: p.email,
        status: "failed",
        reason,
      });
    }
    // Throttle between sends (not after the last one).
    if (i < hashes.length - 1 && config.sendDelayMs > 0) {
      await new Promise((r) => setTimeout(r, config.sendDelayMs));
    }
  }

  // Aggregate any failures into one report emailed to the whole team.
  let reportedTo: string | null = null;
  if (failures.length > 0) {
    try {
      const collabs = await listCollaborators(ev.orgId);
      const recipients = Array.from(
        new Set([org.email, ...collabs.map((cb) => cb.email)].filter(Boolean)),
      );
      const tpl = failureReportEmail(org.name, ev.name, sent, failures);
      await sendEmail({
        org,
        to: recipients.join(", "),
        replyTo: org.email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
      reportedTo = recipients.join(", ");
    } catch (err) {
      console.error("[send] failure report email failed:", err);
    }
  }

  broadcast(room, { t: "done", total, sent, failed: failures.length, reportedTo });
  return c.json({ total, sent, failed: failures.length, reportedTo });
});

events.delete("/:id/participants/:hash", async (c) => {
  const ev = await loadEvent(c);
  await deleteParticipant(ev.orgId, ev.id, c.req.param("hash"));
  return c.json({ ok: true });
});

events.post("/:id/participants/:hash/resend", async (c) => {
  const ev = await loadEvent(c);
  const p = await getParticipant(ev.orgId, ev.id, c.req.param("hash"));
  if (!p) fail(404, "Participant not found.");
  await resendQr(c.get("org"), ev, p!);
  return c.json({ ok: true });
});

// ── Application review ─────────────────────────────────────────────────────────
// Participants who entered via an application-type link are held for review.
// Accepting emails the QR (the participant becomes a normal attendee); rejecting
// marks them rejected; hiding moves them to the hidden tab to declutter the list.

events.post("/:id/participants/:hash/accept", async (c) => {
  const ev = await loadEvent(c);
  const p = await getParticipant(ev.orgId, ev.id, c.req.param("hash"));
  if (!p) fail(404, "Participant not found.");
  if (!p!.application) fail(400, "This participant did not apply through an application link.");
  const updated = await acceptApplication(c.get("org"), ev, p!);
  return c.json({ participant: updated });
});

events.post("/:id/participants/:hash/reject", async (c) => {
  const ev = await loadEvent(c);
  const p = await getParticipant(ev.orgId, ev.id, c.req.param("hash"));
  if (!p) fail(404, "Participant not found.");
  if (!p!.application) fail(400, "This participant did not apply through an application link.");
  const updated: Participant = { ...p!, applicationStatus: "rejected" };
  await updateParticipant(updated);
  return c.json({ participant: updated });
});

events.post("/:id/participants/:hash/hide", async (c) => {
  const ev = await loadEvent(c);
  const p = await getParticipant(ev.orgId, ev.id, c.req.param("hash"));
  if (!p) fail(404, "Participant not found.");
  const updated: Participant = { ...p!, hidden: true };
  await updateParticipant(updated);
  return c.json({ participant: updated });
});

events.post("/:id/participants/:hash/unhide", async (c) => {
  const ev = await loadEvent(c);
  const p = await getParticipant(ev.orgId, ev.id, c.req.param("hash"));
  if (!p) fail(404, "Participant not found.");
  const updated: Participant = { ...p!, hidden: false };
  await updateParticipant(updated);
  return c.json({ participant: updated });
});

// Edit a participant. Identity = name + email, so only those affect the QR/doc
// id. Editing custom fields is a metadata update (QR unchanged). When name or
// email changes we write the new doc and remove the old one, carrying state.
events.patch("/:id/participants/:hash", async (c) => {
  const ev = await loadEvent(c);
  const oldHash = c.req.param("hash");
  const existing = await getParticipant(ev.orgId, ev.id, oldHash);
  if (!existing) fail(404, "Participant not found.");
  const body = await c.req.json().catch(() => ({}));

  const identity = {
    name: (body.name != null ? requireString(body.name, "name", 160) : existing!.name).trim(),
    email: (body.email != null ? requireEmail(body.email) : existing!.email).trim().toLowerCase(),
  };
  const newHash = await participantHash(identity);

  if (newHash !== oldHash && (await getParticipant(ev.orgId, ev.id, newHash))) {
    fail(409, "Another participant already has that name + email.");
  }

  const fields = body.fields !== undefined
    ? pickParticipantFields(ev, body.fields)
    : (existing!.fields ?? {});

  const updated: Participant = {
    ...existing!,
    ...identity,
    fields,
    hash: newHash,
    qrSentAt: newHash !== oldHash ? null : existing!.qrSentAt,
  };
  await updateParticipant(updated);
  if (newHash !== oldHash) await deleteParticipant(ev.orgId, ev.id, oldHash);

  return c.json({ participant: updated });
});

events.get("/:id/participants/:hash/qr.png", async (c) => {
  const ev = await loadEvent(c);
  const p = await getParticipant(ev.orgId, ev.id, c.req.param("hash"));
  if (!p) fail(404, "Participant not found.");
  const png = await qrPngBuffer(p!.hash);
  // Copy into a fresh ArrayBuffer-backed view so it satisfies BodyInit.
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `inline; filename="qr-${p!.hash.slice(0, 12)}.png"`,
    },
  });
});

// ── Check-in scan ──────────────────────────────────────────────────────────────

events.post("/:id/checkin", async (c) => {
  const ev = await loadEvent(c);
  const body = await c.req.json().catch(() => ({}));
  const hash = requireString(body.hash, "hash", 128).toLowerCase().trim();
  const result = await checkIn(ev.orgId, ev.id, hash);
  const status = result.outcome === "success" ? 200 : result.outcome === "duplicate" ? 409 : 404;
  return c.json(result, status);
});

// ── Self-registration links ──────────────────────────────────────────────────

function linkUrl(linkId: string): string {
  return `${config.appBaseUrl}/register/${linkId}`;
}

events.get("/:id/links", async (c) => {
  const ev = await loadEvent(c);
  const links = await listLinks(ev.orgId, ev.id);
  return c.json({ links: links.map((l) => ({ ...l, url: linkUrl(l.id) })) });
});

events.post("/:id/links", async (c) => {
  const ev = await loadEvent(c);
  const body = await c.req.json().catch(() => ({}));
  const link: SelfRegLink = {
    id: randomId(10),
    orgId: ev.orgId,
    eventId: ev.id,
    name: body.name != null ? requireString(body.name, "name", 120) : "",
    fields: body.fields !== undefined ? parseEventFields(body.fields) : (ev.fields ?? []),
    active: true,
    application: Boolean(body.application),
    createdBy: c.get("session").email,
    createdAt: new Date().toISOString(),
    expiresAt: null,
  };
  await createLink(link);
  return c.json({ link: { ...link, url: linkUrl(link.id) } }, 201);
});

events.patch("/:id/links/:linkId", async (c) => {
  const ev = await loadEvent(c);
  const link = await getLink(c.req.param("linkId"));
  if (!link || link.orgId !== ev.orgId || link.eventId !== ev.id) fail(404, "Link not found.");
  const body = await c.req.json().catch(() => ({}));

  const updated: SelfRegLink = {
    ...link!,
    active: body.active !== undefined ? Boolean(body.active) : link!.active,
    name: body.name !== undefined ? requireString(body.name, "name", 120) : link!.name,
    fields: body.fields !== undefined ? parseEventFields(body.fields) : (link!.fields ?? []),
    application: body.application !== undefined ? Boolean(body.application) : link!.application,
  };
  await updateLink(updated);
  return c.json({ link: { ...updated, url: linkUrl(updated.id) } });
});

events.delete("/:id/links/:linkId", async (c) => {
  const ev = await loadEvent(c);
  const link = await getLink(c.req.param("linkId"));
  if (!link || link.orgId !== ev.orgId || link.eventId !== ev.id) fail(404, "Link not found.");
  await deleteLink(link.id);
  return c.json({ ok: true });
});

export default events;
