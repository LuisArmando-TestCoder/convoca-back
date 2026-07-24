// ── Auth routes ──────────────────────────────────────────────────────────────
// Passwordless OTP flow. Org owners register with their Gmail App Password;
// everyone (owners + collaborators) signs in by receiving a code on their email.

import { Hono } from "hono";
import { config } from "../config.ts";
import { orgId as computeOrgId } from "../lib/hash.ts";
import { fail, generateCode, requireEmail, requireString } from "../lib/validate.ts";
import { verifyGmail, sendEmail } from "../lib/email.ts";
import { otpEmail } from "../lib/emailTemplates.ts";
import { issueSession } from "../lib/jwt.ts";
import {
  consumeOtp,
  createOrg,
  getOrg,
  getOrgByEmail,
  resolveLogin,
  saveOtp,
  updateOrg,
} from "../db/orgs.ts";
import type { Organization } from "../types.ts";

const auth = new Hono();

/** Generates + stores an OTP and emails it through the given org's Gmail. */
async function issueOtp(org: Organization): Promise<void> {
  const code = generateCode(6);
  await saveOtp(org.email, code, config.otpTtlMs);
  const { subject, html } = otpEmail(org.name, code);
  await sendEmail({ org, to: org.email, subject, html });
}

// POST /register — create an organization and send its first sign-in code.
auth.post("/register", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = requireString(body.orgName, "orgName", 120);
  const email = requireEmail(body.email);
  // Org-owned Gmail is OPTIONAL: leave it blank to send through the platform's
  // central sender (config.appEmail). If provided, both fields are used together.
  const gmailPass = body.gmailPass
    ? requireString(body.gmailPass, "gmailPass", 100).replace(/\s+/g, "")
    : "";
  const gmailUser = gmailPass ? (body.gmailUser ? requireEmail(body.gmailUser, "gmailUser") : email) : "";

  const existing = await getOrgByEmail(email);
  if (existing?.verified) {
    fail(409, "This organization is already registered. Sign in instead.");
  }

  if (gmailPass) {
    // Validate the org's own App Password before persisting anything.
    const ok = await verifyGmail(gmailUser, gmailPass);
    if (!ok) {
      fail(400, "Gmail credentials rejected. Use a 16-character App Password (not your login password).");
    }
  } else if (!config.appEmail) {
    fail(400, "Email delivery is not configured. Provide a Gmail App Password to continue.");
  }


  const id = existing?.id ?? (await computeOrgId(email));
  const org: Organization = {
    id,
    name,
    email,
    gmailUser,
    gmailPass,
    verified: false,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };

  if (existing) {
    await updateOrg(org); // re-registering an unverified org updates creds
  } else {
    await createOrg(org);
  }

  await issueOtp(org);
  return c.json({ ok: true, email });
});

// POST /request-code — send a sign-in code to an existing owner or collaborator.
auth.post("/request-code", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = requireEmail(body.email);

  const login = await resolveLogin(email);
  if (!login) fail(404, "No account found for this email.");

  const org = await getOrg(login.orgId);
  if (!org) fail(404, "Organization not found.");

  // The code always lands in the person's own inbox, but is SENT via the org
  // Gmail. Store under the login email so verify() matches on the same address.
  const code = generateCode(6);
  await saveOtp(email, code, config.otpTtlMs);
  const { subject, html } = otpEmail(org!.name, code);
  await sendEmail({ org: org!, to: email, subject, html });

  return c.json({ ok: true, email, role: login.role });
});

// POST /verify — exchange a valid code for a session token.
auth.post("/verify", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = requireEmail(body.email);
  const code = requireString(body.code, "code", 6);

  const ok = await consumeOtp(email, code);
  if (!ok) fail(401, "Invalid or expired code.");

  const login = await resolveLogin(email);
  if (!login) fail(404, "No account found for this email.");

  // First successful verify for an owner also activates the org.
  if (login.role === "owner") {
    const org = await getOrg(login.orgId);
    if (org && !org.verified) await updateOrg({ ...org, verified: true });
  }

  const token = await issueSession(email, login.orgId, login.role);
  return c.json({ token, role: login.role, orgId: login.orgId });
});

export default auth;
