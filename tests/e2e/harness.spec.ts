// Browser smoke on the preview harness (scripts/preview/serve.mjs in
// fixture mode): every state in states.mjs, per project (surface ×
// width × color scheme, playwright.config.ts). Screenshots land in
// test-results/screenshots/<project>/<state>.png.
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertInvariants, watchPage } from './invariants';
import { STATES } from './states.mjs';

for (const s of STATES) {
  test(s.name, { tag: `@${s.surface}` }, async ({ page }, testInfo) => {
    const watch = await watchPage(page);
    if (s.offline) await page.route('**/brreg/**', (route) => route.abort('internetdisconnected'));

    await page.goto(s.path);
    const app = page.locator('main#app');
    if (s.actions) {
      await expect(app).toHaveAttribute('data-state', s.before ?? 'result');
      for (const a of s.actions) {
        if (a.type === 'click') await page.click(a.selector);
        else await page.fill(a.selector, a.text ?? '');
      }
    }
    await expect(app).toHaveAttribute('data-state', s.state);
    await page.waitForLoadState('networkidle');
    if (s.state === 'search') await expect(page.locator('.results button.recent').first()).toBeVisible();

    if (s.state === 'result') {
      await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
      if (s.surface === 'panel') {
        await expect(page.getByRole('tablist')).toBeVisible();
        await expect(page.getByRole('tab').first()).toBeVisible();
        // The tab region holds a viewport's min-height only after a
        // landing (?tab= other than the default) or a switch; a plain
        // load has no scrollbar.
        if (!s.actions) {
          const held = await page.locator('.tab-panels').evaluate((r) => r.classList.contains('tab-panels--held'));
          expect.soft(held, 'tab region held only after a landing').toBe(/tab=(?!oversikt)/.test(s.path));
        }
      }
    }

    // A browser caps a popup at 600 px (docs/notes/ui.md § popup-budget),
    // and a verdict's key word never runs out of its frame: the word is
    // one inline-block, so its box is compared with the answer's content
    // box (the frame minus border and padding); a word wider than the
    // line would otherwise just poke out without any scroll overflow.
    if (s.surface === 'popup') {
      const height = await page.evaluate(() => document.body.getBoundingClientRect().height);
      expect.soft(height, 'popup within the 600 px budget').toBeLessThanOrEqual(600);
      // The no-site empty state: the masthead is the mark alone.
      if (!s.path.includes('taburl=') && s.state === 'empty') await expect.soft(page.locator('.mast__site')).toHaveCount(0);
    }
    const stampOverflow = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.stamp-word')].some((w) => {
        const box = w.closest<HTMLElement>('.answer');
        if (!box) return true;
        const cs = getComputedStyle(box);
        const b = box.getBoundingClientRect();
        const r = w.getBoundingClientRect();
        const left = b.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
        const right = b.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
        return r.left < left - 0.5 || r.right > right + 0.5 || w.scrollWidth > w.clientWidth;
      }),
    );
    expect.soft(stampOverflow, 'verdict key word inside its frame').toBe(false);

    // Drawn in tokens only, wherever the part is on screen: the search
    // field has no engine «×» (Chromium paints it blue), the equity
    // bar's track is the hairline, not the skeleton grey, and «Kopier
    // sammendrag» sits right whether or not flags come before it.
    const look = await page.evaluate(() => {
      const rgb = (hex: string): string => {
        const n = parseInt(hex.trim().slice(1), 16);
        return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
      };
      const cancelRule = [...document.styleSheets].some((sheet) =>
        [...sheet.cssRules].some(
          (r) =>
            r instanceof CSSStyleRule &&
            r.selectorText.includes('::-webkit-search-cancel-button') &&
            r.style.getPropertyValue('appearance') === 'none',
        ),
      );
      const track = document.querySelector('.equity__track');
      const btn = document.querySelector('.ident__row .text-btn');
      const row = btn?.closest('.ident__row');
      return {
        search: document.querySelector('input[type=search]') !== null,
        cancelRule,
        track: track && {
          bg: getComputedStyle(track).backgroundColor,
          rule: rgb(getComputedStyle(document.body).getPropertyValue('--rule')),
        },
        copyGap: btn && row ? row.getBoundingClientRect().right - btn.getBoundingClientRect().right : null,
      };
    });
    if (look.search) expect.soft(look.cancelRule, 'search field: the engine clear button is hidden').toBe(true);
    if (look.track) expect.soft(look.track.bg, 'equity track in --rule').toBe(look.track.rule);
    if (look.copyGap !== null) expect.soft(Math.abs(look.copyGap), '«Kopier sammendrag» pinned right').toBeLessThan(1);

    await page.screenshot({
      path: join(testInfo.project.outputDir, 'screenshots', testInfo.project.name, `${s.name}.png`),
      fullPage: true,
    });

    // Row-shaped buttons underline on hover; the back bar too. The panel
    // keeps a hidden history «Tilbake» in the DOM beside the search
    // view's, so take the one on screen.
    const back = page.locator('button.back').filter({ visible: true }).first();
    if (await back.isVisible()) {
      await back.hover();
      const deco = await back.locator('b').evaluate((b) => getComputedStyle(b).textDecorationLine);
      expect.soft(deco, 'back bar underlines on hover').toContain('underline');
    }
    await assertInvariants(page, watch);
  });
}
