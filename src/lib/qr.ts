// ── QR generation ────────────────────────────────────────────────────────────
// The QR encodes ONLY the participant hash (the SHA-256), never a URL. Returned
// both as a PNG data-URL (for <img> in email) and as a raw PNG buffer.

import QRCode from "qrcode";

const OPTS = {
  errorCorrectionLevel: "M" as const,
  margin: 2,
  scale: 8,
  color: { dark: "#0f172a", light: "#ffffff" },
};

/** PNG data-URL string: `data:image/png;base64,...` */
export function qrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, OPTS);
}

/** Raw PNG bytes for direct HTTP download. */
export async function qrPngBuffer(payload: string): Promise<Uint8Array> {
  const buf = await QRCode.toBuffer(payload, { ...OPTS, type: "png" });
  return new Uint8Array(buf);
}
