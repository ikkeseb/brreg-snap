import { ESLint, type Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { srcSecurityConfigs, srcSecurityRules } from '../eslint.config.js';

// The src security rules in eslint.config.js (AGENTS.md § Security
// constraints). Each snippet is linted as if it were the content of an
// existing src file. The rules need no type information, so the cases
// run through `fast`: the very blocks the real config spreads in
// (srcSecurityConfigs, same globs, same rule objects) behind the
// TypeScript parser without a project. That keeps each case a plain
// parse instead of a type-aware lint. `real` is the config `pnpm lint`
// uses; the canaries, the file-type cases and the rule comparison at
// the end hold the two together, so a drift in globs, rule options or
// the type-aware setup still fails here. Only the security rules'
// findings count.

const SECURITY_RULES = new Set(Object.keys(srcSecurityRules));

const fast = new ESLint({
  cwd: process.cwd(),
  overrideConfigFile: true,
  overrideConfig: [
    { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
    ...srcSecurityConfigs,
  ],
});
const real = new ESLint({ cwd: process.cwd() });

async function findings(
  code: string,
  filePath = 'src/lib/orgnr.ts',
  eslint = fast,
): Promise<string[]> {
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

// These need no type information in the real config either, so they run
// through `real`: a later block or ignore that exempts one extension fails here.
const NOT_TS = ['js', 'mjs', 'cjs', 'jsx', 'tsx', 'mts', 'cts'].map((ext) => `src/lib/probe.${ext}`);

describe('src is TypeScript only', () => {
  it.each(NOT_TS)('rejects %s (real config)', async (file) => {
    expect(await findings('export const x = 1;\n', file, real)).toContain(
      'no-restricted-syntax: src is TypeScript only: use a .ts file.',
    );
  });
});

describe('the fast path stays the real config', () => {
  // Type-aware: the first lint builds the TypeScript program cold, about
  // a second on a quiet machine and several on a loaded one.
  const typeAware = { timeout: 20_000 };

  // One per rule family, linted through `real` exactly as `pnpm lint`
  // would: the named rule must fire, and `fast` must report the same.
  // (The TypeScript-only family already runs through `real` above.)
  it.each([
    ['no-eval', 'eval', 'src/lib/orgnr.ts', header + 'eval(v);'],
    ['no-eval', 'indirect eval', 'src/lib/orgnr.ts', header + '(0, eval)(v);'],
    ['no-new-func', 'new Function', 'src/lib/orgnr.ts', header + 'new Function(v);'],
    ['no-restricted-globals', 'aliased Function', 'src/lib/orgnr.ts', header + 'const F = Function; void F;'],
    ['no-restricted-syntax', 'an HTML sink', 'src/lib/orgnr.ts', header + 'el.innerHTML = v;'],
    ['no-restricted-syntax', '.constructor', 'src/lib/orgnr.ts', header + 'void (() => undefined).constructor;'],
    ['no-restricted-syntax', 'a package import', 'src/lib/orgnr.ts', "import x from 'not-a-dependency'; void x;"],
  ])('real config: %s fires on %s', typeAware, async (rule, _name, file, code) => {
    const got = await findings(code, file, real);
    expect(got.some((f) => f.startsWith(`${rule}: `))).toBe(true);
    expect(await findings(code, file)).toEqual(got);
  });

  it('real config: a clean src file has no findings', typeAware, async () => {
    expect(
      await findings(header + "el.textContent = v; el.setAttribute('aria-label', v);", 'src/lib/orgnr.ts', real),
    ).toEqual([]);
  });

  // What the computed config feeds the security rules: their settings,
  // and for the .ts paths (whose cases run through `fast`) everything
  // else that changes how they behave, such as globals (which scope-aware
  // rules like no-eval consult), sourceType, linterOptions and settings.
  // The parser and its options differ on purpose; plugins only add rules.
  // The non-.ts paths compare rules only: their cases run through `real`,
  // and the real config gives them the tooling's Node globals.
  async function computed(eslint: ESLint, file: string, full: boolean) {
    // undefined when the file is ignored or matches no block.
    const config = (await eslint.calculateConfigForFile(file)) as Linter.Config | undefined;
    expect(config).toBeDefined();
    const rules = Object.fromEntries(
      Object.entries(config?.rules ?? {}).filter(([id]) => SECURITY_RULES.has(id)),
    );
    if (!full) return { rules };
    const { parser: _parser, parserOptions: _parserOptions, ...languageOptions } = config?.languageOptions ?? {};
    const { rules: _rules, plugins: _plugins, languageOptions: _languageOptions, ...rest } = config ?? {};
    return { rules, languageOptions, ...rest };
  }

  it.each([
    ...['src/lib/orgnr.ts', 'src/details/main.ts'].map((file) => [file, true] as const),
    ...NOT_TS.map((file) => [file, false] as const),
  ])('applies the same security config as the real config to %s', async (file, full) => {
    const [f, r] = await Promise.all([computed(fast, file, full), computed(real, file, full)]);
    expect(f.rules).not.toEqual({});
    expect(f).toEqual(r);
  });
});
