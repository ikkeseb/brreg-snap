// Generates public/icons/icon-{16,32,48,128}.png from a single
// vector description, using only Node built-ins (no `sharp` or
// ImageMagick devDep). Re-run after editing the design.
//
//   node scripts/generate-icons.mjs
//
// Design: Norwegian-flag-inspired cross — red field, white cross,
// blue inset. Centered (square icon, not flag proportions) so it
// reads cleanly at 16px. Colors per the official spec (PMS 200 red,
// PMS 281 blue).

import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RED = [186, 12, 47];
const WHITE = [255, 255, 255];
const BLUE = [0, 32, 91];

const SIZES = [16, 32, 48, 128];

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "..", "public", "icons");

// PNG CRC-32 table.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// Pixel function: cross arms with white outer band and blue inner band,
// centered on a red field. Thickness scales with size so the cross stays
// readable from 16px up to 128px.
function pixel(x, y, size) {
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;

  // Cross arm half-widths. Tuned per size: at 16px the inner blue is
  // a 2px stripe inside a 6px white cross. Scales proportionally.
  const whiteHalf = Math.max(1, Math.round((size * 3) / 16));
  const blueHalf = Math.max(0, Math.round((size * 1) / 16));

  const dx = Math.abs(x - cx);
  const dy = Math.abs(y - cy);

  const onVerticalArm = dx <= whiteHalf;
  const onHorizontalArm = dy <= whiteHalf;
  if (!onVerticalArm && !onHorizontalArm) return RED;

  const inBlueV = dx <= blueHalf;
  const inBlueH = dy <= blueHalf;
  if (inBlueV || inBlueH) return BLUE;

  return WHITE;
}

function makePng(size) {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = 1 + size * 3;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter type: None
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y, size);
      const off = y * stride + 1 + x * 3;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
    }
  }

  const idat = deflateSync(raw);

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const png = makePng(size);
  const path = resolve(OUT_DIR, `icon-${size}.png`);
  writeFileSync(path, png);
  console.log(`wrote ${path} (${png.length} bytes)`);
}
