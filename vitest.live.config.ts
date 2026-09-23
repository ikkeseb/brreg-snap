import { defineConfig } from 'vitest/config';

// `pnpm test:live`: the weekly live-contract canary (tests/live/**).
// Hits data.brreg.no for real, so it is never part of `pnpm test` or
// `pnpm verify` (vitest.config.ts excludes tests/live/**). Runs weekly in
// .github/workflows/canary.yml; see docs/notes/brreg-api.md § live-canary.
export default defineConfig({
  test: {
    include: ['tests/live/**/*.test.ts'],
    environment: 'node',
    // One file at a time: every request goes through the polite queue in
    // tests/live/helpers/live.ts, which is per worker.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One retry absorbs a network blip; a real contract break fails twice.
    retry: 1,
    // Every test name in the log, and the corpus ledger (console output)
    // even where vitest would pick a quieter reporter.
    reporters: ['verbose'],
  },
});
