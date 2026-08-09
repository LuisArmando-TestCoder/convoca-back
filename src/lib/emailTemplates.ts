// ── Email templates ──────────────────────────────────────────────────────────
// A single centralized layout so every message stays visually cohesive. All
// dynamic values are HTML-escaped before interpolation (emails are untrusted
// display surfaces).

const BRAND = "#0d9488"; // teal-600
const INK = "#0f172a"; // slate-900
const MUTED = "#64748b"; // slate-500

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(orgName: string, title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;padding:24px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(15,23,42,.08);">
      <tr><td style="background:${BRAND};padding:20px 28px;">
        <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:.3px;">${
    esc(orgName)
  }</span>
      </td></tr>
      <tr><td style="padding:28px;">
        <h1 style="margin:0 0 12px;font-size:20px;color:${INK};">${esc(title)}</h1>
        ${body}
      </td></tr>
      <tr><td style="padding:18px 28px;border-top:1px solid #e2e8f0;">
        <span style="font-size:12px;color:${MUTED};">Sent via Convoca · event check-in</span>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export function otpEmail(
  orgName: string,
  code: string,
): { subject: string; html: string; text: string } {
  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${MUTED};line-height:1.5;">
      Use this one-time code to sign in. It expires shortly.
    </p>
    <div style="text-align:center;margin:8px 0 20px;">
      <span style="display:inline-block;font-size:34px;font-weight:800;letter-spacing:8px;color:${INK};background:#f1f5f9;border-radius:12px;padding:14px 22px;">${
    esc(code)
  }</span>
    </div>
    <p style="margin:0;font-size:13px;color:${MUTED};">If you didn't request this, you can ignore this email.</p>`;
  const text = `${orgName} sign-in code: ${code}\n\n` +
    `Use this one-time code to sign in. It expires shortly.\n` +
    `If you didn't request this, you can ignore this email.\n\n` +
    `Sent via Convoca · event check-in`;
  return {
    subject: `Your ${orgName} sign-in code: ${code}`,
    html: layout(orgName, "Sign-in code", body),
    text,
  };
}


function descriptionBlock(eventDescription: string): string {
  if (!eventDescription) return "";
  return `
    <div style="margin:0 0 16px;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
      <p style="margin:0;font-size:14px;color:${MUTED};line-height:1.55;white-space:pre-wrap;">${
    esc(eventDescription)
  }</p>
    </div>`;
}

export function qrInviteEmail(
  orgName: string,
  participantName: string,
  eventName: string,
  eventDate: string,
  eventDescription: string,
  qrCid: string,
): { subject: string; html: string; text: string } {
  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${MUTED};line-height:1.5;">
      Hi ${esc(participantName)}, you're registered for <strong style="color:${INK};">${
    esc(eventName)
  }</strong>${eventDate ? ` on <strong style="color:${INK};">${esc(eventDate)}</strong>` : ""}.
    </p>
    ${descriptionBlock(eventDescription)}
    <p style="margin:0 0 16px;font-size:15px;color:${MUTED};line-height:1.5;">
      Show this QR code at check-in:
    </p>

    <div style="text-align:center;margin:8px 0 20px;">
      <img src="cid:${qrCid}" alt="Your check-in QR code" width="220" height="220" style="border-radius:12px;border:1px solid #e2e8f0;" />
    </div>
    <p style="margin:0;font-size:13px;color:${MUTED};">Keep this email handy — it's your ticket in.</p>`;
  const text = `Hi ${participantName},\n\n` +
    `You're registered for ${eventName}${eventDate ? ` on ${eventDate}` : ""}.\n` +
    (eventDescription ? `\n${eventDescription}\n` : "") +
    `\nYour personal check-in QR code is shown in this email and attached as ` +
    `checkin-qr.png. Show it at the door to check in — keep this email handy, ` +
    `it's your ticket in.\n\nSent via Convoca · event check-in`;
  return {
    subject: `Your check-in QR for ${eventName}`,
    html: layout(orgName, "You're in! 🎟️", body),
    text,
  };
}

export function certificateEmail(
  orgName: string,
  recipientName: string,
): { subject: string; html: string; text: string } {
  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${MUTED};line-height:1.5;">
      Hi ${esc(recipientName)}, congratulations! Your certificate is ready.
    </p>
    <p style="margin:0 0 16px;font-size:15px;color:${MUTED};line-height:1.5;">
      Your personalized certificate is attached to this email as a PDF. Download
      it and keep it handy — it's yours to share.
    </p>
    <p style="margin:0;font-size:13px;color:${MUTED};">If you have any questions, just reply to this email.</p>`;
  const text = `Hi ${recipientName},\n\n` +
    `Congratulations! Your certificate is ready.\n\n` +
    `Your personalized certificate is attached to this email as a PDF. ` +
    `Download it and keep it handy — it's yours to share.\n\n` +
    `If you have any questions, just reply to this email.\n\n` +
    `Sent via Convoca · certificate delivery`;
  return {
    subject: "Your certificate is ready 🎓",
    html: layout(orgName, "Your certificate 🎓", body),
    text,
  };
}

export function selfRegConfirmEmail(
  orgName: string,
  participantName: string,
  eventName: string,
  eventDescription: string,
  qrCid: string,
): { subject: string; html: string; text: string } {
  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${MUTED};line-height:1.5;">
      Thanks for registering, ${esc(participantName)}! Your spot for
      <strong style="color:${INK};">${esc(eventName)}</strong> is confirmed.
    </p>
    ${descriptionBlock(eventDescription)}
    <div style="text-align:center;margin:8px 0 20px;">

      <img src="cid:${qrCid}" alt="Your check-in QR code" width="220" height="220" style="border-radius:12px;border:1px solid #e2e8f0;" />
    </div>
    <p style="margin:0;font-size:13px;color:${MUTED};">Show this QR at the door to check in.</p>`;
  const text = `Thanks for registering, ${participantName}!\n\n` +
    `Your spot for ${eventName} is confirmed.\n` +
    (eventDescription ? `\n${eventDescription}\n` : "") +
    `\nYour personal check-in QR code is shown in this email and attached as ` +
    `checkin-qr.png. Show it at the door to check in.\n\n` +
    `Sent via Convoca · event check-in`;
  return {
    subject: `You're registered for ${eventName}`,
    html: layout(orgName, "Registration confirmed ✅", body),
    text,
  };
}

/** One row of a failed QR send, for the team failure report. */
export interface FailureRow {
  name: string;
  email: string;
  reason: string;
  source: string;
  extra: { label: string; value: string }[];
}

/**
 * Sent to the team when a bulk QR send has failures, aggregating every bad
 * recipient into one table so someone can act on it (fix the address, retry).
 */
export function failureReportEmail(
  orgName: string,
  eventName: string,
  sent: number,
  rows: FailureRow[],
): { subject: string; html: string; text: string } {
  const extraCols = rows[0]?.extra.map((e) => e.label) ?? [];
  const th = (t: string) =>
    `<th style="text-align:left;padding:8px 10px;border-bottom:2px solid #e2e8f0;font-size:12px;color:${MUTED};text-transform:uppercase;letter-spacing:.04em;">${
      esc(t)
    }</th>`;
  const td = (t: string) =>
    `<td style="padding:8px 10px;border-bottom:1px solid #eef2f7;font-size:13px;color:${INK};">${esc(t)}</td>`;

  const head = `<tr>${th("Name")}${th("Email")}${th("Reason")}${th("Source")}${
    extraCols.map(th).join("")
  }</tr>`;
  const body = rows.map((r) =>
    `<tr>${td(r.name)}${td(r.email)}${td(r.reason)}${td(r.source)}${
      r.extra.map((e) => td(e.value)).join("")
    }</tr>`
  ).join("");

  const html = layout(
    orgName,
    "Some check-in emails didn't send",
    `
    <p style="margin:0 0 14px;font-size:15px;color:${MUTED};line-height:1.5;">
      For <strong style="color:${INK};">${esc(eventName)}</strong>: ${sent} sent,
      <strong style="color:#b91c1c;">${rows.length} failed</strong>. The failures are listed below —
      fix the address (or investigate the reason) and resend from the dashboard.
    </p>
    <div style="overflow-x:auto;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        <thead>${head}</thead><tbody>${body}</tbody>
      </table>
    </div>`,
  );

  const textLines = rows.map((r) =>
    `- ${r.name} <${r.email}> — ${r.reason} [${r.source}]${
      r.extra.length ? " | " + r.extra.map((e) => `${e.label}: ${e.value}`).join(", ") : ""
    }`
  );
  const text = `Some check-in emails didn't send for ${eventName}.\n\n` +
    `${sent} sent, ${rows.length} failed:\n\n${textLines.join("\n")}\n\n` +
    `Fix the address or investigate the reason, then resend from the dashboard.\n\n` +
    `Sent via Convoca · event check-in`;

  return {
    subject: `${rows.length} check-in email${rows.length === 1 ? "" : "s"} failed — ${eventName}`,
    html,
    text,
  };
}


