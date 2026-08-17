// ── Email transport ──────────────────────────────────────────────────────────
// ALL mail goes out through the platform's own Gmail/Workspace sender
// (config.appEmail = APP_GMAIL_USER/APP_GMAIL_PASS). A tenant's stored Gmail
// App Password (gmailUser/gmailPass on the org doc) is intentionally ignored for
// sending, so recipients never see an unrelated personal address in the From
// line. Transporters are cached per sender (keyed by user+pass) so we don't spin
// up a new SMTP connection on every send.

import nodemailer from "nodemailer";
import { config } from "../config.ts";

interface Attachment {
  filename: string;
  content: Uint8Array;
  contentType?: string;
  cid?: string;
}

interface SendArgs {
  /** Display identity for the From line. gmailUser/gmailPass are LEGACY and
   * deliberately ignored in favor of the platform sender. */
  org: { name: string; gmailUser?: string; gmailPass?: string };
  to: string;
  subject: string;
  html: string;
  /**
   * Plain-text alternative. ALWAYS pass this: without it nodemailer emits an
   * HTML-only message (multipart/related when there's an inline image), which
   * spam filters — especially "quishing" filters that see a QR image with no
   * text — silently drop. Providing text produces a standard multipart/alternative.
   */
  text?: string;
  attachments?: Attachment[];
  /** Address replies route to (the team). Defaults to the sending account. */
  replyTo?: string;
}

/** Minimal shape of nodemailer's send result we surface for diagnostics. */
export interface SendResult {
  accepted: string[];
  rejected: string[];
  response: string;
  messageId: string;
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
 * Picks the sender: ALWAYS the platform's central sender (config.appEmail).
 * A tenant's own Gmail credentials are legacy and ignored so emails can never
 * go out from an org owner's personal address. Throws if the env sender is
 * unset.
 */
function resolveSender(): { user: string; pass: string } {
  if (config.appEmail) return config.appEmail;
  throw new Error(
    "No email sender configured. Set APP_GMAIL_USER/APP_GMAIL_PASS.",
  );
}

export async function sendEmail(
  { org, to, subject, html, text, attachments, replyTo }: SendArgs,
): Promise<SendResult> {
  const { user, pass } = resolveSender();
  const t = transporterFor(user, pass);
  const info = await t.sendMail({
    from: `"${org.name}" <${user}>`,
    replyTo: replyTo || user,
    to,
    subject,
    html,
    text,
    attachments,
  });
  return info as unknown as SendResult;
}

