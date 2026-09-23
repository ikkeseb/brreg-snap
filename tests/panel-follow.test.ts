// The panel's follow logic without a DOM: which view wins at startup,
// and that a late result can never paint over a newer one. The fake
// `show` mirrors details.ts's painters — it claims the load token and
// settles the view immediately.

import { describe, expect, it, vi } from 'vitest';

import type { DetailedResult } from '../src/lib/hostname-search.js';
import {
  chooseStart,
  createLoadSequence,
  createPanelFollower,
  isReadableSite,
  sameView,
  viewFromContext,
  viewFromHostSearch,
  type FollowerDeps,
  type PanelView,
  type TabFields,
} from '../src/lib/panel-follow.js';
import type { PanelHint } from '../src/lib/panel-protocol.js';
import type { TabContext } from '../src/lib/ui/resolve-tab.js';
import type { SearchHit } from '../src/types/brreg.js';
import dnb from './fixtures/brreg/enhet-984851006-dnb.json';
import equinor from './fixtures/brreg/enhet-923609016-equinor.json';

const DNB = dnb.organisasjonsnummer;
const EQUINOR = equinor.organisasjonsnummer;
const CANDIDATES = [dnb, equinor] as SearchHit[];
const OWN = 'moz-extension://3f1c0d2e-panel/';

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

const noHint: PanelHint = { fresh: false };

describe('createLoadSequence', () => {
  it('makes every older token stale once a newer one is claimed', () => {
    const loads = createLoadSequence();
    const a = loads.begin();
    expect(a.isStale()).toBe(false);
    const b = loads.begin();
    expect(a.isStale()).toBe(true);
    expect(b.isStale()).toBe(false);
  });
});

describe('viewFromContext / viewFromHostSearch', () => {
  it('keeps the resolution method and host for a company', () => {
    expect(
      viewFromContext({ orgnr: DNB, host: 'www.dnb.no', method: 'host-auto' }),
    ).toEqual({ kind: 'company', orgnr: DNB, method: 'host-auto', host: 'www.dnb.no' });
  });

  it('maps candidates to the picker and a failed search to a degraded empty state', () => {
    expect(
      viewFromContext({ host: 'dnb.no', pickerCandidates: CANDIDATES }),
    ).toEqual({ kind: 'picker', host: 'dnb.no', candidates: CANDIDATES });
    expect(viewFromContext({ host: 'x.no', degraded: true })).toEqual({
      kind: 'empty',
      host: 'x.no',
      degraded: true,
    });
    expect(viewFromContext({})).toEqual({
      kind: 'empty',
      host: undefined,
      degraded: false,
    });
  });

  it('host search: auto with candidates is host-auto, a remembered pick is host-pick', () => {
    const auto: DetailedResult = {
      band: 'auto',
      candidates: CANDIDATES,
      choice: DNB,
      complete: true,
    };
    expect(viewFromHostSearch('dnb.no', auto)).toMatchObject({
      kind: 'company',
      method: 'host-auto',
    });
    expect(
      viewFromHostSearch('dnb.no', { ...auto, candidates: [] }),
    ).toMatchObject({ kind: 'company', orgnr: DNB, method: 'host-pick' });
  });

  it('host search: only an incomplete miss is degraded', () => {
    const none: DetailedResult = { band: 'none', candidates: [], complete: true };
    expect(viewFromHostSearch('x.no', none)).toEqual({
      kind: 'empty',
      host: 'x.no',
      degraded: false,
    });
    expect(
      viewFromHostSearch('x.no', { ...none, complete: false }),
    ).toMatchObject({ degraded: true });
    expect(viewFromHostSearch('x.no', undefined)).toMatchObject({
      degraded: false,
    });
  });
});

describe('sameView', () => {
  const company: PanelView = { kind: 'company', orgnr: DNB, method: 'url' };

  it('a company is the same by orgnr, whatever the method or host', () => {
    expect(
      sameView(company, { ...company, method: 'host-auto', host: 'dnb.no' }),
    ).toBe(true);
    expect(sameView(company, { ...company, orgnr: EQUINOR })).toBe(false);
  });

  it('a picker or empty state is the same by host (and degraded flag)', () => {
    const picker: PanelView = { kind: 'picker', host: 'a.no', candidates: [] };
    expect(sameView(picker, { ...picker, candidates: CANDIDATES })).toBe(true);
    expect(sameView(picker, { ...picker, host: 'b.no' })).toBe(false);
    const empty: PanelView = { kind: 'empty', host: 'a.no', degraded: false };
    expect(sameView(empty, { kind: 'empty', host: 'a.no' })).toBe(true);
    expect(sameView(empty, { ...empty, degraded: true })).toBe(false);
  });

  it('nothing settled (loading / error) is never the same', () => {
    expect(sameView(undefined, company)).toBe(false);
    expect(sameView({ kind: 'empty' }, company)).toBe(false);
  });
});

describe('isReadableSite', () => {
  it('rejects a missing URL and the extension’s own pages', () => {
    expect(isReadableSite(undefined, OWN)).toBe(false);
    expect(isReadableSite('', OWN)).toBe(false);
    expect(isReadableSite(`${OWN}details/details.html?orgnr=${DNB}`, OWN)).toBe(
      false,
    );
    expect(isReadableSite('https://www.dnb.no/', OWN)).toBe(true);
  });
});

describe('chooseStart — panel-URL hint vs. the active tab', () => {
  const tabDnb: TabContext = { orgnr: DNB, host: 'www.dnb.no', method: 'host-auto' };
  const tabMiss: TabContext = { host: 'www.vg.no' };

  it('a leftover ?orgnr= never overrides a readable tab', () => {
    const hint = { orgnr: EQUINOR, fresh: false };
    expect(chooseStart(hint, tabDnb)).toEqual(viewFromContext(tabDnb));
  });

  it('a leftover ?orgnr= is not shown under the current site’s name when that site has no match', () => {
    const view = chooseStart({ orgnr: EQUINOR, fresh: false }, tabMiss);
    expect(view).toEqual({ kind: 'empty', host: 'www.vg.no', degraded: false });
  });

  it('a leftover ?nomatch= never overrides a readable tab', () => {
    expect(chooseStart({ nomatch: 'old.example', fresh: false }, tabDnb)).toEqual(
      viewFromContext(tabDnb),
    );
  });

  it('a fresh ?orgnr= the tab agrees with uses the tab (host label + method)', () => {
    expect(chooseStart({ orgnr: DNB, fresh: true }, tabDnb)).toEqual(
      viewFromContext(tabDnb),
    );
  });

  it('a fresh ?orgnr= the tab does not explain wins, without a host label (manual pick in the popup)', () => {
    expect(chooseStart({ orgnr: EQUINOR, fresh: true }, tabDnb)).toEqual({
      kind: 'company',
      orgnr: EQUINOR,
      method: 'url',
    });
  });

  it('a fresh ?nomatch= for the tab’s host uses the tab; another host is probed', () => {
    const picker: TabContext = { host: 'dnb.no', pickerCandidates: CANDIDATES };
    expect(chooseStart({ nomatch: 'dnb.no', fresh: true }, picker)).toEqual(
      viewFromContext(picker),
    );
    expect(chooseStart({ nomatch: 'other.no', fresh: true }, picker)).toEqual({
      kind: 'probe',
      host: 'other.no',
    });
  });

  it('an unreadable tab falls back to the hint, fresh or not', () => {
    expect(chooseStart({ orgnr: DNB, fresh: false }, undefined)).toEqual({
      kind: 'company',
      orgnr: DNB,
      method: 'url',
    });
    expect(chooseStart({ nomatch: 'x.no', fresh: false }, undefined)).toEqual({
      kind: 'probe',
      host: 'x.no',
    });
    expect(chooseStart(noHint, undefined)).toEqual({ kind: 'empty' });
  });
});

// --- the follower ---------------------------------------------------

function makeFollower(overrides: Partial<FollowerDeps> = {}) {
  const loads = createLoadSequence();
  let onScreen: PanelView | undefined;
  const shown: PanelView[] = [];
  const kept: PanelView[] = [];
  const deps: FollowerDeps = {
    loads,
    ownUrlPrefix: OWN,
    queryActiveTab: vi.fn(async (): Promise<TabFields | undefined> => undefined),
    getTab: vi.fn(async (): Promise<TabFields> => ({})),
    resolveTab: vi.fn(async (): Promise<TabContext> => ({})),
    searchHost: vi.fn(async (): Promise<DetailedResult | undefined> => undefined),
    onScreen: () => onScreen,
    show: (view) => {
      loads.begin();
      onScreen = view;
      shown.push(view);
    },
    keep: (view) => {
      onScreen = view;
      kept.push(view);
    },
    ...overrides,
  };
  return { follower: createPanelFollower(deps), deps, loads, shown, kept };
}

const companyView = (orgnr: string, host?: string): PanelView => ({
  kind: 'company',
  orgnr,
  method: 'host-auto',
  host,
});

describe('follower — a late result never paints over a newer one', () => {
  it('no-match re-probe for A, then a sync for B, then A resolves: B stays', async () => {
    const searchA = deferred<DetailedResult | undefined>();
    const { follower, shown } = makeFollower({
      searchHost: vi.fn(() => searchA.promise),
    });

    const probing = follower.probe('a.example');
    follower.follow(companyView(EQUINOR, 'www.equinor.com'));
    searchA.resolve({ band: 'picker', candidates: CANDIDATES, complete: true });
    await probing;

    expect(shown).toEqual([companyView(EQUINOR, 'www.equinor.com')]);
  });

  it('a slow tab activation loses to a later, faster one', async () => {
    const slowGet = deferred<TabFields>();
    const resolveTab = vi.fn(async (url: string): Promise<TabContext> =>
      url.includes('dnb')
        ? { orgnr: DNB, host: 'www.dnb.no', method: 'url' }
        : { orgnr: EQUINOR, host: 'www.equinor.com', method: 'url' },
    );
    const { follower, shown } = makeFollower({
      getTab: vi.fn(() => slowGet.promise),
      resolveTab,
    });

    const first = follower.followTab(1);
    await follower.followTab(2, { url: 'https://www.equinor.com/', title: '' });
    slowGet.resolve({ url: 'https://www.dnb.no/', title: '' });
    await first;

    expect(shown.map((v) => v.kind === 'company' && v.orgnr)).toEqual([EQUINOR]);
  });

  it('startup resolution loses to a sync that lands while it resolves', async () => {
    const slowResolve = deferred<TabContext>();
    const { follower, shown } = makeFollower({
      queryActiveTab: vi.fn(async () => ({ url: 'https://www.dnb.no/', title: '' })),
      resolveTab: vi.fn(() => slowResolve.promise),
    });

    const starting = follower.start(noHint);
    await settle();
    follower.follow(companyView(EQUINOR));
    slowResolve.resolve({ orgnr: DNB, host: 'www.dnb.no', method: 'host-auto' });
    await starting;

    expect(shown).toEqual([companyView(EQUINOR)]);
  });

  it('a user action that paints after a tab event arrived wins over its late result', async () => {
    const slowResolve = deferred<TabContext>();
    const { follower, deps, shown } = makeFollower({
      resolveTab: vi.fn(() => slowResolve.promise),
    });

    const following = follower.followTab(1, { url: 'https://www.dnb.no/' });
    // e.g. a drill-in click: details.ts's painters claim the token.
    deps.show(companyView(EQUINOR));
    slowResolve.resolve({ orgnr: DNB, host: 'www.dnb.no', method: 'host-auto' });
    await following;

    expect(shown).toEqual([companyView(EQUINOR)]);
  });

  it('a tab that closed before it could be read still clears a stale load', async () => {
    const { follower, shown } = makeFollower({
      getTab: vi.fn(() => Promise.reject(new Error('No tab with id: 9'))),
    });
    await follower.followTab(9);
    expect(shown).toEqual([{ kind: 'empty' }]);
  });

  it('a failed host search reads as "couldn’t check", not "no match"', async () => {
    const { follower, shown } = makeFollower({
      searchHost: vi.fn(() => Promise.reject(new Error('offline'))),
    });
    await follower.probe('x.no');
    expect(shown).toEqual([{ kind: 'empty', host: 'x.no', degraded: true }]);
  });
});

describe('follower — the view already on screen is kept, not repainted', () => {
  it('a sync for the company on screen keeps it and refreshes how it was reached', async () => {
    const { follower, shown, kept } = makeFollower({
      queryActiveTab: vi.fn(async () => ({ url: `https://x.no/${DNB}` })),
      resolveTab: vi.fn(async (): Promise<TabContext> => ({
        orgnr: DNB,
        host: 'x.no',
        method: 'url',
      })),
    });
    await follower.start(noHint);
    expect(shown).toHaveLength(1);

    follower.follow(companyView(DNB, 'www.dnb.no'));
    expect(shown).toHaveLength(1);
    expect(kept).toEqual([companyView(DNB, 'www.dnb.no')]);

    follower.follow(companyView(EQUINOR));
    expect(shown).toHaveLength(2);
  });

  it('a same-site navigation (tab event) keeps the company, the picker and a half-typed empty state', async () => {
    const ctx: { value: TabContext } = {
      value: { orgnr: DNB, host: 'www.dnb.no', method: 'host-auto' },
    };
    const { follower, shown, kept } = makeFollower({
      resolveTab: vi.fn(async () => ctx.value),
    });
    const nav = { url: 'https://www.dnb.no/privat', title: '' };

    await follower.followTab(1, nav);
    await follower.followTab(1, { ...nav, url: 'https://www.dnb.no/bedrift' });
    ctx.value = { host: 'www.dnb.no', pickerCandidates: CANDIDATES };
    await follower.followTab(1, nav);
    await follower.followTab(1, nav);
    ctx.value = { host: 'www.dnb.no' };
    await follower.followTab(1, nav);
    await follower.followTab(1, nav);

    expect(shown.map((v) => v.kind)).toEqual(['company', 'picker', 'empty']);
    expect(kept.map((v) => v.kind)).toEqual(['company', 'picker', 'empty']);
  });
});

describe('follower — what it resolves', () => {
  it('never resolves the extension’s own page (its id would go to brreg as a host)', async () => {
    const { follower, deps, shown } = makeFollower();
    await follower.followTab(1, { url: `${OWN}details/details.html`, title: 'brreg-snap' });
    expect(deps.resolveTab).not.toHaveBeenCalled();
    expect(shown).toEqual([{ kind: 'empty' }]);
  });

  it('a panel opened as a tab on its own page falls back to its hint', async () => {
    const { follower, deps, shown } = makeFollower({
      queryActiveTab: vi.fn(async () => ({ url: `${OWN}details/details.html?nomatch=x.no` })),
      searchHost: vi.fn(async (): Promise<DetailedResult> => ({
        band: 'none',
        candidates: [],
        complete: true,
      })),
    });
    await follower.start({ nomatch: 'x.no', fresh: false });
    expect(deps.resolveTab).not.toHaveBeenCalled();
    expect(deps.searchHost).toHaveBeenCalledWith('x.no');
    expect(shown).toEqual([{ kind: 'empty', host: 'x.no', degraded: false }]);
  });

  it('an unreadable active tab (no grant) uses the hint without resolving anything', async () => {
    const { follower, deps, shown } = makeFollower({
      queryActiveTab: vi.fn(async () => ({})),
    });
    await follower.start({ orgnr: DNB, fresh: false });
    expect(deps.resolveTab).not.toHaveBeenCalled();
    expect(shown).toEqual([{ kind: 'company', orgnr: DNB, method: 'url' }]);
  });

  it('an unreadable tab event (revoke racing the event) clears the panel without a lookup', async () => {
    const { follower, deps, shown } = makeFollower({
      getTab: vi.fn(async () => ({ title: 'VG' })),
    });
    await follower.followTab(4);
    expect(deps.resolveTab).not.toHaveBeenCalled();
    expect(shown).toEqual([{ kind: 'empty' }]);
  });
});
