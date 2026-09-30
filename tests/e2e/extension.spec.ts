// One real unpacked load of dist-chrome in Chromium: the service worker
// must start (a top-level throw in background.js never registers), and
// the extension pages must render under the shipped CSP with the
// network answered from the recorded fixtures.
import { join, resolve } from 'node:path';
import { test as base, chromium, expect, type BrowserContext, type Worker } from '@playwright/test';
import { fixtureReply, loadFixtures } from '../../scripts/preview/fixtures.mjs';
import { assertInvariants, watchPage } from './invariants';

const dist = resolve('dist-chrome');
const fixtures = await loadFixtures(resolve('tests/e2e/fixtures'));

const test = base.extend<{ context: BrowserContext; worker: Worker; extensionId: string }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature
  context: async ({}, use) => {
    // The bundled Chromium (channel 'chromium') runs extensions in
    // headless mode; branded Chrome ignores --load-extension.
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      viewport: { width: 400, height: 800 },
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    });
    await context.route('https://data.brreg.no/**', async (route) => {
      const url = new URL(route.request().url());
      const reply = fixtureReply(fixtures, url.pathname + url.search);
      await route.fulfill({ status: reply.status, headers: reply.headers, body: reply.body });
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    await use(context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker')));
  },
  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },
});

test('service worker runs to completion', async ({ worker }) => {
  // The worker target exists even when background.js throws at top
  // level; a listener registered during evaluation proves it ran.
  const ran = await worker.evaluate(() => {
    const { chrome } = globalThis as unknown as {
      chrome: { runtime: { onInstalled: { hasListeners(): boolean } } };
    };
    return chrome.runtime.onInstalled.hasListeners();
  });
  expect(ran, 'background.js evaluated and registered its listeners').toBe(true);
});

test('panel renders a company', async ({ context, extensionId }, testInfo) => {
  const page = await context.newPage();
  const watch = await watchPage(page);
  await page.goto(`chrome-extension://${extensionId}/details/details.html?orgnr=984851006`);
  await expect(page.locator('main#app')).toHaveAttribute('data-state', 'result');
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.screenshot({
    path: join(testInfo.project.outputDir, 'screenshots', 'extension', 'details-dnb.png'),
    fullPage: true,
  });
  await assertInvariants(page, watch);
});

// Opened as a tab, the popup's active tab is itself: no company host,
// so it settles on the empty state (manual search).
test('popup page renders', async ({ context, extensionId }, testInfo) => {
  const page = await context.newPage();
  const watch = await watchPage(page);
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await expect(page.locator('main#app')).toHaveAttribute('data-state', 'empty');
  await page.waitForLoadState('networkidle');
  await page.screenshot({
    path: join(testInfo.project.outputDir, 'screenshots', 'extension', 'popup.png'),
    fullPage: true,
  });
  await assertInvariants(page, watch);
});
