// ── Deliverability probe ─────────────────────────────────────────────────────
// Sends the EXACT check-in QR email (same templates + sender the app uses) plus
// a no-image "control" to one or more addresses, so we can tell whether the QR
// image is what a recipient's "quishing" spam filter silently drops.
//
//   deno run -A scripts/send-test-email.ts [email ...]
//
// With no args it targets the default probe list. For each address it sends:
//   [QR]      — the real invite (inline + attached QR PNG, now with a text part)
//   [control] — identical copy with the QR image removed (no attachment)
//
// Read the printed SMTP result: `accepted` means Gmail took it (delivery is then
// the recipient side); a throw means Gmail rejected it (auth/policy). If [control]
// lands but [QR] doesn't, the image is being filtered — not your routing.

import { config } from "../src/config.ts";
import { sendEmail } from "../src/lib/email.ts";
import { qrDataUrl } from "../src/lib/qr.ts";
import { qrInviteEmail } from "../src/lib/emailTemplates.ts";

const DEFAULT_TARGETS = [
  "oriens@aiban.news",
  "oriens@aiexecutions.com",
  "own@convoca.space",
];

const targets = Deno.args.length > 0 ? Deno.args : DEFAULT_TARGETS;

if (!config.appEmail) {
  console.error("✗ No APP_GMAIL_USER/APP_GMAIL_PASS in .env — cannot send.");
  Deno.exit(1);
}
console.log(`Sender: ${config.appEmail.user}\nTargets: ${targets.join(", ")}\n`);

// Build the real QR payload/PNG exactly like the app does.
const cid = "qr@convoca";
const payload = `PROBE-${crypto.randomUUID()}`;
const base64 = (await qrDataUrl(payload)).split(",")[1] ?? "";
const png = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

const org = { name: "Convoca" }; // no gmailUser/Pass ⇒ falls back to config.appEmail
const tpl = qrInviteEmail(
  org.name,
  "Test Guest",
  "Convoca Deliverability Test",
  new Date().toLocaleString(),
  "This is a delivery probe — please confirm you received it.",
  cid,
);

const line = (tag: string, to: string, r: { accepted: string[]; rejected: string[]; messageId: string }) =>
  console.log(`  ${tag.padEnd(8)} → ${to}: accepted=${JSON.stringify(r.accepted)} rejected=${JSON.stringify(r.rejected)} id=${r.messageId}`);

for (const to of targets) {
  console.log(to);
  try {
    const r = await sendEmail({
      org,
      to,
      replyTo: config.appEmail.user,
      subject: `[QR] ${tpl.subject}`,
      html: tpl.html,
      text: tpl.text,
      attachments: [{ filename: "checkin-qr.png", content: png, contentType: "image/png", cid }],
    });
    line("[QR]", to, r);
  } catch (err) {
    console.error(`  [QR]     → ${to}: FAILED — ${(err as Error).message}`);
  }

  try {
    const r = await sendEmail({
      org,
      to,
      replyTo: config.appEmail.user,
      subject: `[control] ${tpl.subject}`,
      html: tpl.html.replace(/<img[^>]*>/i, "<p>[QR image intentionally omitted in this control test]</p>"),
      text: tpl.text,
    });
    line("[control]", to, r);
  } catch (err) {
    console.error(`  [control]→ ${to}: FAILED — ${(err as Error).message}`);
  }
  console.log();
}

console.log("Done. Check each inbox (and spam). If [control] arrives but [QR] doesn't, the QR image is being filtered.");
