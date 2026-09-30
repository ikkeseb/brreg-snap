import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

// The src security rules in eslint.config.js (CLAUDE.md § Security
// constraints), run through the REAL config: each snippet is linted as
// if it were the content of an existing src file, so the type-aware
// setup, the file globs and the rule options are all the ones `pnpm
// lint` uses. Only the security rules' findings count here.

const SECURITY_RULES = new Set([
  'no-eval',
  'no-new-func',
  'no-restricted-globals',
  'no-restricted-syntax',
]);

let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: process.cwd() });
});

async function findings(code: string, filePath = 'src/lib/orgnr.ts'): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((m) => m.fatal === true || SECURITY_RULES.has(m.ruleId ?? ''))
    .map((m) => `${m.ruleId ?? 'fatal'}: ${m.message}`);
}

const header = 'declare const el: HTMLElement; declare const v: string;\n';

describe('src security lint: HTML sinks', () => {
  it.each([
    ['property assignment', 'el.innerHTML = v;'],
    ['outerHTML', 'el.outerHTML = v;'],
    ['computed literal', "el['innerHTML'] = v;"],
    ['computed template', 'el[`innerHTML`] = v;'],
    ['Object.assign', 'Object.assign(el, { innerHTML: v });'],
    ['Object.assign shorthand', 'const innerHTML = v; Object.assign(el, { innerHTML });'],
    ['Reflect.set', "Reflect.set(el, 'innerHTML', v);"],
    ['Object.defineProperty', "Object.defineProperty(el, 'innerHTML', { value: v });"],
    ['insertAdjacentHTML', "el.insertAdjacentHTML('beforeend', v);"],
    ['computed insertAdjacentHTML', "el['insertAdjacentHTML']('beforeend', '<b>hi</b>');"],
    ['srcdoc attribute', "document.createElement('iframe').setAttribute('srcdoc', v);"],
    ['srcdoc property', "document.createElement('iframe').srcdoc = v;"],
    ['setHTMLUnsafe', "(el as unknown as { setHTMLUnsafe(s: string): void }).setHTMLUnsafe(v);"],
    ['document.write', 'document.write(v);'],
    ['document.writeln', 'document.writeln(v);'],
    ['computed document.write', "document['write'](v);"],
    ['template document.write', 'document[`write`](v);'],
    ['window.document.write', 'window.document.write(v);'],
    ['on* attribute', "el.setAttribute('onclick', v);"],
    ['on* attribute, any case', "el.setAttribute('onMouseOver', v);"],
    ['on* attribute (NS)', "el.setAttributeNS(null, 'onload', v);"],
    ['on* key for an attribute helper', 'const attrs = { onclick: v }; void attrs;'],
  ])('rejects %s', async (_name, code) => {
    expect(await findings(header + code)).not.toEqual([]);
  });

  it('allows the safe DOM API', async () => {
    expect(
      await findings(
        header +
          "el.textContent = v; el.setAttribute('aria-label', v); el.replaceChildren();\n" +
          'const opts = { onChoose: () => undefined }; void opts;\n' +
          "void 'writing'; const s = { write: 1 }; void s.write;",
      ),
    ).toEqual([]);
  });
});

describe('src security lint: code generation', () => {
  it.each([
    ['eval', 'eval(v);'],
    ['indirect eval', '(0, eval)(v);'],
    ['new Function', 'new Function(v);'],
    ['Function call', 'Function(v);'],
    ['Reflect.construct(Function, ...)', 'Reflect.construct(Function, [v]);'],
    ['aliased Function', 'const F = Function; void F;'],
    ['globalThis.Function', 'void new globalThis.Function(v);'],
    ["globalThis['Function']", "void globalThis['Function'];"],
    ['Reflect.get of eval', "void Reflect.get(globalThis, 'eval');"],
    ['.constructor of a function', 'void (() => undefined).constructor;'],
    ["['constructor']", "void (() => undefined)['constructor'];"],
  ])('rejects %s', async (_name, code) => {
    expect(await findings(header + code)).not.toEqual([]);
  });

  it('allows a class constructor', async () => {
    expect(
      await findings('export class A { constructor(readonly x: number) {} }'),
    ).toEqual([]);
  });
});

describe('src security lint: zero runtime dependencies', () => {
  it.each([
    ['bare import', "import x from 'happy-dom'; void x;"],
    ['named import', "import { Window } from 'happy-dom'; void Window;"],
    ['mixed type and value specifiers', "import { type Window, Browser } from 'happy-dom'; void Browser;"],
    ['side-effect import', "import 'happy-dom';"],
    ['namespace import', "import * as hd from 'happy-dom'; void hd;"],
    ['re-export', "export { Window } from 'happy-dom';"],
    ['export *', "export * from 'happy-dom';"],
    ['non-literal dynamic import', "declare const m: string; void import(m);"],
    ['bare dynamic import', "void import('happy-dom');"],
  ])('rejects %s', async (_name, code) => {
    expect(await findings(code)).not.toEqual([]);
  });

  it.each([
    ['import type', "import type { Window } from 'happy-dom'; export type W = Window;"],
    ['inline type specifiers', "import { type Window } from 'happy-dom'; export type W = Window;"],
    ['export type', "export type { Window } from 'happy-dom';"],
    ['inline type re-export', "export { type Window } from 'happy-dom';"],
    ['relative import', "import { isValidOrgnr } from './mod11'; void isValidOrgnr;"],
  ])('allows %s', async (_name, code) => {
    expect(await findings(code)).toEqual([]);
  });
});

describe('src is TypeScript only', () => {
  it.each(['src/lib/probe.js', 'src/lib/probe.mjs', 'src/lib/probe.cjs', 'src/lib/probe.tsx', 'src/lib/probe.jsx', 'src/lib/probe.mts'])(
    'rejects %s',
    async (file) => {
      expect(await findings('export const x = 1;\n', file)).not.toEqual([]);
    },
  );
});
