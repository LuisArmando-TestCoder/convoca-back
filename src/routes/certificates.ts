// ── Certificate routes (authenticated, org-scoped) ───────────────────────────
// Sends a branded email with a personalized certificate PDF attached. The PDF
// is generated client-side (the name is composited into the image in the
// browser) and uploaded here as base64; this router attaches it and sends via
// the org's resolved sender (own Gmail or the platform sender).

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../context.ts";
import { requireAuth } from "../middleware/auth.ts";
import { requireEmail, requireString } from "../lib/validate.ts";
import { sendEmail } from "../lib/email.ts";
import { certificateEmail } from "../lib/emailTemplates.ts";
import {
  addCertificateSend,
  listCertificateSends,
  type CertificateSend,
} from "../db/certificateSends.ts";

const certificates = new Hono<AppEnv>();
certificates.use("*", requireAuth);

/**
 * POST /api/certificates/send
 * Body: { to, name, pdfBase64 }
 * Sends a branded certificate email with the PDF attached.
 */
certificates.post("/send", async (c) => {
  const org = c.get("org");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw new HTTPException(400, { message: "Invalid JSON body." });
  }

  const to = requireEmail((body as Record<string, unknown>).to, "to");
  const name = requireString((body as Record<string, unknown>).name, "name", 200);
  const pdfBase64 = requireString((body as Record<string, unknown>).pdfBase64, "pdfBase64", 20_000_000);

  // Decode the base64 PDF into a Uint8Array for the attachment.
  const pdfBytes = Uint8Array.from(atob(pdfBase64), (ch) => ch.charCodeAt(0));

  const tpl = certificateEmail(org.name, name);

  const info = await sendEmail({
    org,
    to,
    replyTo: org.email,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    attachments: [{
      filename: "certificate.pdf",
      content: pdfBytes,
      contentType: "application/pdf",
    }],
  });

  return c.json({
    accepted: info.accepted,
    rejected: info.rejected,
    messageId: info.messageId,
  });
});

/**
 * POST /api/certificates/log
 * Body: { name, email, font, box, centerX, centerY, maxWidth, maxHeight, status }
 * Persists a certificate send record to the org's send log.
 */
certificates.post("/log", async (c) => {
  const org = c.get("org");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    throw new HTTPException(400, { message: "Invalid JSON body." });
  }
  const b = body as Record<string, unknown>;

  const name = requireString(b.name, "name", 200);
  const email = requireEmail(b.email, "email");
  const font = requireString(b.font, "font", 200);
  const status = b.status === "failed" ? "failed" : "sent";

  const boxRaw = b.box as Record<string, unknown> | undefined;
  if (!boxRaw || typeof boxRaw !== "object") {
    throw new HTTPException(400, { message: "box is required." });
  }
  const num = (v: unknown): number => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) throw new HTTPException(400, { message: "box must contain numbers." });
    return n;
  };
  const box = {
    x1: num(boxRaw.x1),
    y1: num(boxRaw.y1),
    x2: num(boxRaw.x2),
    y2: num(boxRaw.y2),
  };

  const send: Omit<CertificateSend, "id"> = {
    at: new Date().toISOString(),
    name,
    email,
    font,
    box,
    centerX: num(b.centerX),
    centerY: num(b.centerY),
    maxWidth: num(b.maxWidth),
    maxHeight: num(b.maxHeight),
    status,
  };

  const doc = await addCertificateSend(org.id, send);
  return c.json({ send: doc });
});

/**
 * GET /api/certificates/log
 * Returns the org's certificate send history, newest first.
 */
certificates.get("/log", async (c) => {
  const org = c.get("org");
  const sends = await listCertificateSends(org.id);
  return c.json({ sends });
});

export default certificates;
