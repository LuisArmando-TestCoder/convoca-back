// ── Email transport ──────────────────────────────────────────────────────────
// Every tenant sends through ITS OWN Gmail using the App Password it provided at
// signup. Transporters are cached per org (keyed by user+pass) so we don't spin
// up a new SMTP connection on every send.

import nodemailer from "nodemailer";
import type { Organization } from "../types.ts";

interface Attachment {
  filename: string;
  content: Uint8Array;
  contentType?: string;
  cid?: string;
}


interface SendArgs {
  org: Pick<Organization, "name" | "gmailUser" | "gmailPass">;
  to: string;
  subject: string;
  html: string;
  attachments?: Attachment[];
}

const transporters = new Map<string, ReturnType<typeof nodemailer.createTransport>>();

/**
 * Gmail shows App Passwords as four space-separated groups ("vcxh qbma lkdm
 * amjb"), but the actual secret is the 16 chars with no spaces. Users paste it
 * verbatim, so strip all whitespace at the single point where it reaches SMTP —
 * making every caller and any previously stored value safe.
 */
const normalizePass = (pass: string) => pass.replace(/\s+/g, "");

function transporterFor(user: string, rawPass: string) {
  const pass = normalizePass(rawPass);
  const key = `${user}:${pass}`;
  let t = transporters.get(key);
  if (!t) {
    t = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
    transporters.set(key, t);
  }
  return t;
}

/** Verifies an org's Gmail credentials by opening an SMTP connection. */
export async function verifyGmail(user: string, pass: string): Promise<boolean> {
  try {
    await transporterFor(user, pass).verify();
    return true;
  } catch {
    transporters.delete(`${user}:${normalizePass(pass)}`);
    return false;
  }
}


export async function sendEmail({ org, to, subject, html, attachments }: SendArgs): Promise<void> {
  const t = transporterFor(org.gmailUser, org.gmailPass);
  await t.sendMail({
    from: `"${org.name}" <${org.gmailUser}>`,
    replyTo: org.gmailUser,
    to,
    subject,
    html,
    attachments,
  });
}
