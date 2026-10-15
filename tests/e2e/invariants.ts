// Generic page invariants every smoke page must hold. They key on
// nothing but the platform (console, CSP events, layout boxes, the
// hidden attribute), so they survive a redesign; per-state checks live
// in the specs and use only stable hooks (main#app[data-state], roles).
import { expect, type Page } from '@playwright/test';
import type { PageWatch } from './settle.mjs';

// Watching and settling a page live in settle.mjs, which record.mjs
// shares without needing TypeScript.
export { settle, watchPage, type PageWatch } from './settle.mjs';

declare global {
  interface Window {
    __cspViolations: string[];
  }
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
