import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ICONS, iconPath, pathData, readMaster, UI_MARK } from '../scripts/generate-icons.mjs';
import { MARK } from '../src/lib/view/mark-data.js';

// The brand pipeline (assets/brand/README.md): `pnpm icons` renders
// public/icons/ and src/lib/view/mark-data.ts from the masters. These
// pin its outputs to what the manifests reference and to the masters,
// so a swapped master that was not regenerated, or a manifest icon the
// generator does not write, fails here.

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

  it('the in-UI mark carries the masters it names (regenerate after a swap)', () => {
    expect(MARK.drawings.map((m) => [m.source, m.scale])).toEqual(
      UI_MARK.map((m) => [m.source, m.scale]),
    );
    for (const drawing of MARK.drawings) {
      expect(drawing.d).toEqual(pathData(readMaster(drawing.source)));
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
