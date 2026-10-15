import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  ICONS,
  iconPath,
  LOCK_FILE,
  lockedPaths,
  pathData,
  readMaster,
  sha256,
  UI_MARK,
} from '../scripts/generate-icons.mjs';
import { MARK } from '../src/lib/view/mark-data.js';

// The brand pipeline (assets/brand/README.md): `pnpm icons` renders
// public/icons/ and src/lib/view/mark-data.ts from the masters and
// records the sha256 of every master and output in icons.lock.json.
// These check that the manifests reference only icons the generator
// writes, and that every master and output is byte-for-byte the file
// the last `pnpm icons` run read or wrote (the lock), so a swapped
// master or a hand-edited output that was not regenerated fails here.
// Nothing is rendered: whether the PNGs look right is a human check.

interface IconManifest {
  icons?: Record<string, string>;
  action?: { default_icon?: Record<string, string> };
  sidebar_action?: { default_icon?: Record<string, string> };
}

const manifests = {
  firefox: JSON.parse(readFileSync('public/manifest.firefox.json', 'utf8')) as IconManifest,
  chrome: JSON.parse(readFileSync('public/manifest.chrome.json', 'utf8')) as IconManifest,
};

// Width and height from the PNG's IHDR chunk.
function pngSize(file: string): [number, number] {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

const generated = Object.keys(ICONS).map(Number);

describe.each(['firefox', 'chrome'] as const)('manifest.%s icons', (target) => {
  const m = manifests[target];
  const maps = [m.icons, m.action?.default_icon, m.sidebar_action?.default_icon].filter(
    (map): map is Record<string, string> => map !== undefined,
  );

  it('every icon it references is one the generator writes, at that size', () => {
    for (const map of maps) {
      for (const [size, path] of Object.entries(map)) {
        expect(generated).toContain(Number(size));
        expect(path).toBe(iconPath(Number(size)));
      }
    }
  });

  it('its icons map lists every generated size', () => {
    expect(Object.keys(m.icons ?? {}).map(Number).sort((a, b) => a - b)).toEqual(generated);
  });
});

describe('generated files', () => {
  it(`every master and output matches ${LOCK_FILE} (else run pnpm icons)`, () => {
    const lock = JSON.parse(readFileSync(LOCK_FILE, 'utf8')) as Record<string, string>;
    expect(Object.keys(lock), `${LOCK_FILE} is out of date: run pnpm icons`).toEqual(lockedPaths());
    const stale = lockedPaths().filter((path) => sha256(path) !== lock[path]);
    expect(stale, `differs from ${LOCK_FILE}: run pnpm icons (then review the PNGs)`).toEqual([]);
  });

  it.each(generated)('public/icons/icon-%i.png exists at its size', (size) => {
    expect(pngSize(`public/${iconPath(size)}`)).toEqual([size, size]);
  });

  it('every master the generator reads is committed and fill-only', () => {
    for (const file of new Set([...Object.values(ICONS), ...UI_MARK.map((m) => m.source)])) {
      expect(existsSync(`assets/brand/${file}`), file).toBe(true);
      const svg = readMaster(file);
      expect(pathData(svg).length, file).toBeGreaterThan(0);
      expect(svg, file).not.toMatch(/\bstroke\b|<filter|<text|<image|<metadata|sodipodi|inkscape/);
    }
  });

  it('the in-UI mark carries the paths of the master for each scale', () => {
    expect(MARK.drawings.map((m) => m.scale)).toEqual(UI_MARK.map((m) => m.scale));
    const source = new Map(UI_MARK.map((m) => [m.scale, m.source]));
    for (const drawing of MARK.drawings) {
      expect(drawing.d).toEqual(pathData(readMaster(source.get(drawing.scale)!)));
    }
  });

  // ui.md § masthead-mark: each masthead's content box is odd (40, 44,
  // 48 px less the 1 px rule), so only an odd slot centres on a whole
  // CSS px; each drawing sits on its own device-pixel grid.
  it('the in-UI mark lands on whole device pixels', () => {
    expect(Number.isInteger(MARK.width) && Number.isInteger(MARK.height)).toBe(true);
    expect(MARK.height % 2, 'the slot height must be odd').toBe(1);
    for (const m of MARK.drawings) {
      const px = [m.x, m.y, m.width, m.height].map((v) => v * m.scale);
      expect(px.every(Number.isInteger), `mark--x${m.scale} off its pixel grid`).toBe(true);
    }
  });

  it("the UI's --brand is the masters' colour", () => {
    const fills = new Set(
      Object.values(ICONS).flatMap((f) =>
        [...readMaster(f).matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]!.toUpperCase()),
      ),
    );
    expect(fills.size).toBe(1);
    const css = readFileSync('src/styles/brreg.css', 'utf8');
    const brand = [...css.matchAll(/--brand:\s*(#[0-9A-Fa-f]{6})/g)].map((m) => m[1]!.toUpperCase());
    expect(brand.length).toBeGreaterThan(0);
    for (const value of brand) expect(value).toBe([...fills][0]);
  });
});
