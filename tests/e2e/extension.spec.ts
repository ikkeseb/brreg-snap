// One real unpacked load of dist-chrome in Chromium: the service worker
// must start (a top-level throw in background.js never registers), the
// extension pages must render under the shipped CSP, and the flow a
// user runs must hold end to end: a toolbar click on a site tab, the
// popup resolving that tab, «Åpne i sidepanel» opening the side panel.
// The network is answered from the recorded fixtures throughout.
import { join, resolve } from 'node:path';
import { test as base, chromium, expect, type BrowserContext, type Worker } from '@playwright/test';
import { fixtureReply, loadFixtures } from '../../scripts/preview/fixtures.mjs';
import { assertInvariants, watchPage } from './invariants';
import { openNative, type NativeBrowser } from './native';

const dist = resolve('dist-chrome');
const fixtures = await loadFixtures(resolve('tests/e2e/fixtures'));

const PAGE_VIEWPORT = { width: 400, height: 800 };

const test = base.extend<{ context: BrowserContext; worker: Worker; extensionId: string; native: NativeBrowser }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature
  context: async ({}, use) => {
    // The bundled Chromium (channel 'chromium') runs extensions in
    // headless mode; branded Chrome ignores --load-extension.
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      // No emulated viewport: it sizes the browser window, and the
      // window bounds the toolbar popup (280 px wide under a 400 px
      // viewport on Linux). The page tests set their own size.
      viewport: null,
      args: [
        `--disable-extensions-except=${dist}`,
        `--load-extension=${dist}`,
        // Headless Chromium's default 800x600 screen squeezes the
        // toolbar popup the same way.
        '--screen-info={1920x1200}',
      ],
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
  // The popup and the side panel, which are not Playwright pages. The
  // invariants are asserted on the way out, so a test that stopped
  // early still names the unrecorded request or the error behind it.
  native: async ({ context }, use) => {
    const native = await openNative(context, fixtures);
    await use(native);
    expect.soft(native.fixtureMisses, 'invariant: every brreg request has a recorded fixture').toEqual([]);
    expect.soft(native.problems, 'invariant: zero console errors, uncaught exceptions and CSP violations').toEqual([]);
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
  await page.setViewportSize(PAGE_VIEWPORT);
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
// so it settles on the empty state (manual search). The result state
// is the toolbar-click test below.
test('popup page renders', async ({ context, extensionId }, testInfo) => {
  const page = await context.newPage();
  await page.setViewportSize(PAGE_VIEWPORT);
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

// Stands in for the site, so no request reaches dnb.no. The title
// rides into the resolver as a word-boundary hint; a single word equal
// to the host label can never add a name query, so only the recorded
// requests fire whatever the resolver makes of the candidates.
const SITE_STUB = '<!doctype html><html lang="nb"><title>DNB</title><h1>DNB</h1></html>';

// The real flow: the toolbar click grants activeTab on the site tab,
// the popup reads that tab and resolves its host, and a trusted click
// on «Åpne i sidepanel» carries the gesture chrome.sidePanel.open
// requires. Neither document is a Playwright Page (tests/e2e/native.ts).
test('toolbar click resolves the tab and opens the side panel', async ({ context, extensionId, native }, testInfo) => {
  const shots = join(testInfo.project.outputDir, 'screenshots', 'extension');
  await context.route('https://www.dnb.no/**', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: SITE_STUB }),
  );
  // The install opens the welcome tab on its own schedule; opened after
  // the site tab it would take the focus the popup reads.
  await expect.poll(() => context.pages().some((p) => p.url().includes('/welcome/welcome.html'))).toBe(true);
  const site = await context.newPage();
  await site.goto('https://www.dnb.no/');
  await site.bringToFront();

  await native.triggerAction(extensionId, site);
  const popup = await native.target('/popup/popup.html');
  await expect.poll(() => popup.evaluate('document.querySelector("main#app")?.dataset.state')).toBe('result');
  expect(await popup.evaluate('document.body.dataset.answer')).toBe('ok');
  expect(await popup.evaluate('document.querySelector("h1")?.textContent')).toBe('DNB BANK ASA');
  await expect
    .poll(() => popup.evaluate<string>('document.querySelector("main#app").innerText'))
    .toContain('dnb.no er registrert hjemmeside');
  await popup.settle();
  // The popup sizes itself to its content: its design width, inside
  // the 600 px a browser gives a popup.
  expect(await popup.evaluate('innerWidth'), 'popup width').toBe(380);
  expect(await popup.evaluate('document.documentElement.scrollHeight'), 'popup height').toBeLessThanOrEqual(600);
  await popup.screenshot(join(shots, 'popup-toolbar-dnb.png'));

  await popup.click('.actions a.btn--primary');
  const panel = await native.target('/details/details.html?orgnr=984851006');
  // A side panel, not a tab: Playwright would hold a tab as a Page.
  expect(context.pages().filter((p) => p.url().includes('/details/'))).toEqual([]);
  await expect.poll(() => panel.evaluate('document.querySelector("main#app")?.dataset.state')).toBe('result');
  expect(await panel.evaluate('document.querySelector("h1")?.textContent')).toBe('DNB BANK ASA');
  await panel.settle();
  await panel.screenshot(join(shots, 'sidepanel-dnb.png'));
});
