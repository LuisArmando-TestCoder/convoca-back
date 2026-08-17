// ── Collaborators routes (owner-only) ────────────────────────────────────────
// The owner invites teammates by email. Invited collaborators can then sign in
// (passwordless OTP) and manage participants / scan check-ins for the org.

import { Hono } from "hono";
import type { AppEnv } from "../context.ts";
import { config } from "../config.ts";
import { requireAuth, requireOwner } from "../middleware/auth.ts";
import { fail, optionalString, requireEmail } from "../lib/validate.ts";
import { sendEmail } from "../lib/email.ts";
import { addCollaborator, listCollaborators, removeCollaborator, updateCollaborator } from "../db/orgs.ts";
import { listEvents } from "../db/events.ts";
import type { Collaborator } from "../types.ts";

const collaborators = new Hono<AppEnv>();
collaborators.use("*", requireAuth, requireOwner);

collaborators.get("/", async (c) => {
  const list = await listCollaborators(c.get("session").orgId);
  return c.json({ collaborators: list });
});

/** Validates that every eventId belongs to this org; returns the deduped list. */
async function resolveEventIds(orgId: string, raw: unknown): Promise<string[]> {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) fail(400, "eventIds must be an array.");
  const events = await listEvents(orgId);
  const valid = new Set(events.map((ev) => ev.id));
  const ids = Array.from(new Set(raw.map(String)));
  for (const id of ids) {
    if (!valid.has(id)) fail(400, `Unknown event: ${id}`);
  }
  return ids;
}

collaborators.post("/", async (c) => {
  const org = c.get("org");
  const body = await c.req.json().catch(() => ({}));
  const email = requireEmail(body.email);
  const name = optionalString(body.name, 120) || email;

  if (email === org.email) fail(400, "The organizer is already a member.");

  const eventIds = await resolveEventIds(org.id, body.eventIds);

  const collaborator: Collaborator = {
    email,
    name,
    orgId: org.id,
    eventIds,
    addedAt: new Date().toISOString(),
  };
  await addCollaborator(collaborator);

  // Best-effort invite email — a failure never blocks the add.
  try {
    await sendEmail({
      org,
      to: email,
      subject: `You've been added to ${org.name} on Convoca`,
      html:
        `<p>Hi ${name},</p><p>You can now sign in to <strong>${org.name}</strong> on Convoca to manage check-ins for the events you've been granted.</p>` +
        `<p><a href="${config.appBaseUrl}/login">Sign in here</a> — use this email address and you'll receive a one-time code.</p>`,
    });
  } catch (err) {
    console.error(`[collaborators] invite email failed for ${email}:`, err);
  }

  return c.json({ collaborator }, 201);
});

// PATCH /:email — update a collaborator's event scope (owner-only).
collaborators.patch("/:email", async (c) => {
  const orgId = c.get("session").orgId;
  const email = decodeURIComponent(c.req.param("email")).toLowerCase();
  const body = await c.req.json().catch(() => ({}));

  const existing = await listCollaborators(orgId);
  const collab = existing.find((cb) => cb.email === email);
  if (!collab) fail(404, "Collaborator not found.");

  const eventIds = await resolveEventIds(orgId, body.eventIds);
  const updated: Collaborator = { ...collab, eventIds };
  await updateCollaborator(updated);
  return c.json({ collaborator: updated });
});

collaborators.delete("/:email", async (c) => {
  const email = decodeURIComponent(c.req.param("email")).toLowerCase();
  await removeCollaborator(c.get("session").orgId, email);
  return c.json({ ok: true });
});

export default collaborators;
