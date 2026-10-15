// Page watching and settling, shared by the smoke specs (through
// invariants.ts) and the fixture recorder (record.mjs). Plain JS with
// JSDoc types, so record.mjs runs on every Node the engines field
// allows, not only those that strip TypeScript types by default.
import { MISS_HEADER } from '../../scripts/preview/fixtures.mjs';

/**
 * @typedef {import('@playwright/test').Page} Page
 * @typedef {import('@playwright/test').Request} Request
 */

/**
 * @typedef {object} PageWatch
 * @property {string[]} consoleErrors
 * @property {string[]} fixtureMisses
 * @property {{ inflight: Set<Request>, lastActivity: number }} network
 *   The page's requests in flight, and when one last started or ended.
 */

// Chromium logs every non-2xx/failed fetch as a console error
// ("Failed to load resource: …"). For brreg calls those statuses are the
// API's contract (regnskap 500 for banks, 404 for an underenhet orgnr,
// the offline state), and the app's handling is asserted via data-state.
// Anything else logged at error level fails the page.
/**
 * @param {string} text
 * @param {string} url
 * @returns {boolean}
 */
function isBrregNetworkLog(text, url) {
  return (
    text.startsWith('Failed to load resource') &&
    (url.includes('/brreg/') || url.startsWith('https://data.brreg.no/'))
  );
}

/**
 * Call before navigation: collects console errors, CSP violations, fixture misses, requests in flight.
 * @param {Page} page
 * @returns {Promise<PageWatch>}
 */
export async function watchPage(page) {
  /** @type {PageWatch['network']} */
  const network = { inflight: new Set(), lastActivity: Date.now() };
  /** @type {PageWatch} */
  const watch = { consoleErrors: [], fixtureMisses: [], network };
  /**
   * @param {Request} req
   * @param {boolean} open
   */
  const track = (req, open) => {
    if (open) network.inflight.add(req);
    else network.inflight.delete(req);
    network.lastActivity = Date.now();
  };
  page.on('request', (req) => track(req, true));
  page.on('requestfinished', (req) => track(req, false));
  page.on('requestfailed', (req) => track(req, false));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (isBrregNetworkLog(msg.text(), msg.location().url)) return;
    watch.consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => watch.consoleErrors.push(`uncaught: ${err.message}`));
  page.on('response', (resp) => {
    if (resp.headers()[MISS_HEADER]) watch.fixtureMisses.push(resp.url());
  });
  // Runs before any page script, so no violation can slip past it.
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener(
      'securitypolicyviolation',
      (e) => {
        window.__cspViolations.push(
          `${e.violatedDirective}: ${e.blockedURI || 'inline'}${e.sample ? ` (${e.sample})` : ''}`,
        );
      },
      true,
    );
  });
  return watch;
}

const QUIET_MS = 500;

/**
 * Resolves once the page holds still: fonts loaded, no request in
 * flight for half a second, and the rendered text unchanged as long.
 * Not waitForLoadState('networkidle'): Playwright's networkidle can be
 * lost for good. Its 500 ms timer fires before the first subresource
 * request when a busy renderer commits the document that long before
 * parsing it; the requests' end cannot rearm the timer while networkidle
 * still counts as fired, and the load event then withdraws it.
 * @param {Page} page
 * @param {PageWatch} watch
 * @returns {Promise<void>}
 */
export async function settle(page, watch) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  let text = '';
  let textSince = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 100));
    const now = await page.evaluate(() => document.body.innerText);
    if (now !== text) [text, textSince] = [now, Date.now()];
    const quietSince = Math.max(textSince, watch.network.lastActivity);
    if (watch.network.inflight.size === 0 && Date.now() - quietSince >= QUIET_MS) return;
  }
}
