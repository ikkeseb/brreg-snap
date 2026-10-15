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
    // The gate runs while other work loads the machine (the pre-push
    // hook, a busy CI runner). A cold first test (a jsdom page, the
    // type-aware ESLint program, the release script's git fixture) takes
    // 1 to 3 s on a quiet machine and has passed 5 s under load, so the
    // limit is set to catch a hang, not to time a test.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
