// ── QR encoder self-check ────────────────────────────────────────────────────
// Proves the pure-JS PNG encoder in src/lib/qr.ts produces a structurally valid,
// non-blank PNG on THIS runtime — run it anywhere (locally, in the prod image)
// to confirm QR generation works before trusting email delivery.
//
//   deno run -A scripts/verify-qr.ts [payload]

import { qrPngBuffer } from "../src/lib/qr.ts";

const payload = Deno.args[0] ?? "CONVOCA-VERIFY";
const png = qrPngBuffer(payload);

// 1) PNG signature.
const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
if (!SIG.every((b, i) => png[i] === b)) throw new Error("Bad PNG signature");

// 2) IHDR width (offset 16) + height (offset 20).
const be = (o: number) => (png[o] << 24) | (png[o + 1] << 16) | (png[o + 2] << 8) | png[o + 3];
const width = be(16);
const height = be(20);
if (width <= 0 || width !== height) throw new Error(`Bad IHDR dims ${width}x${height}`);

// 3) Inflate the IDAT (a full zlib stream) and confirm the scanlines are the
//    expected size and contain both black and white pixels (a real QR).
const idatStart = 8 + 4 + 4 + 13 + 4 + 4 + 4; // sig + IHDR(len+type+13+crc) + IDAT(len+type)
const idatLen = be(8 + 4 + 4 + 13 + 4); // IDAT length field
const zlibStream = new Uint8Array(idatLen);
zlibStream.set(png.subarray(idatStart, idatStart + idatLen));
const raw = new Uint8Array(
  await new Response(
    new Blob([zlibStream]).stream().pipeThrough(new DecompressionStream("deflate")),
  ).arrayBuffer(),
);


const stride = 1 + width;
if (raw.length !== stride * height) {
  throw new Error(`Inflated size ${raw.length} != ${stride * height}`);
}
let black = 0, white = 0;
for (let y = 0; y < height; y++) {
  if (raw[y * stride] !== 0) throw new Error(`Row ${y} filter byte != 0`);
  for (let x = 0; x < width; x++) raw[y * stride + 1 + x] === 0 ? black++ : white++;
}
if (black === 0 || white === 0) throw new Error("QR is blank (all one color)");

const out = `${Deno.makeTempDirSync()}/convoca-qr.png`;
Deno.writeFileSync(out, png);
console.log(`✓ Valid QR PNG: ${width}x${height}px, ${png.length} bytes, ${black} dark / ${white} light`);
console.log(`  payload="${payload}"  →  ${out}`);
