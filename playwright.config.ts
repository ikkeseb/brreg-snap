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

// Headless Chromium needs no display server. Where WSLg's compositor
// restarts after crashes, screenshots and the toolbar popup stalled
// until the test timed out unless DISPLAY and WAYLAND_DISPLAY were
// unset, so a headless run drops both on Linux. A headed run (the
// inspector, --headed, UI mode) keeps them: workers load this config
// again without the runner's flags, so the runner's verdict travels in
// the env, like the port above.
const headed = !!process.env.PWDEBUG || process.argv.some((arg) => arg === '--headed' || arg.startsWith('--ui'));
process.env.SMOKE_HEADED ??= headed ? '1' : '0';
if (process.platform === 'linux' && process.env.SMOKE_HEADED === '0') {
  delete process.env.DISPLAY;
  delete process.env.WAYLAND_DISPLAY;
}
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
    // Each test launches and closes its own Chromium inside the test
    // timeout, and under load the close alone has passed the 30 s
    // default; the side panel's first paint has passed expect's 5 s.
    { name: 'extension', testMatch: 'extension.spec.ts', timeout: 60_000, expect: { timeout: 15_000 } },
  ],
  webServer: {
    command: `node scripts/preview/serve.mjs --fixtures tests/e2e/fixtures --port ${process.env.SMOKE_PORT}`,
    url: `${baseURL}/shim.js`,
    reuseExistingServer: false,
  },
});
