// ── QR generation (runtime-agnostic) ─────────────────────────────────────────
// The QR encodes ONLY the participant hash (the SHA-256), never a URL.
//
// We take ONLY the pure-JS matrix from `qrcode` (QRCode.create) and encode the
// PNG ourselves using uncompressed DEFLATE "stored" blocks. This deliberately
// avoids the package's PNG renderer (pngjs → node:zlib/node:stream), which works
// under full Node compat locally but throws at runtime on restricted runtimes
// (e.g. Deno Deploy) — the reason production silently failed to email QR codes
// while auth (imageless) mail went out fine.

import QRCode from "qrcode";

const SCALE = 8; // px per module
const MARGIN = 2; // quiet-zone modules
const ECC = "M" as const;

// ── PNG primitives (no external deps) ────────────────────────────────────────
function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 4 + body.length);
  return out;
}

/** Wrap raw scanlines in a zlib stream using only stored (uncompressed) blocks. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const parts: number[] = [0x78, 0x01]; // zlib header (CM=8, 32K window)
  const MAX = 0xffff;
  for (let i = 0; i < raw.length; i += MAX) {
    const slice = raw.subarray(i, Math.min(i + MAX, raw.length));
    const isLast = i + MAX >= raw.length ? 1 : 0;
    const len = slice.length;
    const nlen = ~len & 0xffff;
    parts.push(isLast, len & 255, (len >>> 8) & 255, nlen & 255, (nlen >>> 8) & 255);
    for (let j = 0; j < slice.length; j++) parts.push(slice[j]);
  }
  parts.push(...u32(adler32(raw)));
  return new Uint8Array(parts);
}

/** Encodes an 8-bit grayscale PNG from the QR module matrix. */
function encodePng(get: (x: number, y: number) => boolean, modules: number): Uint8Array {
  const dim = (modules + MARGIN * 2) * SCALE;
  const stride = 1 + dim; // 1 filter byte + dim grayscale pixels
  const raw = new Uint8Array(stride * dim);
  for (let y = 0; y < dim; y++) {
    raw[y * stride] = 0; // filter: none
    const my = Math.floor(y / SCALE) - MARGIN;
    for (let x = 0; x < dim; x++) {
      const mx = Math.floor(x / SCALE) - MARGIN;
      const dark = my >= 0 && my < modules && mx >= 0 && mx < modules && get(mx, my);
      raw[y * stride + 1 + x] = dark ? 0x00 : 0xff;
    }
  }
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array([...u32(dim), ...u32(dim), 8, 0, 0, 0, 0]); // 8-bit, grayscale
  const parts = [
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibStored(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ── Public API (same signatures as before) ───────────────────────────────────
/** Raw PNG bytes for the QR of `payload`. Pure JS — safe on any runtime. */
export function qrPngBuffer(payload: string): Uint8Array {
  const qr = QRCode.create(payload, { errorCorrectionLevel: ECC });
  const size = qr.modules.size;
  const data = qr.modules.data;
  return encodePng((x, y) => !!data[y * size + x], size);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)] : "=";
    out += i + 2 < bytes.length ? B64[b2 & 63] : "=";
  }
  return out;
}

/** PNG data-URL string: `data:image/png;base64,...` */
export function qrDataUrl(payload: string): string {
  return "data:image/png;base64," + base64(qrPngBuffer(payload));
}
