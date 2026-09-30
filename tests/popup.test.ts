// @vitest-environment happy-dom
//
// The popup controller (src/popup/popup.ts) on the popup.html roots,
// with the network and the browser faked: which state it paints, the
// undo actions («Feil bedrift?», «Glem valget», «Tilbake til treffet»),
// the search view over any state, and the toolbar badge gating.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompanyData } from '../src/lib/company-load.js';
import type { Enhet, RollerResponse } from '../src/types/brreg.js';
import { fakeBrowser } from './helpers/fake-browser.js';
import enhetDnb from './fixtures/brreg/enhet-984851006-dnb.json';
import enhetKonkurs from './fixtures/brreg/enhet-915330193-konkurs.json';
import rollerKonkurs from './fixtures/brreg/roller-915330193-konkurs.json';

const mocks = vi.hoisted(() => ({
  resolveTabContext: vi.fn(),
  loadCompany: vi.fn(),
  setTrustBadge: vi.fn(async () => {}),
  getRememberedChoice: vi.fn(async () => undefined as unknown),
  forgetHost: vi.fn(async () => {}),
  setPickerChoice: vi.fn(async () => {}),
  rejectChoice: vi.fn(),
  getRecent: vi.fn(async (): Promise<Array<{ orgnr: string; navn: string; ts: number; status?: string }>> => []),
  pushRecent: vi.fn(async () => {}),
  invalidateCache: vi.fn(async () => {}),
  sidebar: { setPanel: vi.fn(), open: vi.fn(), isOpen: vi.fn(async () => false) },
}));

vi.mock('../src/lib/ui/resolve-tab.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/ui/resolve-tab.js')>()),
  resolveTabContext: mocks.resolveTabContext,
}));
vi.mock('../src/lib/company-load.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/company-load.js')>()),
  loadCompany: mocks.loadCompany,
}));
vi.mock('../src/lib/platform/badge.js', () => ({ setTrustBadge: mocks.setTrustBadge }));
vi.mock('../src/lib/hostname-search.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/hostname-search.js')>()),
  getRememberedChoice: mocks.getRememberedChoice,
  forgetHost: mocks.forgetHost,
  setPickerChoice: mocks.setPickerChoice,
}));
vi.mock('../src/lib/ui/picker.js', () => ({ rejectChoice: mocks.rejectChoice }));
vi.mock('../src/lib/ui/recent.js', () => ({ getRecent: mocks.getRecent, pushRecent: mocks.pushRecent }));
vi.mock('../src/lib/brreg.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/brreg.js')>()),
  invalidateCache: mocks.invalidateCache,
}));
vi.mock('../src/lib/platform/sidebar.js', () => ({ sidebar: mocks.sidebar }));

function company(enhet: unknown, roller?: unknown): CompanyData {
  return {
    enhet: enhet as Enhet,
    roller: roller as RollerResponse | undefined,
    regnskap: undefined,
    underenheter: undefined,
    endringer: undefined,
    aarsregnskapYears: undefined,
    konsern: undefined,
    fetchedAt: Date.now(),
  };
}

const DNB_TAB = { id: 7, windowId: 1, url: 'https://www.dnb.no/', title: 'DNB' };

function mountRoots(): void {
  document.body.className = 'app app--popup';
  document.body.dataset.answer = 'loading';
  const live = document.createElement('p');
  live.id = 'live';
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');
  const mast = document.createElement('header');
  mast.id = 'mast';
  mast.className = 'mast';
  const main = document.createElement('main');
  main.id = 'app';
  main.dataset.state = 'loading';
  const foot = document.createElement('footer');
  foot.id = 'foot';
  foot.className = 'foot';
  document.body.replaceChildren(live, mast, main, foot);
}

const app = () => document.getElementById('app')!;
const state = () => app().dataset.state;
const waitState = (s: string) => vi.waitFor(() => expect(state()).toBe(s));
const byText = (text: string): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>('button, a')].find((el) => el.textContent?.trim() === text);

async function boot(tab: unknown = DNB_TAB): Promise<void> {
  // A fresh controller instance per boot (the module runs init on import).
  vi.resetModules();
  mountRoots();
  const browser = fakeBrowser({ engine: 'chrome' });
  browser.tabs.query.mockResolvedValue([tab]);
  await import('../src/popup/popup.js');
}

beforeEach(() => {
  // mockReset, not mockClear: a queued mockResolvedValueOnce must not
  // leak into the next test.
  for (const m of Object.values(mocks)) if (typeof m === 'function') m.mockReset();
  mocks.setTrustBadge.mockResolvedValue(undefined);
  mocks.forgetHost.mockResolvedValue(undefined);
  mocks.setPickerChoice.mockResolvedValue(undefined);
  mocks.pushRecent.mockResolvedValue(undefined);
  mocks.invalidateCache.mockResolvedValue(undefined);
  mocks.sidebar.isOpen.mockResolvedValue(false);
  mocks.getRememberedChoice.mockResolvedValue(undefined);
  mocks.getRecent.mockResolvedValue([]);
  mocks.resolveTabContext.mockResolvedValue({ orgnr: '984851006', host: 'www.dnb.no', method: 'host-auto' });
  mocks.loadCompany.mockResolvedValue(company(enhetDnb));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('popup controller — result', () => {
  it('paints a host-derived ok result with «Feil bedrift?» and clears the badge', async () => {
    await boot();
    await waitState('result');
    expect(document.body.dataset.answer).toBe('ok');
    expect(app().hasAttribute('inert')).toBe(false);
    expect(app().getAttribute('aria-busy')).toBe('false');
    expect(document.querySelector('h1')?.textContent).toBe('DNB BANK ASA');
    expect(document.querySelector('.answer--ok')).not.toBeNull();
    expect(byText('Feil bedrift?')).toBeDefined();
    expect(byText('Glem valget for dnb.no')).toBeUndefined();
    expect(mocks.loadCompany).toHaveBeenCalledWith('984851006', { konsern: true });
    expect(mocks.setTrustBadge).toHaveBeenCalledWith(7, undefined);
    expect(mocks.pushRecent).toHaveBeenCalledWith('984851006', 'DNB BANK ASA', undefined);
    // The initial load is not user-initiated: focus stays where it was.
    expect(document.activeElement).toBe(document.body);
    // The masthead names the site with the registrable domain in <b>.
    expect(document.querySelector('.mast__site b')?.textContent).toBe('dnb.no');
  });

  it('badges the tab for a danger answer on a host-derived result, and remembers the status', async () => {
    mocks.resolveTabContext.mockResolvedValue({ orgnr: '915330193', host: 'example.no', method: 'url-param' });
    mocks.loadCompany.mockResolvedValue(company(enhetKonkurs, rollerKonkurs));
    await boot({ ...DNB_TAB, url: 'https://example.no/?orgnr=915330193' });
    await waitState('result');
    expect(document.body.dataset.answer).toBe('danger');
    expect(document.querySelector('[role="alert"] .stamp-word')?.textContent).toBe('Konkurs');
    expect(mocks.setTrustBadge).toHaveBeenCalledWith(7, 'danger');
    expect(mocks.pushRecent).toHaveBeenCalledWith('915330193', enhetKonkurs.navn, 'Konkurs');
    // No leaders line under a stamp; the bostyrer is in it.
    expect(document.querySelector('.ident__leaders')).toBeNull();
    expect(document.querySelector('.answer__support')?.textContent).toMatch(/^Bostyrer: /);
  });

  it('a manual pick with a site on screen offers the way back, and never badges', async () => {
    mocks.resolveTabContext.mockResolvedValueOnce({ host: 'www.dnb.no' });
    await boot();
    await waitState('empty');
    expect(document.querySelector('h1')?.textContent).toBe('Fant ikke selskapet bak dnb.no');
    expect(mocks.setTrustBadge).toHaveBeenLastCalledWith(7, undefined);

    // Pick from the search: a manual load.
    mocks.getRecent.mockResolvedValue([{ orgnr: '984851006', navn: 'DNB BANK ASA', ts: 1 }]);
    mocks.resolveTabContext.mockResolvedValueOnce({ host: 'www.dnb.no' });
    await boot();
    await waitState('empty');
    document.querySelector<HTMLButtonElement>('button.recent')!.click();
    await waitState('result');
    expect(mocks.setTrustBadge).toHaveBeenLastCalledWith(7, undefined);
    expect(byText('Feil bedrift?')).toBeUndefined();
    const back = byText('Tilbake til treffet for dnb.no')!;
    expect(back).toBeDefined();
    // A user-initiated transition focuses the result heading.
    expect(document.activeElement).toBe(document.querySelector('h1'));

    mocks.resolveTabContext.mockResolvedValueOnce({ orgnr: '984851006', host: 'www.dnb.no', method: 'host-auto' });
    back.click();
    await vi.waitFor(() => expect(byText('Feil bedrift?')).toBeDefined());
    expect(mocks.resolveTabContext).toHaveBeenCalledTimes(3);
  });

  it('«Glem valget for <site>» forgets the site and resolves it again', async () => {
    mocks.getRememberedChoice.mockResolvedValue({ kind: 'choice', orgnr: '984851006' });
    mocks.resolveTabContext.mockResolvedValue({ orgnr: '984851006', host: 'www.dnb.no', method: 'host-pick' });
    await boot();
    await waitState('result');
    const forget = byText('Glem valget')!;
    expect(forget).toBeDefined();
    mocks.getRememberedChoice.mockResolvedValue(undefined);
    forget.click();
    await vi.waitFor(() => expect(mocks.forgetHost).toHaveBeenCalledWith('www.dnb.no'));
    await vi.waitFor(() => expect(mocks.resolveTabContext).toHaveBeenCalledTimes(2));
    await waitState('result');
    expect(byText('Glem valget')).toBeUndefined();
  });

  it('«Feil bedrift?» records the rejection and shows what is left', async () => {
    mocks.rejectChoice.mockResolvedValue({
      kind: 'picker',
      candidates: [{ ...(enhetKonkurs as Enhet), evidence: 'navn' }],
    });
    await boot();
    await waitState('result');
    byText('Feil bedrift?')!.click();
    await waitState('picker');
    expect(mocks.rejectChoice).toHaveBeenCalledWith('www.dnb.no', '984851006', 'DNB', expect.any(Function));
    expect(document.body.dataset.answer).toBe('pick');
    const first = document.querySelector<HTMLButtonElement>('button.pick')!;
    expect(document.activeElement).toBe(first);
    expect(mocks.setTrustBadge).toHaveBeenLastCalledWith(7, undefined);

    mocks.loadCompany.mockResolvedValue(company(enhetKonkurs));
    first.click();
    await vi.waitFor(() => expect(mocks.setPickerChoice).toHaveBeenCalledWith('www.dnb.no', '915330193'));
    await waitState('result');
    expect(document.querySelector('h1')?.textContent).toBe(enhetKonkurs.navn);
  });

  it('«Ingen av disse» remembers it and lands on the empty state with «Glem valget»', async () => {
    mocks.resolveTabContext.mockResolvedValue({
      host: 'www.nrk.no',
      pickerCandidates: [{ ...(enhetDnb as Enhet), evidence: 'navn' }],
    });
    await boot({ ...DNB_TAB, url: 'https://www.nrk.no/' });
    await waitState('picker');
    mocks.getRememberedChoice.mockResolvedValue({ kind: 'none' });
    document.querySelector<HTMLButtonElement>('button.pick--none')!.click();
    await waitState('empty');
    expect(mocks.setPickerChoice).toHaveBeenCalledWith('www.nrk.no', null);
    expect(document.querySelector('h1')?.textContent).toBe('Du valgte «Ingen av disse» for nrk.no');
    expect(byText('Glem valget for nrk.no')).toBeDefined();
  });
});

describe('popup controller — search view, error, refresh', () => {
  it('the masthead search opens the search view over a result; Escape returns to it', async () => {
    await boot();
    await waitState('result');
    document.querySelector<HTMLButtonElement>('.mast .icon-btn')!.click();
    await waitState('empty');
    expect(document.querySelector('h1')?.textContent).toBe('Søk i Brønnøysundregistrene');
    expect(document.querySelector('button.back')?.textContent).toBe('Tilbake til DNB BANK ASA');
    expect(document.activeElement).toBe(document.querySelector('input[type="search"]'));
    // No icon while the field itself is on screen.
    expect(document.querySelector('.mast .icon-btn')).toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitState('result');
    expect(document.querySelector('h1')?.textContent).toBe('DNB BANK ASA');
    // Painted from memory: no second load.
    expect(mocks.loadCompany).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(document.querySelector('.mast .icon-btn'));
  });

  it('a failed load is a calm warn band with «Prøv igjen», and a retry loads again', async () => {
    mocks.loadCompany.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await boot();
    await waitState('error');
    expect(document.body.dataset.answer).toBe('warn');
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('.answer--warn h2')?.textContent).toBe('Fikk ikke svar fra Brønnøysundregistrene');
    expect(document.querySelector('.context')?.textContent).toBe('Oppslag på org.nr 984 851 006');
    expect(mocks.setTrustBadge).toHaveBeenLastCalledWith(7, undefined);
    byText('Prøv igjen')!.click();
    await waitState('result');
    expect(mocks.loadCompany).toHaveBeenCalledTimes(2);
  });

  it('a not-found orgnr offers no retry', async () => {
    mocks.loadCompany.mockRejectedValueOnce(new Error('No entity found for orgnr 984851006.'));
    await boot();
    await waitState('error');
    expect(byText('Prøv igjen')).toBeUndefined();
  });

  it('«Oppdater» drops the cache and reloads', async () => {
    await boot();
    await waitState('result');
    byText('Oppdater')!.click();
    await vi.waitFor(() => expect(mocks.invalidateCache).toHaveBeenCalledWith('984851006'));
    await vi.waitFor(() => expect(mocks.loadCompany).toHaveBeenCalledTimes(2));
  });

  it('«Åpne i sidepanel» docks the panel in the popup\'s window and the konsern row opens Enheter', async () => {
    await boot();
    await waitState('result');
    const open = byText('Åpne i sidepanel') as HTMLAnchorElement;
    expect(open.href).toMatch(/details\/details\.html\?orgnr=984851006&at=\d+$/);
    open.click();
    expect(mocks.sidebar.setPanel).toHaveBeenCalledWith(expect.stringMatching(/orgnr=984851006&at=\d+&w=1$/));
    expect(mocks.sidebar.open).toHaveBeenCalledWith({ windowId: 1, tabId: 7 });
  });

  it('no address to look up: the empty state, no badge, no site', async () => {
    mocks.resolveTabContext.mockResolvedValue({});
    await boot({ id: 7, windowId: 1, url: '', title: '' });
    await waitState('empty');
    expect(document.querySelector('h1')?.textContent).toBe('Ingen nettside å slå opp');
    expect(document.querySelector('.mast__site')?.textContent).toBe('Ingen nettside');
    expect(document.body.dataset.answer).toBe('empty');
  });
});
