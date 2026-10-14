import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so the extension build (outDir, the
// copy-static-assets plugin) never runs under vitest.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // tests/live (`pnpm test:live`) and tests/e2e (`pnpm smoke`) have
    // their own runners and must not run in the default `pnpm test`.
    exclude: ['tests/live/**', 'tests/e2e/**'],
    environment: 'node',
  },
});
