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
