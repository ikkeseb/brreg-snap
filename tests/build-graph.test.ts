import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { moduleViolation } from '../scripts/build-graph.mjs';

// The decision behind the build-graph guard in vite.config.ts. The
// plugin itself is demonstrated against a real build (a relative
// node_modules import and an .mjs HTML entry both fail `pnpm build`).

const src = resolve('src');
const at = (p: string): string => resolve(p);

describe('build-graph guard', () => {
  it.each([
    'src/lib/orgnr.ts',
    'src/popup/popup.html',
    'src/popup/popup.css',
    'src/icons/mark.svg',
  ])('allows %s', (p) => {
    expect(moduleViolation(at(p), src)).toBeNull();
  });

  it("allows Vite's own helpers", () => {
    expect(moduleViolation('\0vite/modulepreload-polyfill.js', src)).toBeNull();
    expect(moduleViolation('\0vite/preload-helper.js', src)).toBeNull();
  });

  it.each([
    ['node_modules', 'node_modules/happy-dom/lib/utilities/StringUtility.js', 'outside src/'],
    ['pnpm store', 'node_modules/.pnpm/happy-dom@20.14.5/node_modules/happy-dom/lib/index.ts', 'outside src/'],
    ['tests', 'tests/helpers/fake.ts', 'outside src/'],
    ['scripts', 'scripts/build-graph.mjs', 'outside src/'],
    ['a sibling named like src', 'src-evil/x.ts', 'outside src/'],
    ['an .mjs entry', 'src/popup/probe.mjs', 'not an allowed source format'],
    ['a .js file', 'src/lib/x.js', 'not an allowed source format'],
    ['a .tsx file', 'src/lib/x.tsx', 'not an allowed source format'],
    ['JSON', 'src/lib/data.json', 'not an allowed source format'],
  ])('rejects %s', (_name, p, why) => {
    expect(moduleViolation(at(p), src)).toContain(why);
  });

  it.each([
    ['a URL import', 'https://example.com/x.js', 'not a local file'],
    ['a bare external', 'happy-dom', 'not a local file'],
    ['another virtual module', '\0rolldown/runtime.js', 'virtual module'],
    ['a query import', `${at('src/lib/orgnr.ts')}?raw`, 'query-suffixed'],
  ])('rejects %s', (_name, id, why) => {
    expect(moduleViolation(id, src)).toContain(why);
  });
});
