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
    await expect(app).toHaveAttribute('data-state', s.state);
    await page.waitForLoadState('networkidle');

    if (s.state === 'result') {
      await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
      if (s.surface === 'panel') {
        await expect(page.getByRole('tablist')).toBeVisible();
        await expect(page.getByRole('tab').first()).toBeVisible();
      }
    }

    await page.screenshot({
      path: join(testInfo.project.outputDir, 'screenshots', testInfo.project.name, `${s.name}.png`),
      fullPage: true,
    });
    await assertInvariants(page, watch);
  });
}
