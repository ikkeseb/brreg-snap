// @vitest-environment happy-dom
//
// The first-run page (src/welcome/welcome.ts) on the welcome.html roots:
// every section paints, the shortcut keys come from commands.getAll
// (a missing binding reads «ikke satt»), the pin instruction and the
// shortcut editor follow the engine, the examples are figures a screen
// reader is not told are lookups, and nothing leaves the page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DIST_ROOT } from '../scripts/manifest-invariants.mjs';
import { COPY } from '../src/lib/view/copy.js';
import { fakeBrowser, type FakeBrowser } from './helpers/fake-browser.js';

const W = COPY.welcome;

function mountRoots(): void {
  document.body.className = 'app app--welcome';
  const mast = document.createElement('header');
  mast.id = 'mast';
  const main = document.createElement('main');
  main.id = 'app';
  const foot = document.createElement('footer');
  foot.id = 'foot';
  document.body.replaceChildren(mast, main, foot);
}

type Binding = { name: string; shortcut: string };
const BOUND: Record<'firefox' | 'chrome', Binding[]> = {
  firefox: [
    { name: '_execute_action', shortcut: 'Alt+Shift+O' },
    { name: '_execute_sidebar_action', shortcut: 'Alt+Shift+S' },
  ],
  chrome: [
    { name: '_execute_action', shortcut: 'Alt+Shift+O' },
    { name: 'open-panel', shortcut: 'Alt+Shift+S' },
  ],
};

const fetchSpy = vi.fn();

async function boot(engine: 'firefox' | 'chrome', bindings: Binding[]): Promise<FakeBrowser> {
  vi.resetModules();
  mountRoots();
  const fake = fakeBrowser({ engine, forbid: ['storage', 'permissions', 'windows'] });
  fake.browser.commands.getAll.mockResolvedValue(bindings);
  await import('../src/welcome/welcome.js');
  // init awaits getAll before it paints.
  await vi.waitFor(() => expect(document.querySelector('.hero')).not.toBeNull());
  return fake;
}

const main = () => document.getElementById('app')!;
const text = (sel: string): string[] =>
  [...document.querySelectorAll<HTMLElement>(sel)].map((el) => el.textContent?.trim() ?? '');
const keysOf = (label: string): string[] => {
  const row = [...document.querySelectorAll<HTMLElement>('.keys__row')].find(
    (r) => r.querySelector('dt')?.textContent === label,
  );
  if (!row) throw new Error(`no shortcut row «${label}»`);
  const kbds = [...row.querySelectorAll('kbd')].map((k) => k.textContent);
  return kbds.length > 0 ? kbds : [row.querySelector('dd')?.textContent ?? ''];
};

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sections', () => {
  it('paints masthead, hero, the two examples, the three ways, privacy and footer', async () => {
    await boot('chrome', BOUND.chrome);
    expect(document.querySelector('#mast .mast__brand')?.textContent).toBe('brreg-snap');
    expect(document.querySelector('.hero h1')?.textContent).toBe(W.head);
    expect(document.querySelector('.hero__lead')?.textContent).toBe(W.lead);
    expect(text('.example__cap')).toEqual([W.calm, W.loud]);
    expect(text('.way__head')).toEqual([W.toolbarHead, W.keysHead, W.menuHead]);
    expect(document.querySelector('.privacy')?.textContent).toBe(W.privacy);
    const links = [...document.querySelectorAll<HTMLAnchorElement>('#foot a')].map((a) => a.href);
    expect(links).toEqual([COPY.nlodUrl, 'mailto:sebastian@nuez.no', W.sourceUrl]);
    // The entrance plays on the main column (off under reduced motion, brreg.css).
    expect(main().classList.contains('reveal')).toBe(true);
  });

  it('the examples are figures: captions for everyone, the cards hidden, no alert, nothing focusable', async () => {
    await boot('firefox', BOUND.firefox);
    const figures = document.querySelectorAll('figure.example');
    expect(figures).toHaveLength(2);
    for (const fig of figures) {
      expect(fig.querySelector('figcaption')).not.toBeNull();
      const card = fig.querySelector('.example__card')!;
      expect(card.getAttribute('aria-hidden')).toBe('true');
      expect(card.querySelector('[role="alert"]')).toBeNull();
      expect(card.querySelector('a, button, input')).toBeNull();
      expect(card.querySelector('.evidence')?.textContent).toBe(W.exampleTag);
    }
    // The real components, with the fictional companies from the brief.
    expect(text('.ident__name')).toEqual(['NORDVIK ENERGI ASA', 'SOLBAKKEN NETTHANDEL AS']);
    expect(text('.ident__line b')).toEqual(['912 345 678', '917 482 551']);
    expect(text('.answer__head')).toEqual(['Ingen varsler i registeret', 'Konkurs siden 26. aug. 2026']);
    expect(document.querySelector('.answer--danger .answer__support')?.textContent).toBe(
      'Bostyrer: Adv. Kari Nordmann',
    );
    expect(document.querySelectorAll('.ledger-row')).toHaveLength(6);
  });

  it('makes no request and stores nothing', async () => {
    const fake = await boot('chrome', BOUND.chrome);
    expect(fetchSpy).not.toHaveBeenCalled();
    // storage is a forbidden namespace in boot(): any touch would have thrown.
    expect(fake.browser.commands.getAll).toHaveBeenCalledTimes(1);
  });
});

describe('shortcuts', () => {
  it('shows the real bindings as keys (Chrome: popup + open-panel)', async () => {
    await boot('chrome', BOUND.chrome);
    expect(keysOf(W.keysPopup)).toEqual(['Alt', 'Shift', 'O']);
    expect(keysOf(W.keysPanel)).toEqual(['Alt', 'Shift', 'S']);
  });

  it('reads the Firefox sidebar command, and maps MacCtrl to Ctrl', async () => {
    await boot('firefox', [
      { name: '_execute_action', shortcut: 'MacCtrl+Shift+O' },
      { name: '_execute_sidebar_action', shortcut: 'Alt+Shift+S' },
    ]);
    expect(keysOf(W.keysPopup)).toEqual(['Ctrl', 'Shift', 'O']);
    expect(keysOf(W.keysPanel)).toEqual(['Alt', 'Shift', 'S']);
  });

  it('splits Chrome’s macOS symbol form into one key each', async () => {
    await boot('chrome', [{ name: '_execute_action', shortcut: '⌥⇧O' }]);
    expect(keysOf(W.keysPopup)).toEqual(['⌥', '⇧', 'O']);
  });

  it('an unbound or missing command reads «ikke satt»', async () => {
    await boot('chrome', [{ name: '_execute_action', shortcut: '' }]);
    expect(keysOf(W.keysPopup)).toEqual([W.keysUnset]);
    expect(keysOf(W.keysPanel)).toEqual([W.keysUnset]);
  });

  it('a failing commands API degrades to «ikke satt», not a blank page', async () => {
    vi.resetModules();
    mountRoots();
    const fake = fakeBrowser({ engine: 'chrome' });
    fake.browser.commands.getAll.mockRejectedValue(new Error('no'));
    await import('../src/welcome/welcome.js');
    await vi.waitFor(() => expect(document.querySelector('.hero')).not.toBeNull());
    expect(keysOf(W.keysPopup)).toEqual([W.keysUnset]);
  });
});

describe('engine', () => {
  it('Chrome: the pin instruction, and a button that opens the shortcuts page', async () => {
    const fake = await boot('chrome', BOUND.chrome);
    expect(text('.way__text')[0]).toBe(W.toolbarChrome);
    const edit = document.querySelector<HTMLButtonElement>('button.way__edit');
    expect(edit?.textContent).toBe(W.keysEditChrome);
    edit!.click();
    expect(fake.tabs.create).toHaveBeenCalledWith({ url: 'chrome://extensions/shortcuts' });
    expect(document.querySelector('.way__note')).toBeNull();
  });

  it('Firefox: the button is already in the toolbar; shortcuts change in Tillegg', async () => {
    const fake = await boot('firefox', BOUND.firefox);
    expect(text('.way__text')[0]).toBe(W.toolbarFirefox);
    expect(document.querySelector('button.way__edit')).toBeNull();
    expect(document.querySelector('.way__note')?.textContent).toBe(W.keysEditFirefox);
    expect(fake.tabs.create).not.toHaveBeenCalled();
  });
});

describe('package', () => {
  it('welcome/ is an allowed package root (verify:dist and verify-package check the builds)', () => {
    expect(DIST_ROOT).toContain('welcome');
  });
});
