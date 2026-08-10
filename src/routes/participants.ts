// ── Participant lookup routes (authenticated, org-scoped) ────────────────────
// A small helper used by the certificate tool: given an email, find the
// participant's name across all of the org's events. The certificate sender
// needs the person's name to render it into the certificate image.

import { Hono } from "hono";
import type { AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/auth.ts";
import { requireEmail } from "../lib/validate.ts";
import { listEvents } from "../db/events.ts";
import { listParticipants } from "../db/participants.ts";

const participants = new Hono<AppEnv>();
participants.use("*", requireAuth);

/**
 * GET /api/participants/list
 * Returns a flat, de-duplicated list of every participant across the org's
 * events (name + email + the event they were found in). Used by the
 * certificate tool's bulk-send panel.
 */
participants.get("/list", async (c) => {
  const org = c.get("org");
  const events = await listEvents(org.id);
  const seen = new Map<string, { name: string; email: string; eventName: string }>();
  for (const ev of events) {
    const rows = await listParticipants(org.id, ev.id);
    for (const p of rows) {
      const key = p.email.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, { name: p.name, email: p.email, eventName: ev.name });
      }
    }
  }
  return c.json({
    participants: Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name)),
  });
});

/**
 * GET /api/participants/lookup?email=…
 * Searches the org's participants (across every event) for a matching email and
 * returns the first match's name + email. 404 if none found.
 */
participants.get("/lookup", async (c) => {
  const org = c.get("org");
  const email = requireEmail(c.req.query("email") ?? "", "email");

  const events = await listEvents(org.id);
  for (const ev of events) {
    const rows = await listParticipants(org.id, ev.id);
    const hit = rows.find((p) => p.email.toLowerCase() === email);
    if (hit) {
      return c.json({ name: hit.name, email: hit.email });
    }
  }

  return c.json({ error: "No participant found for that email." }, 404);
});

export default participants;