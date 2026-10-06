// Browser smoke (`pnpm smoke`): tests/e2e/. Not part of `pnpm verify` or
// the pre-push hook (it needs a browser); CI runs it as its own job.
import { createServer } from 'node:net';
import { defineConfig, type Project } from '@playwright/test';

// A free loopback port for the fixture server. Worker processes load
// this config again; the env var keeps them on the runner's port.
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      srv.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}
process.env.SMOKE_PORT ??= String(await freePort());
const baseURL = `http://127.0.0.1:${process.env.SMOKE_PORT}`;

const themes = ['dark', 'light'] as const;
const harness = (name: string, tag: string, width: number, height: number): Project[] =>
  themes.map((theme) => ({
    name: `${name}-${theme}`,
    testMatch: 'harness.spec.ts',
    grep: new RegExp(tag),
    use: { viewport: { width, height }, colorScheme: theme },
  }));

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: { baseURL },
  projects: [
    ...harness('popup', '@popup', 380, 600),
    ...harness('panel-320', '@panel', 320, 800),
    // The width Chrome opens its side panel at.
    ...harness('panel-360', '@panel', 360, 800),
    ...harness('panel-400', '@panel', 400, 800),
    // Real unpacked load of dist-chrome (own persistent context): the
    // pages, then a toolbar click through the popup to the side panel.
    { name: 'extension', testMatch: 'extension.spec.ts' },
  ],
  webServer: {
    command: `node scripts/preview/serve.mjs --fixtures tests/e2e/fixtures --port ${process.env.SMOKE_PORT}`,
    url: `${baseURL}/shim.js`,
    reuseExistingServer: false,
  },
});
