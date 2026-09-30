// The panel's state machine. Every way the panel moves — its own
// startup, a tab event, a message, a picker pick, a drill-in, Back,
// «Feil bedrift?», «Glem valget», «Prøv igjen», «Oppdater», a search —
// is an intent here; what ends up on screen goes through the painter
// (view.ts). No DOM: window and document reach this module only as
// injected deps (history.ts, hasFocus), so it is tested with fakes.

import type { CompanyData, LoadCompanyOptions } from '../lib/company-load.js';
import { isPermanentLoadError } from '../lib/company-load.js';
import type {
  Candidate,
  DetailedResult,
  RememberedChoice,
} from '../lib/hostname-search.js';
import { isValidOrgnr } from '../lib/mod11.js';
import {
  createLoadSequence,
  createPanelFollower,
  viewFromHostSearch,
  type FollowOrigin,
  type LoadSequence,
  type LoadToken,
  type PanelFollower,
  type PanelView,
  type TabFields,
} from '../lib/panel-follow.js';
import type { PanelHint } from '../lib/panel-protocol.js';
import {
  UNKNOWN_URL_METHOD,
  type ResolutionMethod,
} from '../lib/resolution-method.js';
import type { TabContext } from '../lib/ui/resolve-tab.js';
import type { PanelHistory } from './history.js';
import type { PanelIntents, PanelPainter, ResultFocus } from './view.js';

export interface ControllerDeps {
  // Built with the controller's intents, so the painter can call back.
  painter: (intents: PanelIntents) => PanelPainter;
  history: PanelHistory;
  // document.hasFocus(): focus is moved only when the panel window
  // itself has it — with auto-sync on, a tab switch repaints this
  // panel in the background, and an unconditional focus() would yank
  // keyboard focus out of the page.
  hasFocus: () => boolean;
  // browser.runtime.getURL('') — panel-follow.ts § isReadableSite.
  ownUrlPrefix: string;
  queryActiveTab: () => Promise<TabFields | undefined>;
  getTab: (tabId: number) => Promise<TabFields>;
  resolveTab: (url: string, title: string) => Promise<TabContext>;
  // `title`: the tab's title as a word-boundary hint (hostname-search.ts
  // § title segmentation). Given only when the panel has one for the host.
  searchHost: (host: string, title?: string) => Promise<DetailedResult | undefined>;
  // Called with PANEL_LOAD_OPTIONS (plus the group tree in hand on a
  // drill-in within the same konsern).
  loadCompany: (orgnr: string, opts: LoadCompanyOptions) => Promise<CompanyData>;
  invalidateCache: (orgnr: string) => Promise<void>;
  pushRecent: (orgnr: string, navn: string) => Promise<void>;
  addRejectedChoice: (host: string, orgnr: string) => Promise<void>;
  forgetHost: (host: string) => Promise<void>;
  getRememberedChoice: (host: string) => Promise<RememberedChoice | undefined>;
  loads?: LoadSequence;
}

// What the panel fetches for a company: everything the dossier paints.
// The popup asks for less (konsern only); this is the one place the
// panel's set lives.
export const PANEL_LOAD_OPTIONS: LoadCompanyOptions = {
  underenheter: true,
  endringer: true,
  konsern: true,
  aarsregnskapYears: true,
};

export interface PanelController {
  intents: PanelIntents;
  // Startup: the stamped panel-URL hint against the active tab.
  init(hint: PanelHint): Promise<void>;
  // A tab in this panel's window became active or navigated.
  followTab(tabId: number, tab?: TabFields): Promise<void>;
  // A sync message: the sender already resolved the view.
  follow(view: PanelView): void;
  // A no-match message: resolve the host here.
  probe(host: string | undefined): Promise<void>;
  // popstate: restore the entry the browser moved to.
  restore(state: unknown): void;
}

export function createPanelController(deps: ControllerDeps): PanelController {
  const { history } = deps;
  // Every flow that ends in a paint claims a token from this one
  // sequence (the painters below claim their own; flows that await
  // first claim at entry) and drops its result once a newer flow has
  // started. See panel-follow.ts.
  const loads = deps.loads ?? createLoadSequence();

  // The orgnr asked for (URL, sync, search). For an underenhet that is
  // not the company on screen — see shownEnhetOrgnr.
  let currentOrgnr: string | undefined;
  // The enhet actually rendered: currentOrgnr, or its parent when
  // currentOrgnr is an underenhet. «Oppdater» drops both from the cache.
  let shownEnhetOrgnr: string | undefined;
  let currentMethod: ResolutionMethod | undefined;
  // The site the view on screen came from («Synket fra <host>»), also
  // snapshotted into every history entry written. Cleared by a
  // drill-in and a manual / recents pick: those have nothing to do
  // with the site.
  let currentHost: string | undefined;
  // The title of the tab the follower last resolved, keyed by that tab's
  // host: «Feil bedrift?» re-runs the host search with its word hints.
  let lastTabTitle: { host: string; title: string } | undefined;
  // The tab the panel follows (resolved at startup or on a tab event).
  // Every paint names it, so the painter can set or clear its toolbar
  // badge; a message or a probe never changes it.
  let followedTabId: number | undefined;
  // What the panel settled on (result / picker / empty) — undefined
  // while loading or on error. Lets a sync or tab event for what's
  // already shown keep it instead of repainting through the skeleton.
  let onScreen: PanelView | undefined;
  // The load whose result is on screen. renderParent's late name upgrade
  // checks this rather than the load token: a sync that keeps the same
  // company claims a token but leaves this load's result standing.
  let shownLoad: LoadToken | undefined;
  // Re-trigger for the «Prøv igjen» button in the full error state, or
  // under a degraded empty state (the host search failed).
  let lastLoad: (() => void) | undefined;
  // The group tree of the last company loaded (company-load.ts). A
  // drill-in within the same konsern derives its place from it instead
  // of fetching the tree again.
  let lastTree: CompanyData['konsernTree'];

  // Focus moves only for a user-initiated flow, and only when the
  // panel window has focus. A background tab event never asks for it.
  const focusFor = (origin: FollowOrigin): boolean =>
    origin !== 'tab' && deps.hasFocus();

  const titleFor = (host: string): string | undefined =>
    lastTabTitle?.host === host ? lastTabTitle.title : undefined;

  // The picker persists the choice before calling back. If a tab event
  // or sync repainted the panel during that write, the pick is for a
  // picker no longer on screen: keep the newer view (the choice is saved
  // and applies next time the host resolves).
  function pickerStillShown(host: string): boolean {
    return onScreen?.kind === 'picker' && onScreen.host === host;
  }

  function leaveResult(): void {
    onScreen = undefined;
    shownLoad = undefined;
  }

  async function loadOrgnr(
    orgnr: string,
    method?: ResolutionMethod,
    opts: {
      focus?: ResultFocus;
      // «Oppdater»: orgnrs whose cached data is dropped first, so every
      // part is refetched from brreg.
      invalidate?: Array<string | undefined>;
      // A drill-in or a Back within a group: hand the tree in hand to
      // company-load, which uses it when the orgnr sits in it.
      reuseTree?: boolean;
    } = {},
  ): Promise<void> {
    // If a second sync lands while this one is still in flight, the
    // older fetches must not overwrite the newer ones when they land out
    // of order.
    const run = loads.begin();
    currentOrgnr = orgnr;
    if (method !== undefined) currentMethod = method;
    lastLoad = () => {
      void loadOrgnr(orgnr, method);
    };
    const host = currentHost;
    leaveResult();
    painter.loading(orgnr);
    painter.setBack(false);
    // Read when the paint happens, not when the load starts: the user
    // may have clicked into the page meanwhile.
    const focus = (): ResultFocus => (deps.hasFocus() ? (opts.focus ?? 'none') : 'none');

    try {
      if (opts.invalidate) {
        const orgnrs = new Set(opts.invalidate.filter((n) => n !== undefined));
        await Promise.all([...orgnrs].map((n) => deps.invalidateCache(n)));
      }
      // The fetch-and-failure policy is shared with the popup: roller,
      // underenheter and regnskap come back undefined when their fetch
      // failed ("couldn't ask"), and each renderer says so instead of
      // claiming an empty registry. An underenhet orgnr loads its parent.
      const loadOpts: LoadCompanyOptions = { ...PANEL_LOAD_OPTIONS };
      if (opts.reuseTree && lastTree) loadOpts.konsernTree = lastTree;
      const [company, remembered] = await Promise.all([
        deps.loadCompany(orgnr, loadOpts),
        host === undefined ? undefined : deps.getRememberedChoice(host),
      ]);
      if (run.isStale()) return;
      const { enhet } = company;
      lastTree = company.konsernTree;

      // Stamp the recent stack now that the Enhet is confirmed — same
      // rule as the popup: never persist orgnrs that failed to fetch.
      void deps.pushRecent(enhet.organisasjonsnummer, enhet.navn);
      shownEnhetOrgnr = enhet.organisasjonsnummer;
      shownLoad = run;
      onScreen = {
        kind: 'company',
        orgnr,
        method: currentMethod ?? UNKNOWN_URL_METHOD,
        host,
      };
      painter.result({
        company,
        method: currentMethod,
        host,
        remembered,
        fetchedAt: company.fetchedAt,
        isStale: () => shownLoad !== run,
        focus: focus(),
        tabId: followedTabId,
      });
      painter.setBack(history.current()?.method === 'drill-in');
    } catch (err) {
      if (run.isStale()) return;
      painter.error(err, {
        // «Prøv igjen» only makes sense when there is a load to
        // re-trigger and asking again could change the answer — a
        // not-found can't.
        retry: lastLoad !== undefined && !isPermanentLoadError(err),
        focus: focus() !== 'none',
        tabId: followedTabId,
      });
    }
  }

  // The painters claim the token: an in-flight load must not land on
  // top of a picker or an empty state.
  function showPicker(host: string, candidates: Candidate[], focus: boolean): void {
    loads.begin();
    onScreen = { kind: 'picker', host, candidates };
    shownLoad = undefined;
    currentHost = host;
    currentOrgnr = undefined;
    history.clearOrgnr();
    painter.picker(host, candidates, { focus, tabId: followedTabId });
    painter.setBack(false);
  }

  function showEmpty(
    view: { host?: string; degraded?: boolean; query?: string },
    focus: boolean,
  ): void {
    loads.begin();
    onScreen = {
      kind: 'empty',
      host: view.host,
      degraded: view.degraded,
      query: view.query,
    };
    shownLoad = undefined;
    currentHost = view.host;
    currentOrgnr = undefined;
    history.clearOrgnr();
    // «Prøv igjen» under a degraded empty state re-runs the host search.
    if (view.degraded && view.host) {
      const host = view.host;
      lastLoad = () => {
        void follower.probe(host);
      };
    }
    painter.empty({
      host: view.host,
      degraded: view.degraded === true,
      query: view.query,
      focus,
      tabId: followedTabId,
    });
    painter.setBack(false);
  }

  // Paint a view the panel isn't showing yet.
  function showView(view: PanelView, origin: FollowOrigin): void {
    switch (view.kind) {
      case 'company':
        currentHost = view.host;
        // replaceState, not push — this tracks the active tab, not a
        // navigation the user wants to reverse.
        history.setOrgnr(view.orgnr, view.method, view.host, { push: false });
        void loadOrgnr(view.orgnr, view.method);
        return;
      case 'picker':
        showPicker(view.host, view.candidates, focusFor(origin));
        return;
      case 'empty':
        showEmpty(view, focusFor(origin));
        return;
    }
  }

  // The view is already on screen. A company keeps its rendered result
  // (no skeleton, scroll and focus stay put); only how it was reached —
  // the footer host and the «Feil bedrift?» method — is refreshed. A
  // picker or empty state for the same host is left alone, including a
  // half-typed manual search.
  function keepView(view: PanelView): void {
    if (view.kind !== 'company') return;
    currentHost = view.host;
    currentMethod = view.method;
    history.setOrgnr(view.orgnr, view.method, view.host, { push: false });
    onScreen = view;
    painter.setBack(history.current()?.method === 'drill-in');
    // The stored choice for the new host is read again: the kept
    // result must not keep offering «Glem valget» for the old one.
    const load = shownLoad;
    void (async () => {
      const remembered =
        view.host === undefined ? undefined : await deps.getRememberedChoice(view.host);
      if (shownLoad !== load || onScreen !== view) return;
      painter.provenance({ method: view.method, host: view.host, remembered, tabId: followedTabId });
    })();
  }

  const follower: PanelFollower = createPanelFollower({
    loads,
    ownUrlPrefix: deps.ownUrlPrefix,
    queryActiveTab: deps.queryActiveTab,
    getTab: deps.getTab,
    resolveTab: async (url, title) => {
      const ctx = await deps.resolveTab(url, title);
      lastTabTitle = ctx.host && title ? { host: ctx.host, title } : undefined;
      return ctx;
    },
    searchHost: (host) => deps.searchHost(host),
    onScreen: () => onScreen,
    show: (view, origin, tabId) => {
      if (tabId !== undefined) followedTabId = tabId;
      showView(view, origin);
    },
    keep: (view, origin, tabId) => {
      if (tabId !== undefined) followedTabId = tabId;
      keepView(view);
    },
  });

  const intents: PanelIntents = {
    // Pushes a history entry so the browser Back button returns to the
    // entity the user came from. Drilled-in entities aren't
    // host-resolved — the source host is cleared first so the footer
    // doesn't keep claiming «Synket fra <host>» (and so the snapshot in
    // the new entry is host-less), and the load is 'drill-in' so «Feil
    // bedrift?» stays hidden.
    drill(orgnr): void {
      if (!isValidOrgnr(orgnr)) return;
      currentHost = undefined;
      history.setOrgnr(orgnr, 'drill-in', undefined, { push: true });
      void loadOrgnr(orgnr, 'drill-in', { focus: 'heading', reuseTree: true });
    },

    back(): void {
      history.back();
    },

    // «Feil bedrift?» awaits a storage write and a fresh host search
    // before it paints, so it claims a load token on the click: a tab
    // event or sync that arrives meanwhile wins over its late picker.
    async reject(): Promise<void> {
      const host = currentHost;
      const orgnr = currentOrgnr;
      if (!host || !orgnr) return;
      const run = loads.begin();
      // The rejection is stored either way; only the paint is dropped.
      await deps.addRejectedChoice(host, orgnr);
      if (run.isStale()) return;
      // Only the title of a tab on this very host: a view that came
      // from a sync message or a probe has none to offer.
      const detailed = await deps.searchHost(host, titleFor(host));
      if (run.isStale()) return;
      if (detailed && detailed.candidates.length > 0) {
        // Always show the picker (even if a single candidate now wins
        // band='auto') — the user just expressed doubt; let them confirm.
        showPicker(host, detailed.candidates, deps.hasFocus());
        return;
      }
      showEmpty({ host }, deps.hasFocus());
    },

    // Drops the picker choice / «Ingen av disse» / rejections stored
    // for the site, then resolves the host as a no-match probe would —
    // through the follower, so the same company is kept, not repainted.
    async forget(): Promise<void> {
      const host = currentHost;
      if (!host) return;
      const run = loads.begin();
      await deps.forgetHost(host);
      if (run.isStale()) return;
      let view: PanelView;
      try {
        view = viewFromHostSearch(host, await deps.searchHost(host, titleFor(host)));
      } catch {
        view = { kind: 'empty', host, degraded: true };
      }
      if (run.isStale()) return;
      follower.follow(view);
    },

    retry(): void {
      lastLoad?.();
    },

    // Refetch the company on screen instead of serving the cached copy.
    // Only offered with a result.
    refresh(): void {
      if (!currentOrgnr || onScreen?.kind !== 'company') return;
      void loadOrgnr(currentOrgnr, currentMethod, {
        invalidate: [currentOrgnr, shownEnhetOrgnr],
        focus: 'refresh',
      });
    },

    pick(host, orgnr): void {
      if (!pickerStillShown(host)) return;
      history.setOrgnr(orgnr, 'host-pick', host, { push: false });
      void loadOrgnr(orgnr, 'host-pick');
    },

    none(host): void {
      if (!pickerStillShown(host)) return;
      showEmpty({ host }, deps.hasFocus());
    },

    // A company picked from the manual search or the recents list. The
    // empty state it came from may name a host («Ingen bedrift
    // identifisert på example.com»), but the pick has nothing to do
    // with that site: the source host is cleared so the footer doesn't
    // claim «Synket fra example.com».
    manual(orgnr): void {
      loadPick(orgnr);
    },

    recent(orgnr): void {
      loadPick(orgnr);
    },

    search(query): void {
      follower.follow({ kind: 'empty', query });
    },

    selectTab(key): void {
      history.setTab(key);
    },
  };

  function loadPick(orgnr: string): void {
    currentHost = undefined;
    history.setOrgnr(orgnr, 'manual', undefined, { push: false });
    void loadOrgnr(orgnr, 'manual');
  }

  const painter = deps.painter(intents);

  return {
    intents,

    init(hint): Promise<void> {
      history.dropStamp();
      return follower.start(hint);
    },

    followTab: (tabId, tab) => follower.followTab(tabId, tab),
    follow: (view) => follower.follow(view),
    probe: (host) => follower.probe(host),

    // Browser Back / Forward within the panel — only reachable after an
    // in-panel drill-in pushed an entry. Restore from history.state,
    // falling back to the URL params for the initial entry (which may
    // predate state stamping). Each branch paints through a function
    // that claims the load token, so a slower in-flight load can't
    // paint over the restored entry when it lands.
    restore(state): void {
      const entry = history.entryOf(state);
      const orgnr = entry?.orgnr ?? history.orgnrFromUrl();
      if (orgnr && isValidOrgnr(orgnr)) {
        currentHost = entry?.host;
        void loadOrgnr(orgnr, entry?.method ?? UNKNOWN_URL_METHOD, {
          focus: 'heading',
          reuseTree: true,
        });
        // Re-activate the tab the restored entry's URL records, so the
        // selected tab matches the ?tab= it was left on instead of
        // keeping whatever the user last clicked before navigating
        // away. An entry with no ?tab= (e.g. the initial one) restores
        // the default tab.
        painter.selectTab(history.tabFromUrl() ?? 'oversikt');
        return;
      }
      const host = history.noMatchFromUrl();
      if (host !== undefined) {
        void follower.probe(host);
        return;
      }
      showEmpty({}, deps.hasFocus());
    },
  };
}
