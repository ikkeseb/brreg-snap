import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so the extension build (outDir, the
// copy-static-assets plugin) never runs under vitest.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Future suites with their own commands: live-API canary and browser
    // smoke. Neither may run in the default `pnpm test`.
    exclude: ['tests/live/**', 'tests/e2e/**'],
    environment: 'node',
  },
});
