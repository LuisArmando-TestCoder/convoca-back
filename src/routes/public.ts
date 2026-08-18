// ── Public self-registration routes (no auth) ────────────────────────────────
// A shareable link lets people register themselves into one event. We expose
// ONLY safe event display fields — never org credentials or participant lists.

import { Hono } from "hono";
import { fail, requireEmail, requireString } from "../lib/validate.ts";
import { getLink } from "../db/links.ts";
import { getEvent } from "../db/events.ts";
import { getOrg } from "../db/orgs.ts";
import { listParticipants } from "../db/participants.ts";
import { registerParticipant } from "../services/registerParticipant.ts";
import type { EventDoc, EventField, Organization, SelfRegLink } from "../types.ts";

const publicRouter = new Hono();

/** Resolves an active link → its org + event, or throws a public-safe error. */
async function resolveLink(
  linkId: string,
): Promise<{ link: SelfRegLink; org: Organization; event: EventDoc }> {
  const link = await getLink(linkId);
  if (!link || !link.active) fail(404, "This registration link is not available.");
  if (link!.expiresAt && new Date(link!.expiresAt).getTime() < Date.now()) {
    fail(410, "This registration link has expired.");
  }
  const event = await getEvent(link!.orgId, link!.eventId);
  if (!event) fail(404, "This event no longer exists.");
  const org = await getOrg(link!.orgId);
  if (!org) fail(404, "This event no longer exists.");
  return { link: link!, org: org!, event: event! };
}

/** Collect + validate the field values a registrant submitted against a schema. */
function pickFields(fields: EventField[], raw: unknown): Record<string, string> {
  const src = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
  const out: Record<string, string> = {};
  for (const f of fields ?? []) {
    const v = typeof src[f.key] === "string" ? (src[f.key] as string).trim().slice(0, 300) : "";
    if (v) out[f.key] = v;
    else if (f.required) fail(400, `${f.label} is required.`);
  }
  return out;
}

// GET /register/:linkId — public event info for the registration form.
// The form renders the LINK's own field schema (each link can carry its own
// options), falling back to the event's fields for legacy links.
publicRouter.get("/register/:linkId", async (c) => {
  const { org, event, link } = await resolveLink(c.req.param("linkId"));
  return c.json({
    orgName: org.name,
    linkName: link.name,
    application: link.application,
    event: {
      name: event.name,
      description: event.description,
      date: event.date,
      location: event.location,
      mode: event.mode,
      fields: (link.fields && link.fields.length ? link.fields : (event.fields ?? [])),
    },
  });
});

// POST /register/:linkId — a person registers themselves. For application-type
// links the registration is held for review (no QR is emailed); otherwise they
// get a QR by email immediately.
publicRouter.post("/register/:linkId", async (c) => {
  const { org, event, link } = await resolveLink(c.req.param("linkId"));
  const body = await c.req.json().catch(() => ({}));

  if (event.quota != null) {
    const current = (await listParticipants(org.id, event.id)).length;
    if (current >= event.quota) fail(409, "Registration is full for this event.");
  }

  const fields = link.fields && link.fields.length ? link.fields : (event.fields ?? []);
  const outcome = await registerParticipant(org, event, {
    name: requireString(body.name, "name", 160),
    email: requireEmail(body.email),
    fields: pickFields(fields, body.fields),
    source: "self",
    createdBy: "self-registration",
    application: link.application,
  });

  return c.json({
    ok: true,
    alreadyRegistered: !outcome.created,
    emailed: outcome.emailed,
  });
});

export default publicRouter;