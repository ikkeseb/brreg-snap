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
    rules: {
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML)$/]",
          message: 'No HTML sinks: build nodes with createElement/textContent/replaceChildren.',
        },
        {
          selector:
            "AssignmentExpression > MemberExpression.left[property.value=/^(innerHTML|outerHTML)$/]",
          message: 'No HTML sinks: build nodes with createElement/textContent/replaceChildren.',
        },
        {
          selector: "CallExpression > MemberExpression.callee[property.name='insertAdjacentHTML']",
          message: 'No HTML sinks: build nodes with createElement/textContent.',
        },
        {
          selector:
            "CallExpression > MemberExpression.callee[object.name='document'][property.name=/^(write|writeln)$/]",
          message: 'No document.write.',
        },
        // Zero runtime dependencies: src imports only its own files.
        {
          selector: "ImportDeclaration[importKind!='type'][source.value=/^(?!\\.\\.?\\/)/]",
          message: 'Zero runtime deps: src may only import relative paths (type-only imports excepted).',
        },
        {
          selector:
            ":matches(ExportNamedDeclaration, ExportAllDeclaration)[exportKind!='type'][source.value=/^(?!\\.\\.?\\/)/]",
          message: 'Zero runtime deps: src may only re-export relative paths.',
        },
        {
          selector: 'ImportExpression[source.type!="Literal"], ImportExpression[source.value=/^(?!\\.\\.?\\/)/]',
          message: 'Zero runtime deps: dynamic import() must be a relative literal path.',
        },
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
