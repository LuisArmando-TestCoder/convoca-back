// ── Collaborators routes (owner-only) ────────────────────────────────────────
// The owner invites teammates by email. Invited collaborators can then sign in
// (passwordless OTP) and manage participants / scan check-ins for the org.

import { Hono } from "hono";
import type { AppEnv } from "../context.ts";
import { config } from "../config.ts";
import { requireAuth, requireOwner } from "../middleware/auth.ts";
import { fail, optionalString, requireEmail } from "../lib/validate.ts";
import { sendEmail } from "../lib/email.ts";
import { addCollaborator, listCollaborators, removeCollaborator } from "../db/orgs.ts";
import type { Collaborator } from "../types.ts";

const collaborators = new Hono<AppEnv>();
collaborators.use("*", requireAuth, requireOwner);

collaborators.get("/", async (c) => {
  const list = await listCollaborators(c.get("session").orgId);
  return c.json({ collaborators: list });
});

collaborators.post("/", async (c) => {
  const org = c.get("org");
  const body = await c.req.json().catch(() => ({}));
  const email = requireEmail(body.email);
  const name = optionalString(body.name, 120) || email;

  if (email === org.email) fail(400, "The owner is already a member.");

  const collaborator: Collaborator = {
    email,
    name,
    orgId: org.id,
    addedAt: new Date().toISOString(),
  };
  await addCollaborator(collaborator);

  // Best-effort invite email — failure never blocks the add.
  try {
    await sendEmail({
      org,
      to: email,
      subject: `You've been added to ${org.name} on Convoca`,
      html:
        `<p>Hi ${name},</p><p>You can now sign in to <strong>${org.name}</strong> on Convoca to manage event check-ins.</p>` +
        `<p><a href="${config.appBaseUrl}/login">Sign in here</a> — use this email address and you'll receive a one-time code.</p>`,
    });
  } catch (err) {
    console.error(`[collaborators] invite email failed for ${email}:`, err);
  }

  return c.json({ collaborator }, 201);
});

collaborators.delete("/:email", async (c) => {
  const email = decodeURIComponent(c.req.param("email")).toLowerCase();
  await removeCollaborator(c.get("session").orgId, email);
  return c.json({ ok: true });
});

export default collaborators;
