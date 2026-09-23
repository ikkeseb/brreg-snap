// ESLint flat config (ESLint 10 ignores .eslintrc.*). `pnpm lint` runs it
// over src, tests, scripts and the config files with --max-warnings 0.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Node's globals for the .js/.mjs tooling files (no `globals` dependency
// for a handful of names).
const nodeGlobals = {
  console: 'readonly',
  process: 'readonly',
  URL: 'readonly',
  fetch: 'readonly',
  setTimeout: 'readonly',
  URLSearchParams: 'readonly',
  clearTimeout: 'readonly',
};

// The src security rules, exported for tests/lint-security.test.ts.
// Core ESLint only. The selectors are static: they catch every spelling
// of a forbidden name the source can write down literally (el.x, el['x'],
// el[`x`], { x: v }, Reflect.set(el, 'x'), setAttribute('x')), not a
// name computed at runtime ('inner' + 'HTML'). The build-graph guard and
// verify:dist are the backstops for what reaches the bundle.
const exactName = (names) => `/^(${names})$/`;
// Properties and attributes that parse or run markup.
const HTML_SINKS = exactName(
  'innerHTML|outerHTML|srcdoc|insertAdjacentHTML|setHTMLUnsafe|createContextualFragment',
);
// Ways to reach the Function constructor or eval without writing a call
// no-eval/no-new-func recognise.
const CODEGEN_NAMES = exactName('Function|constructor|eval');
const WRITE = exactName('write|writeln');
const noSink = 'No HTML sinks: build nodes with createElement/textContent/replaceChildren.';
const noCodegen = 'No runtime code generation: no eval, no Function constructor (direct or via .constructor).';
const noDeps = 'Zero runtime deps: src may only import relative paths (type-only imports excepted).';
// Import/export from a non-relative specifier.
const bare = '[source.value=/^(?!\\.\\.?\\/)/]';

export const srcSecurityRules = {
  'no-eval': 'error',
  'no-new-func': 'error',
  'no-restricted-globals': ['error', { name: 'Function', message: noCodegen }],
  'no-restricted-syntax': [
    'error',
    // A sink name as an identifier (el.innerHTML, { innerHTML: v }) or as
    // an exact string (el['innerHTML'], Reflect.set(el, 'innerHTML', v),
    // setAttribute('srcdoc', v)), reads included.
    { selector: `Identifier[name=${HTML_SINKS}]`, message: noSink },
    { selector: `Literal[value=${HTML_SINKS}]`, message: noSink },
    {
      selector: `TemplateLiteral[expressions.length=0][quasis.0.value.cooked=${HTML_SINKS}]`,
      message: noSink,
    },
    {
      selector:
        "MemberExpression:matches([object.name='document'], [object.property.name='document'])" +
        `:matches([property.name=${WRITE}], [property.value=${WRITE}], [property.quasis.0.value.cooked=${WRITE}])`,
      message: 'No document.write.',
    },
    // Inline event-handler attributes compile their value as code.
    {
      selector:
        "CallExpression:matches([callee.property.name=/^setAttribute(NS)?$/], [callee.property.value=/^setAttribute(NS)?$/])" +
        ' > :matches(Literal[value=/^on/i], TemplateLiteral[quasis.0.value.cooked=/^on/i]).arguments',
      message: 'No inline event-handler attributes: use addEventListener.',
    },
    // ...including through an attribute-map helper (dom.ts svgEl).
    {
      selector: 'Property > :matches(Identifier[name=/^on[a-z]+$/], Literal[value=/^on/i]).key',
      message: 'No inline event-handler attributes: use addEventListener.',
    },
    // The Function constructor or eval by another name: globalThis.Function,
    // fn.constructor, globalThis['Function'], Reflect.get(globalThis, 'eval').
    {
      selector: `MemberExpression[computed=false] > Identifier.property[name=${CODEGEN_NAMES}]`,
      message: noCodegen,
    },
    { selector: `Literal[value=${CODEGEN_NAMES}]`, message: noCodegen },
    {
      selector: `TemplateLiteral[expressions.length=0][quasis.0.value.cooked=${CODEGEN_NAMES}]`,
      message: noCodegen,
    },
    // Zero runtime dependencies: src imports only its own files. A
    // declaration from a package passes only when it is type-only as a
    // whole or specifier by specifier (TypeScript erases it).
    { selector: `ImportDeclaration[importKind!='type']${bare}[specifiers.length=0]`, message: noDeps },
    {
      selector:
        `ImportDeclaration[importKind!='type']${bare}` +
        ":has(ImportDefaultSpecifier, ImportNamespaceSpecifier, ImportSpecifier[importKind!='type'])",
      message: noDeps,
    },
    { selector: `ExportAllDeclaration[exportKind!='type']${bare}`, message: noDeps },
    { selector: `ExportNamedDeclaration[exportKind!='type']${bare}[specifiers.length=0]`, message: noDeps },
    {
      selector: `ExportNamedDeclaration[exportKind!='type']${bare}:has(ExportSpecifier[exportKind!='type'])`,
      message: noDeps,
    },
    {
      selector: 'ImportExpression[source.type!="Literal"], ImportExpression[source.value=/^(?!\\.\\.?\\/)/]',
      message: 'Zero runtime deps: dynamic import() must be a relative literal path.',
    },
  ],
};

export default defineConfig(
  {
    ignores: [
      'dist/',
      'dist-firefox/',
      'dist-chrome/',
      'web-ext-artifacts/',
      'node_modules/',
      'coverage/',
      '.claude/',
      // Preview harness (browser shim + dev server): not linted yet.
      'scripts/preview/',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // Extension source: security invariants as lint rules (CLAUDE.md
  // § Security constraints). Brreg text is written by the registrants
  // themselves, so HTML sinks are the realistic injection surface.
  {
    files: ['src/**/*.ts'],
    rules: srcSecurityRules,
  },
  // src is TypeScript only. Any other script format would skip the
  // typecheck and the rules above, so its mere existence fails the lint
  // (the build-graph guard in vite.config.ts also refuses to bundle it).
  {
    files: ['src/**/*.{js,mjs,cjs,jsx,tsx,mts,cts}'],
    languageOptions: { parser: tseslint.parser },
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'Program', message: 'src is TypeScript only: use a .ts file.' },
      ],
    },
  },
  // Root config files live in tsconfig.node.json, which the project
  // service can't discover (it only finds files named tsconfig.json).
  {
    files: ['vite.config.ts', 'vitest.config.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './tsconfig.node.json',
      },
    },
  },
  // Tests: fakes and fixtures are loosely typed by design. src stays strict.
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  // Plain-JS tooling (no type information).
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: nodeGlobals },
  },
);
