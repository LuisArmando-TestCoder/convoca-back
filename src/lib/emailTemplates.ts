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
        <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:.3px;">${esc(orgName)}</span>
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

export function otpEmail(orgName: string, code: string): { subject: string; html: string } {
  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${MUTED};line-height:1.5;">
      Use this one-time code to sign in. It expires shortly.
    </p>
    <div style="text-align:center;margin:8px 0 20px;">
      <span style="display:inline-block;font-size:34px;font-weight:800;letter-spacing:8px;color:${INK};background:#f1f5f9;border-radius:12px;padding:14px 22px;">${esc(code)}</span>
    </div>
    <p style="margin:0;font-size:13px;color:${MUTED};">If you didn't request this, you can ignore this email.</p>`;
  return { subject: `Your ${orgName} sign-in code: ${code}`, html: layout(orgName, "Sign-in code", body) };
}

export function qrInviteEmail(
  orgName: string,
  participantName: string,
  eventName: string,
  eventDate: string,
  qrCid: string,
): { subject: string; html: string } {
  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${MUTED};line-height:1.5;">
      Hi ${esc(participantName)}, you're registered for <strong style="color:${INK};">${esc(eventName)}</strong>${
    eventDate ? ` on <strong style="color:${INK};">${esc(eventDate)}</strong>` : ""
  }.
    </p>
    <p style="margin:0 0 16px;font-size:15px;color:${MUTED};line-height:1.5;">
      Show this QR code at check-in:
    </p>
    <div style="text-align:center;margin:8px 0 20px;">
      <img src="cid:${qrCid}" alt="Your check-in QR code" width="220" height="220" style="border-radius:12px;border:1px solid #e2e8f0;" />
    </div>
    <p style="margin:0;font-size:13px;color:${MUTED};">Keep this email handy — it's your ticket in.</p>`;
  return {
    subject: `Your check-in QR for ${eventName}`,
    html: layout(orgName, "You're in! 🎟️", body),
  };
}

export function selfRegConfirmEmail(
  orgName: string,
  participantName: string,
  eventName: string,
  qrCid: string,
): { subject: string; html: string } {
  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:${MUTED};line-height:1.5;">
      Thanks for registering, ${esc(participantName)}! Your spot for
      <strong style="color:${INK};">${esc(eventName)}</strong> is confirmed.
    </p>
    <div style="text-align:center;margin:8px 0 20px;">
      <img src="cid:${qrCid}" alt="Your check-in QR code" width="220" height="220" style="border-radius:12px;border:1px solid #e2e8f0;" />
    </div>
    <p style="margin:0;font-size:13px;color:${MUTED};">Show this QR at the door to check in.</p>`;
  return {
    subject: `You're registered for ${eventName}`,
    html: layout(orgName, "Registration confirmed ✅", body),
  };
}
