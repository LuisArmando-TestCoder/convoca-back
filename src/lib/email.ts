// ── Email transport ──────────────────────────────────────────────────────────
// Mail goes out through the platform's own Gmail/Workspace sender (config.appEmail)
// by default; a tenant may override it with its OWN Gmail App Password. Transporters
// are cached per sender (keyed by user+pass) so we don't spin up a new SMTP
// connection on every send.

import nodemailer from "nodemailer";
import { config } from "../config.ts";

interface Attachment {
  filename: string;
  content: Uint8Array;
  contentType?: string;
  cid?: string;
}

interface SendArgs {
  /** Sender identity. Empty gmailUser/gmailPass ⇒ fall back to the app sender. */
  org: { name: string; gmailUser?: string; gmailPass?: string };
  to: string;
  subject: string;
  html: string;
  attachments?: Attachment[];
  /** Address replies route to (the team). Defaults to the sending account. */
  replyTo?: string;
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

/**
 * Picks the sender: an org's own Gmail if it configured one, otherwise the
 * platform's central sender. Throws if neither is available.
 */
function resolveSender(org: SendArgs["org"]): { user: string; pass: string } {
  if (org.gmailUser && org.gmailPass) return { user: org.gmailUser, pass: org.gmailPass };
  if (config.appEmail) return config.appEmail;
  throw new Error(
    "No email sender configured. Set APP_GMAIL_USER/APP_GMAIL_PASS or provide an org Gmail App Password.",
  );
}

export async function sendEmail(
  { org, to, subject, html, attachments, replyTo }: SendArgs,
): Promise<void> {
  const { user, pass } = resolveSender(org);
  const t = transporterFor(user, pass);
  await t.sendMail({
    from: `"${org.name}" <${user}>`,
    replyTo: replyTo || user,
    to,
    subject,
    html,
    attachments,
  });
}
