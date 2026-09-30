// Generic page invariants every smoke page must hold. They key on
// nothing but the platform (console, CSP events, layout boxes, the
// hidden attribute), so they survive a redesign; per-state checks live
// in the specs and use only stable hooks (main#app[data-state], roles).
import { expect, type Page } from '@playwright/test';
import { MISS_HEADER } from '../../scripts/preview/fixtures.mjs';

export interface PageWatch {
  consoleErrors: string[];
  fixtureMisses: string[];
}

declare global {
  interface Window {
    __cspViolations: string[];
  }
}

// Chromium logs every non-2xx/failed fetch as a console error
// ("Failed to load resource: …"). For brreg calls those statuses are the
// API's contract (regnskap 500 for banks, 404 for an underenhet orgnr,
// the offline state), and the app's handling is asserted via data-state.
// Anything else logged at error level fails the page.
function isBrregNetworkLog(text: string, url: string): boolean {
  return (
    text.startsWith('Failed to load resource') &&
    (url.includes('/brreg/') || url.startsWith('https://data.brreg.no/'))
  );
}

/** Call before navigation: collects console errors, CSP violations, fixture misses. */
export async function watchPage(page: Page): Promise<PageWatch> {
  const watch: PageWatch = { consoleErrors: [], fixtureMisses: [] };
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

/** Asserts every invariant softly, so one run names all that broke. */
export async function assertInvariants(page: Page, watch: PageWatch): Promise<void> {
  expect.soft(watch.fixtureMisses, 'invariant: every brreg request has a recorded fixture').toEqual([]);
  expect.soft(watch.consoleErrors, 'invariant: zero console errors').toEqual([]);

  const report = await page.evaluate(() => {
    const describe = (el: Element) =>
      el.tagName.toLowerCase() +
      (el.id ? `#${el.id}` : '') +
      [...el.classList].map((c) => `.${c}`).join('');
    const root = document.documentElement;
    return {
      csp: window.__cspViolations,
      overflow: { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth },
      hiddenButRendered: [...document.querySelectorAll('[hidden]')]
        .filter((el) => getComputedStyle(el).display !== 'none')
        .map(describe),
    };
  });

  expect.soft(report.csp, 'invariant: zero securitypolicyviolation events').toEqual([]);
  expect
    .soft(report.overflow.scrollWidth, 'invariant: no horizontal overflow (documentElement.scrollWidth <= clientWidth)')
    .toBeLessThanOrEqual(report.overflow.clientWidth);
  expect.soft(report.hiddenButRendered, 'invariant: no [hidden] element is rendered').toEqual([]);
}
