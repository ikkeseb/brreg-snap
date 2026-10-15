// The panel controller without a DOM: a fake painter records what it
// is told to paint, a fake window backs the history, and the loader /
// tab deps are deferred so races can be staged.

import { describe, expect, it, vi } from 'vitest';

import type { CompanyData } from '../src/lib/company-load.js';
import type { Candidate } from '../src/lib/hostname-search.js';
import type { PanelView, TabFields } from '../src/lib/panel-follow.js';
import type { RejectOutcome } from '../src/lib/ui/picker.js';
import type { TabContext } from '../src/lib/ui/resolve-tab.js';
import { createPanelController, PANEL_LOAD_OPTIONS, type ControllerDeps } from '../src/details/controller.js';
import { createPanelHistory, type HistoryWindow } from '../src/details/history.js';
import type { PanelPainter } from '../src/details/view.js';
import dnb from './fixtures/brreg/enhet-984851006-dnb.json';
import equinor from './fixtures/brreg/enhet-923609016-equinor.json';
import konkurs from './fixtures/brreg/enhet-915330193-konkurs.json';

const DNB = dnb.organisasjonsnummer;
const EQUINOR = equinor.organisasjonsnummer;
const OWN = 'moz-extension://3f1c0d2e-panel/';
const PANEL = `${OWN}details/details.html`;
const CANDIDATES = [dnb, equinor].map((e): Candidate => ({ ...e, evidence: 'hjemmeside' }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}

function company(orgnr: string): CompanyData {
  const enhet = orgnr === DNB ? dnb : equinor;
  return {
    enhet,
    roller: undefined,
    regnskap: undefined,
    underenheter: undefined,
    endringer: undefined,
    aarsregnskapYears: undefined,
    konsern: undefined,
    fetchedAt: 1_000,
  };
}

const companyView = (orgnr: string, host?: string): PanelView => ({
  kind: 'company',
  orgnr,
  method: 'host-auto',
  host,
});

// window.history / window.location over an entry stack. back() moves
// the index and fires the popstate the test wired to the controller.
function fakeWindow(href = PANEL) {
  const stack: Array<{ state: unknown; href: string }> = [{ state: null, href }];
  let idx = 0;
  const at = () => stack[idx]!;
  let onPop: (state: unknown) => void = () => {};
  const win: HistoryWindow = {
    history: {
      get state() {
        return at().state;
      },
      pushState(state, _unused, url) {
        stack.splice(idx + 1);
        stack.push({ state, href: url });
        idx += 1;
      },
      replaceState(state, _unused, url) {
        stack[idx] = { state, href: url };
      },
      back() {
        if (idx === 0) return;
        idx -= 1;
        onPop(at().state);
      },
    },
    location: {
      get href() {
        return at().href;
      },
      get search() {
        return new URL(at().href).search;
      },
    },
  };
  return {
    win,
    url: () => new URL(at().href),
    setOnPop: (fn: (state: unknown) => void) => {
      onPop = fn;
    },
  };
}

function fakePainter() {
  const painter: PanelPainter = {
    loading: vi.fn(),
    result: vi.fn(),
    provenance: vi.fn(),
    picker: vi.fn(),
    empty: vi.fn(),
    error: vi.fn(),
    setBack: vi.fn(),
    selectTab: vi.fn(),
    clearBadge: vi.fn(),
  };
  return {
    painter,
    results: () => vi.mocked(painter.result).mock.calls.map(([p]) => p),
    shownOrgnrs: () =>
      vi.mocked(painter.result).mock.calls.map(([p]) => p.company.enhet.organisasjonsnummer),
  };
}

interface SetupOptions {
  hasFocus?: boolean;
  href?: string;
  activeTab?: TabFields;
  resolveTab?: (url: string, title: string) => Promise<TabContext>;
  searchHost?: ControllerDeps['searchHost'];
  rejectChoice?: ControllerDeps['rejectChoice'];
  // Loads resolve at once unless a test takes over with `pending`.
  manualLoads?: boolean;
}

function setup(opts: SetupOptions = {}) {
  const { win, url, setOnPop } = fakeWindow(opts.href);
  const fake = fakePainter();
  const focus = { has: opts.hasFocus ?? true };
  const pending: Array<ReturnType<typeof deferred<CompanyData>>> = [];
  const loadCompany = vi.fn((orgnr: string): Promise<CompanyData> => {
    if (!opts.manualLoads) return Promise.resolve(company(orgnr));
    const d = deferred<CompanyData>();
    pending.push(d);
    return d.promise;
  });
  const deps: ControllerDeps = {
    painter: () => fake.painter,
    history: createPanelHistory(win),
    hasFocus: () => focus.has,
    ownUrlPrefix: OWN,
    queryActiveTab: vi.fn(async () => opts.activeTab),
    getTab: vi.fn(async () => opts.activeTab ?? {}),
    resolveTab: vi.fn(opts.resolveTab ?? (async () => ({}))),
    searchHost: vi.fn(opts.searchHost ?? (async () => ({ band: 'none' as const, candidates: [], complete: true }))),
    loadCompany,
    invalidateCache: vi.fn(async () => {}),
    pushRecent: vi.fn(async () => {}),
    rejectChoice: vi.fn(opts.rejectChoice ?? (async () => ({ kind: 'empty' as const }))),
    forgetHost: vi.fn(async () => {}),
    getRememberedChoice: vi.fn(async () => undefined),
  };
  const controller = createPanelController(deps);
  setOnPop((state) => controller.restore(state));
  return { controller, intents: controller.intents, deps, url, focus, pending, ...fake };
}

describe('load races', () => {
  it('a stale load that lands late never paints', async () => {
    const { controller, painter, pending, shownOrgnrs } = setup({ manualLoads: true });
    controller.follow(companyView(DNB, 'www.dnb.no'));
    controller.follow(companyView(EQUINOR, 'www.equinor.com'));
    expect(vi.mocked(painter.loading).mock.calls.map(([orgnr]) => orgnr)).toEqual([DNB, EQUINOR]);

    // The older fetch lands first, then the newer one.
    pending[0]!.resolve(company(DNB));
    await settle();
    expect(shownOrgnrs()).toEqual([]);
    pending[1]!.resolve(company(EQUINOR));
    await settle();
    expect(shownOrgnrs()).toEqual([EQUINOR]);
    expect(painter.error).not.toHaveBeenCalled();
  });

  it('a stale load that fails late paints no error either', async () => {
    const { controller, painter, pending } = setup({ manualLoads: true });
    controller.follow(companyView(DNB));
    controller.follow(companyView(EQUINOR));
    pending[0]!.reject(new Error('network'));
    pending[1]!.resolve(company(EQUINOR));
    await settle();
    expect(painter.error).not.toHaveBeenCalled();
    expect(painter.result).toHaveBeenCalledTimes(1);
  });

  it('a picker pick for a picker no longer on screen is dropped', async () => {
    const { controller, intents, painter, deps } = setup({
      searchHost: async () => ({ band: 'picker', candidates: CANDIDATES, complete: true }),
    });
    await controller.probe('example.com');
    expect(painter.picker).toHaveBeenCalledWith('example.com', CANDIDATES, { focus: true });

    // A sync repaints while the picker's storage write is in flight.
    controller.follow(companyView(EQUINOR, 'www.equinor.com'));
    await settle();
    intents.pick('example.com', DNB);
    await settle();
    expect(deps.loadCompany).toHaveBeenCalledTimes(1);
    expect(deps.loadCompany).toHaveBeenCalledWith(EQUINOR, PANEL_LOAD_OPTIONS);
  });
});

describe('what the panel loads', () => {
  it('asks for the dossier parts, and hands the group tree on to a drill-in and Back', async () => {
    const { controller, intents, deps } = setup();
    const tree = { organisasjonsnummer: DNB, navn: dnb.navn, children: [] };
    vi.mocked(deps.loadCompany).mockResolvedValueOnce({ ...company(DNB), konsernTree: tree });
    controller.follow(companyView(DNB, 'dnb.no'));
    await settle();
    expect(deps.loadCompany).toHaveBeenLastCalledWith(DNB, PANEL_LOAD_OPTIONS);

    // The last tree in hand rides along on a drill-in…
    intents.drill(EQUINOR);
    await settle();
    expect(deps.loadCompany).toHaveBeenLastCalledWith(EQUINOR, { ...PANEL_LOAD_OPTIONS, konsernTree: tree });
    // …and on the Back that returns (the drilled-in company had no
    // tree of its own, so nothing newer replaced it).
    intents.back();
    await settle();
    expect(deps.loadCompany).toHaveBeenLastCalledWith(DNB, PANEL_LOAD_OPTIONS);
  });

  it('the skeleton has a Kobling row only when the result will', async () => {
    const { controller, intents, painter } = setup();
    const kobling = () => vi.mocked(painter.loading).mock.calls.at(-1)![1].kobling;
    // A site in play: the result carries a Kobling row.
    controller.follow(companyView(DNB, 'dnb.no'));
    await settle();
    expect(kobling()).toBe(true);
    // A drill-in, an org.nr with no site, a manual pick: none.
    intents.drill(EQUINOR);
    await settle();
    expect(kobling()).toBe(false);
    intents.back();
    await settle();
    expect(kobling()).toBe(true);
    controller.follow(companyView(EQUINOR));
    await settle();
    expect(kobling()).toBe(false);
    intents.manual(DNB);
    await settle();
    expect(kobling()).toBe(false);
  });

  it('«Oppdater» never reuses a tree: everything is refetched', async () => {
    const { controller, intents, deps } = setup();
    const tree = { organisasjonsnummer: DNB, navn: dnb.navn, children: [] };
    vi.mocked(deps.loadCompany).mockResolvedValueOnce({ ...company(DNB), konsernTree: tree });
    controller.follow(companyView(DNB, 'dnb.no'));
    await settle();
    intents.refresh();
    await settle();
    expect(deps.loadCompany).toHaveBeenLastCalledWith(DNB, PANEL_LOAD_OPTIONS);
  });

  it('«Prøv igjen» under a degraded empty state re-runs the host search', async () => {
    const searchHost = vi
      .fn<ControllerDeps['searchHost']>()
      .mockResolvedValueOnce({ band: 'none', candidates: [], complete: false })
      .mockResolvedValueOnce({ band: 'auto', choice: DNB, candidates: CANDIDATES, complete: true });
    const { controller, intents, painter, shownOrgnrs } = setup({ searchHost });
    await controller.probe('dnb.no');
    expect(painter.empty).toHaveBeenLastCalledWith(expect.objectContaining({ host: 'dnb.no', degraded: true }));
    intents.retry();
    await settle();
    expect(searchHost).toHaveBeenCalledTimes(2);
    expect(shownOrgnrs()).toEqual([DNB]);
  });
});

describe('same-view keep', () => {
  it('a sync for the orgnr on screen keeps the view and refreshes its provenance', async () => {
    const { controller, painter, deps, url } = setup();
    controller.follow(companyView(DNB, 'dnb.no'));
    await settle();
    expect(painter.loading).toHaveBeenCalledTimes(1);

    controller.follow({ kind: 'company', orgnr: DNB, method: 'host-pick', host: 'www.dnb.no' });
    await settle();
    expect(painter.loading).toHaveBeenCalledTimes(1);
    expect(painter.result).toHaveBeenCalledTimes(1);
    expect(painter.provenance).toHaveBeenLastCalledWith({
      method: 'host-pick',
      host: 'www.dnb.no',
      remembered: undefined,
    });
    expect(deps.getRememberedChoice).toHaveBeenLastCalledWith('www.dnb.no');
    expect(deps.history.current()).toEqual({ orgnr: DNB, method: 'host-pick', host: 'www.dnb.no' });
    expect(url().searchParams.get('orgnr')).toBe(DNB);
  });

  it("the kept result's isStale stays false across the keep", async () => {
    const { controller, results } = setup();
    controller.follow(companyView(DNB, 'dnb.no'));
    await settle();
    controller.follow(companyView(DNB, 'www.dnb.no'));
    await settle();
    expect(results()[0]!.isStale()).toBe(false);
  });
});

describe('drill-in and Back', () => {
  it('drill-in pushes an entry; Back restores the previous orgnr and its tab', async () => {
    const { controller, intents, painter, results, url, deps } = setup();
    controller.follow(companyView(DNB, 'dnb.no'));
    await settle();
    intents.selectTab('personer');
    expect(url().searchParams.get('tab')).toBe('personer');

    intents.drill(EQUINOR);
    await settle();
    expect(deps.history.current()).toEqual({ orgnr: EQUINOR, method: 'drill-in', host: undefined });
    expect(results()[1]).toMatchObject({ method: 'drill-in', host: undefined, focus: 'heading' });
    expect(painter.setBack).toHaveBeenLastCalledWith(true);

    intents.back();
    await settle();
    expect(results()[2]).toMatchObject({
      company: { enhet: { organisasjonsnummer: DNB } },
      method: 'host-auto',
      host: 'dnb.no',
      focus: 'heading',
    });
    expect(painter.selectTab).toHaveBeenLastCalledWith('personer');
    expect(painter.setBack).toHaveBeenLastCalledWith(false);
    expect(url().searchParams.get('orgnr')).toBe(DNB);
  });

  it('an entry without ?tab= restores the default tab', async () => {
    const { controller, intents, painter } = setup();
    controller.follow(companyView(DNB));
    await settle();
    intents.drill(EQUINOR);
    await settle();
    intents.back();
    await settle();
    expect(painter.selectTab).toHaveBeenLastCalledWith('oversikt');
  });

  it('a drill-in into an invalid orgnr is ignored', () => {
    const { intents, painter, deps } = setup();
    intents.drill('123');
    expect(painter.loading).not.toHaveBeenCalled();
    expect(deps.history.current()).toBeUndefined();
  });
});

describe('«Feil bedrift?»', () => {
  const tab = { url: 'https://www.dnb.no/', title: 'DNB Bank' };
  const resolveTab = async (): Promise<TabContext> => ({
    orgnr: DNB,
    host: 'www.dnb.no',
    method: 'host-auto',
  });

  it('rejects with the tab title and shows the picker', async () => {
    const { controller, intents, painter, deps } = setup({
      resolveTab,
      rejectChoice: async () => ({ kind: 'picker', candidates: CANDIDATES }),
    });
    await controller.followTab(1, tab);
    await settle();
    expect(painter.result).toHaveBeenCalledTimes(1);

    await intents.reject();
    expect(deps.rejectChoice).toHaveBeenCalledWith('www.dnb.no', [DNB], 'DNB Bank', expect.any(Function));
    expect(painter.picker).toHaveBeenCalledWith('www.dnb.no', CANDIDATES, { focus: true, tabId: 1 });
  });

  it('a view from a sync message has no title to offer', async () => {
    const { controller, intents, deps, painter } = setup();
    controller.follow(companyView(DNB, 'www.dnb.no'));
    await settle();
    await intents.reject();
    expect(deps.rejectChoice).toHaveBeenCalledWith('www.dnb.no', [DNB], undefined, expect.any(Function));
    expect(painter.empty).toHaveBeenCalledWith({
      host: 'www.dnb.no',
      degraded: false,
      query: undefined,
      focus: true,
    });
  });

  it('a tab event during the flow wins over its late picker', async () => {
    const outcome = deferred<RejectOutcome | undefined>();
    const { controller, intents, painter, deps } = setup({
      resolveTab,
      rejectChoice: () => outcome.promise,
    });
    await controller.followTab(1, tab);
    await settle();
    const rejecting = intents.reject();
    await settle();
    const isStale = vi.mocked(deps.rejectChoice).mock.calls[0]![3];
    expect(isStale()).toBe(false);
    controller.follow(companyView(EQUINOR, 'www.equinor.com'));
    expect(isStale()).toBe(true);
    outcome.resolve({ kind: 'picker', candidates: CANDIDATES });
    await rejecting;
    expect(painter.picker).not.toHaveBeenCalled();
  });

  it('is a no-op without a host', async () => {
    const { controller, intents, deps } = setup();
    controller.follow(companyView(DNB));
    await settle();
    await intents.reject();
    expect(deps.rejectChoice).not.toHaveBeenCalled();
  });

  it('an underenhet orgnr: rejects the orgnr the site gave and the parent shown', async () => {
    const { controller, intents, deps } = setup();
    vi.mocked(deps.loadCompany).mockResolvedValueOnce({
      ...company(DNB),
      avdeling: { organisasjonsnummer: '973160834', navn: 'DNB BANK ASA AVD ALTA', overordnetEnhet: DNB },
    });
    controller.follow({ kind: 'company', orgnr: '973160834', method: 'url-param', host: 'www.dnb.no' });
    await settle();
    await intents.reject();
    expect(deps.rejectChoice).toHaveBeenCalledWith(
      'www.dnb.no',
      ['973160834', DNB],
      undefined,
      expect.any(Function),
    );
  });
});

describe('«Glem valget»', () => {
  it('forgets the host and re-resolves it', async () => {
    const { controller, intents, painter, deps, shownOrgnrs } = setup({
      searchHost: async () => ({ band: 'auto', choice: EQUINOR, candidates: CANDIDATES, complete: true }),
    });
    controller.follow({ kind: 'company', orgnr: DNB, method: 'host-pick', host: 'dnb.no' });
    await settle();

    await intents.forget();
    await settle();
    expect(deps.forgetHost).toHaveBeenCalledWith('dnb.no');
    expect(deps.searchHost).toHaveBeenCalledWith('dnb.no', undefined);
    expect(shownOrgnrs()).toEqual([DNB, EQUINOR]);
    expect(painter.loading).toHaveBeenCalledTimes(2);
  });

  it('keeps the view when the host resolves to the same company', async () => {
    const { controller, intents, painter } = setup({
      searchHost: async () => ({ band: 'auto', choice: DNB, candidates: CANDIDATES, complete: true }),
    });
    controller.follow({ kind: 'company', orgnr: DNB, method: 'host-pick', host: 'dnb.no' });
    await settle();
    await intents.forget();
    await settle();
    expect(painter.loading).toHaveBeenCalledTimes(1);
    expect(painter.provenance).toHaveBeenLastCalledWith({
      method: 'host-auto',
      host: 'dnb.no',
      remembered: undefined,
    });
  });

  it('is a no-op without a host', async () => {
    const { controller, intents, deps } = setup();
    controller.follow(companyView(DNB));
    await settle();
    await intents.forget();
    expect(deps.forgetHost).not.toHaveBeenCalled();
  });
});

describe('«Oppdater» and «Prøv igjen»', () => {
  it('refresh invalidates the orgnr on screen and hands focus to the button', async () => {
    const { controller, intents, deps, results } = setup();
    controller.follow(companyView(DNB, 'dnb.no'));
    await settle();
    intents.refresh();
    await settle();
    expect(deps.invalidateCache).toHaveBeenCalledTimes(1);
    expect(deps.invalidateCache).toHaveBeenCalledWith(DNB);
    expect(deps.loadCompany).toHaveBeenCalledTimes(2);
    expect(results()[1]).toMatchObject({ method: 'host-auto', host: 'dnb.no', focus: 'refresh' });
  });

  it('refresh does nothing without a result on screen', async () => {
    const { controller, intents, deps } = setup({
      searchHost: async () => ({ band: 'picker', candidates: CANDIDATES, complete: true }),
    });
    await controller.probe('example.com');
    intents.refresh();
    expect(deps.loadCompany).not.toHaveBeenCalled();
  });

  it('a failed load offers retry, which re-runs the same load', async () => {
    const { controller, intents, deps, painter } = setup();
    vi.mocked(deps.loadCompany).mockRejectedValueOnce(new Error('network'));
    controller.follow(companyView(DNB, 'dnb.no'));
    await settle();
    expect(painter.error).toHaveBeenCalledWith(expect.any(Error), { retry: true, focus: false });

    intents.retry();
    await settle();
    expect(deps.loadCompany).toHaveBeenCalledTimes(2);
    expect(painter.result).toHaveBeenCalledTimes(1);
  });

  it('a not-found offers no retry', async () => {
    const { controller, deps, painter } = setup();
    vi.mocked(deps.loadCompany).mockRejectedValueOnce(new Error(`No entity found for orgnr ${DNB}`));
    controller.follow(companyView(DNB));
    await settle();
    expect(painter.error).toHaveBeenCalledWith(expect.any(Error), { retry: false, focus: false });
  });
});

describe('focus', () => {
  const unresolvable = async (): Promise<TabContext> => ({ host: 'example.com' });

  it('a background tab event never asks for focus, even with the panel focused', async () => {
    const { controller, painter } = setup({ resolveTab: unresolvable });
    await controller.followTab(1, { url: 'https://example.com/' });
    expect(painter.empty).toHaveBeenCalledWith(expect.objectContaining({ focus: false }));
  });

  it('a no-match probe asks for focus when the panel window has it', async () => {
    const { controller, painter, focus } = setup();
    await controller.probe('example.com');
    expect(painter.empty).toHaveBeenLastCalledWith(expect.objectContaining({ focus: true }));
    focus.has = false;
    await controller.probe('other.example');
    expect(painter.empty).toHaveBeenLastCalledWith(expect.objectContaining({ focus: false }));
  });

  it('a drill-in focuses the heading only when the panel window has focus', async () => {
    const { controller, intents, results, focus } = setup();
    controller.follow(companyView(DNB));
    await settle();
    expect(results()[0]!.focus).toBe('none');
    focus.has = false;
    intents.drill(EQUINOR);
    await settle();
    expect(results()[1]!.focus).toBe('none');
  });

  it('a manual pick clears the host and moves no focus', async () => {
    const { controller, intents, results, deps } = setup();
    await controller.probe('example.com');
    intents.manual(DNB);
    await settle();
    expect(results()[0]).toMatchObject({ method: 'manual', host: undefined, focus: 'none' });
    expect(deps.history.current()).toEqual({ orgnr: DNB, method: 'manual', host: undefined });
  });
});

describe('startup and messages', () => {
  it('init drops the ?at= stamp and shows a fresh hint orgnr without a host', async () => {
    const { controller, results, url } = setup({
      href: `${PANEL}?orgnr=${DNB}&at=5&w=1`,
    });
    await controller.init({ orgnr: DNB, fresh: true });
    await settle();
    expect(url().searchParams.has('at')).toBe(false);
    expect(results()[0]).toMatchObject({ method: 'url-path', host: undefined });
  });

  it('a search message repaints the empty state with the query, for its tab', async () => {
    const { controller, painter } = setup();
    controller.follow({ kind: 'empty', query: 'kaffe' }, 7);
    expect(painter.empty).toHaveBeenCalledWith({
      host: undefined,
      degraded: false,
      query: 'kaffe',
      focus: true,
      tabId: 7,
    });
  });

  it('«Ingen av disse» shows the empty state for the picker host', async () => {
    const { controller, intents, painter, url } = setup({
      searchHost: async () => ({ band: 'picker', candidates: CANDIDATES, complete: true }),
    });
    await controller.probe('example.com');
    intents.none('example.com');
    expect(painter.empty).toHaveBeenCalledWith({
      host: 'example.com',
      degraded: false,
      query: undefined,
      focus: true,
      tabId: undefined,
    });
    expect(url().searchParams.has('orgnr')).toBe(false);
  });

  it('every paint names the followed tab: the one read at startup, on a tab event or named by a message', async () => {
    const { controller, intents, painter, results } = setup({
      activeTab: { id: 4, url: 'https://www.dnb.no/', title: 'DNB' },
      resolveTab: async (url) =>
        url.includes('nrk') ? { host: 'nrk.no' } : { host: 'dnb.no', orgnr: DNB, method: 'host-auto' },
    });
    await controller.init({ fresh: false });
    await settle();
    expect(results()[0]).toMatchObject({ host: 'dnb.no', tabId: 4 });

    // A tab event moves the followed tab; a same-company keep names the new one.
    await controller.followTab(5, { id: 5, url: 'https://nettbank.dnb.no/', title: '' });
    await settle();
    expect(painter.provenance).toHaveBeenLastCalledWith(expect.objectContaining({ tabId: 5 }));

    // A message names its sender's tab: the panel follows that one now,
    // and a drill-in from its view names it too.
    controller.follow({ kind: 'company', orgnr: EQUINOR, method: 'host-pick', host: 'equinor.com' }, 9);
    await settle();
    expect(results().at(-1)).toMatchObject({ host: 'equinor.com', tabId: 9 });
    intents.drill(DNB);
    await settle();
    expect(results().at(-1)).toMatchObject({ method: 'drill-in', tabId: 9 });

    // A message that names no tab follows none: no stale tab's badge.
    controller.follow({ kind: 'company', orgnr: EQUINOR, method: 'host-pick', host: 'equinor.com' });
    await settle();
    expect(results().at(-1)).toMatchObject({ host: 'equinor.com', tabId: undefined });
    intents.drill(DNB);
    await settle();
    expect(results().at(-1)).toMatchObject({ method: 'drill-in', tabId: undefined });

    // A no-match message names its tab the same way.
    await controller.probe('example.com', 8);
    expect(painter.empty).toHaveBeenLastCalledWith(expect.objectContaining({ host: 'example.com', tabId: 8 }));

    // Picker, empty and error paints carry it too.
    await controller.followTab(6, { id: 6, url: 'https://www.nrk.no/', title: '' });
    await settle();
    expect(painter.empty).toHaveBeenLastCalledWith(expect.objectContaining({ tabId: 6 }));
  });

  it('Back keeps the followed tab only for an entry painted for it; otherwise it names none', async () => {
    const { controller, intents, results } = setup({
      activeTab: { id: 4, url: 'https://www.dnb.no/', title: 'DNB' },
      resolveTab: async () => ({ host: 'dnb.no', orgnr: DNB, method: 'host-auto' }),
    });
    await controller.init({ fresh: false });
    await settle();
    intents.drill(EQUINOR);
    await settle();
    // Another tab's popup: the panel follows tab 9 now.
    controller.follow(companyView(DNB, 'www.dnb.no'), 9);
    await settle();
    expect(results().at(-1)).toMatchObject({ host: 'www.dnb.no', tabId: 9 });

    // Back to tab 4's entry: the panel follows 9, so it follows none.
    intents.back();
    await settle();
    expect(results().at(-1)).toMatchObject({
      company: { enhet: { organisasjonsnummer: DNB } },
      host: 'dnb.no',
      tabId: undefined,
    });

    // An entry for the tab still followed keeps it.
    controller.follow(companyView(DNB, 'dnb.no'), 4);
    await settle();
    intents.drill(EQUINOR);
    await settle();
    intents.back();
    await settle();
    expect(results().at(-1)).toMatchObject({ host: 'dnb.no', tabId: 4 });

    // An entry without a tab (older), or with junk there, names none.
    for (const state of [
      { orgnr: DNB, method: 'host-auto', host: 'dnb.no' },
      { orgnr: DNB, method: 'host-auto', host: 'dnb.no', tabId: -1 },
      { orgnr: DNB, method: 'host-auto', host: 'dnb.no', tabId: '4' },
    ]) {
      controller.follow(companyView(EQUINOR, 'www.equinor.com'), 4);
      await settle();
      controller.restore(state);
      await settle();
      expect(results().at(-1)).toMatchObject({ host: 'dnb.no', tabId: undefined });
    }
  });

  it('a kept empty state that now follows another tab clears that tab\'s badge, repainting nothing', async () => {
    const { controller, painter } = setup({
      activeTab: { id: 4, url: 'https://example.com/', title: '' },
      resolveTab: async () => ({ host: 'example.com' }),
    });
    await controller.init({ fresh: false });
    await settle();
    expect(painter.empty).toHaveBeenLastCalledWith(expect.objectContaining({ host: 'example.com', tabId: 4 }));

    // A no-match from tab 9 on the same host: same view, kept.
    await controller.probe('example.com', 9);
    expect(painter.empty).toHaveBeenCalledTimes(1);
    expect(painter.clearBadge).toHaveBeenCalledWith(9);

    // The same tab again: nothing new to clear.
    await controller.probe('example.com', 9);
    expect(painter.clearBadge).toHaveBeenCalledTimes(1);
  });

  it('a result stamps the recents and reads the stored choice for its host', async () => {
    const { controller, deps, results } = setup();
    vi.mocked(deps.getRememberedChoice).mockResolvedValueOnce({ kind: 'choice', orgnr: DNB });
    controller.follow({ kind: 'company', orgnr: DNB, method: 'host-pick', host: 'dnb.no' });
    await settle();
    expect(deps.pushRecent).toHaveBeenCalledWith(DNB, dnb.navn, undefined);
    expect(results()[0]!.remembered).toEqual({ kind: 'choice', orgnr: DNB });
  });

  it('a danger company is stamped with its status, like the popup does', async () => {
    const { controller, deps } = setup();
    vi.mocked(deps.loadCompany).mockResolvedValueOnce({ ...company(DNB), enhet: konkurs });
    controller.follow(companyView(konkurs.organisasjonsnummer));
    await settle();
    expect(deps.pushRecent).toHaveBeenCalledWith(konkurs.organisasjonsnummer, konkurs.navn, 'Konkurs');
  });
});
