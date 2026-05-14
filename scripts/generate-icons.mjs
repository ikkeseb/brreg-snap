// Downsamples the source brand PNG to the manifest icon sizes
// (16, 32, 48, 128) using box-filter area averaging.
//
//   node scripts/generate-icons.mjs
//
// Source: docs/brand-b.png — the high-resolution "B" mark, RGBA.
// Output: public/icons/icon-{size}.png — RGBA PNGs consumed by the
// extension manifest. The source stays out of public/ so it doesn't
// end up packed into the .xpi.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const SIZES = [16, 32, 48, 128];

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SOURCE = resolve(REPO_ROOT, 'docs', 'brand-b.png');
const OUT_DIR = resolve(REPO_ROOT, 'public', 'icons');

const source = PNG.sync.read(readFileSync(SOURCE));
const { width: srcW, height: srcH, data: srcData } = source;

// Center-crop to a square viewport so non-square art doesn't get
// distorted on downsample. The B mark sits roughly centered in the
// source PNG; if that changes, retune cropY.
const square = Math.min(srcW, srcH);
const cropX = Math.floor((srcW - square) / 2);
const cropY = Math.floor((srcH - square) / 2);

function sampleSource(x, y) {
  const sx = cropX + x;
  const sy = cropY + y;
  const off = (sy * srcW + sx) * 4;
  return [srcData[off], srcData[off + 1], srcData[off + 2], srcData[off + 3]];
}

function downsample(size) {
  const out = new PNG({ width: size, height: size, colorType: 6 });
  const scale = square / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * scale);
      const y0 = Math.floor(y * scale);
      const x1 = Math.min(square, Math.floor((x + 1) * scale));
      const y1 = Math.min(square, Math.floor((y + 1) * scale));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const [sr, sg, sb, sa] = sampleSource(sx, sy);
          // Premultiply alpha so semi-transparent edges blend cleanly
          // against the destination. Un-premultiply at the end.
          const fa = sa / 255;
          r += sr * fa;
          g += sg * fa;
          b += sb * fa;
          a += sa;
          n += 1;
        }
      }
      if (n === 0) continue;
      const aAvg = a / n;
      const off = (y * size + x) * 4;
      if (aAvg === 0) {
        out.data[off] = 0;
        out.data[off + 1] = 0;
        out.data[off + 2] = 0;
        out.data[off + 3] = 0;
      } else {
        const aFactor = (aAvg / 255) * n;
        out.data[off] = Math.round(r / aFactor);
        out.data[off + 1] = Math.round(g / aFactor);
        out.data[off + 2] = Math.round(b / aFactor);
        out.data[off + 3] = Math.round(aAvg);
      }
    }
  }
  return PNG.sync.write(out);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const png = downsample(size);
  const path = resolve(OUT_DIR, `icon-${size}.png`);
  writeFileSync(path, png);
  console.log(`wrote ${path} (${png.length} bytes)`);
}
