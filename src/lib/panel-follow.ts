// How the panel (details.ts) decides what to show when something
// outside it moves: its own startup, a tab event while auto-sync is
// on, a sync / no-match message from the popup or the context menu.
// The DOM painting stays in details.ts behind the `show` / `keep`
// callbacks; the ordering and "is this still the latest?" logic lives
// here so it can be tested without a DOM.

import type { DetailedResult } from './hostname-search.js';
import type { PanelHint } from './panel-protocol.js';
import type { ResolutionMethod, TabContext } from './ui/resolve-tab.js';
import type { SearchHit } from '../types/brreg.js';

// --- load token -------------------------------------------------------
//
// One monotonic token for every flow that ends in a paint. A flow
// claims a token synchronously when it starts — so arrival order, not
// whichever network call returns last, decides what ends up on screen
// — and checks it after every await. A newer claim makes all older
// tokens stale and their late results are dropped.

export interface LoadToken {
  /** True once a newer flow has claimed a token. */
  isStale(): boolean;
}

export interface LoadSequence {
  begin(): LoadToken;
}

export function createLoadSequence(): LoadSequence {
  let latest = 0;
  return {
    begin(): LoadToken {
      const mine = ++latest;
      return { isStale: () => mine !== latest };
    },
  };
}

// --- views ----------------------------------------------------------

export type PanelView =
  | {
      kind: 'company';
      orgnr: string;
      method: ResolutionMethod;
      host?: string;
    }
  | { kind: 'picker'; host: string; candidates: SearchHit[] }
  | { kind: 'empty'; host?: string; degraded?: boolean };

export function viewFromContext(ctx: TabContext): PanelView {
  if (ctx.orgnr) {
    return {
      kind: 'company',
      orgnr: ctx.orgnr,
      method: ctx.method ?? 'url',
      host: ctx.host,
    };
  }
  if (ctx.pickerCandidates && ctx.host) {
    return { kind: 'picker', host: ctx.host, candidates: ctx.pickerCandidates };
  }
  return { kind: 'empty', host: ctx.host, degraded: ctx.degraded === true };
}

// Same band → view mapping as resolveTabContext, for a host the panel
// was handed without a URL (no-match message, ?nomatch= hint).
export function viewFromHostSearch(
  host: string,
  detailed: DetailedResult | undefined,
): PanelView {
  if (detailed?.band === 'picker') {
    return { kind: 'picker', host, candidates: detailed.candidates };
  }
  if (detailed?.band === 'auto' && detailed.choice) {
    // No candidates means the choice came from an earlier picker pick.
    const method: ResolutionMethod =
      detailed.candidates.length === 0 ? 'host-pick' : 'host-auto';
    return { kind: 'company', orgnr: detailed.choice, method, host };
  }
  return {
    kind: 'empty',
    host,
    degraded: detailed !== undefined && !detailed.complete,
  };
}

// Whether `next` is what the panel already shows. The panel then keeps
// its content (scroll position, focus, the open tab, a half-typed
// search) instead of repainting through the skeleton — auto-sync fires
// on every URL change of the active tab, most of which stay on the
// same company.
export function sameView(
  onScreen: PanelView | undefined,
  next: PanelView,
): boolean {
  if (!onScreen || onScreen.kind !== next.kind) return false;
  switch (next.kind) {
    case 'company':
      return onScreen.kind === 'company' && onScreen.orgnr === next.orgnr;
    case 'picker':
      return onScreen.kind === 'picker' && onScreen.host === next.host;
    case 'empty':
      return (
        onScreen.kind === 'empty' &&
        onScreen.host === next.host &&
        (onScreen.degraded ?? false) === (next.degraded ?? false)
      );
  }
}

// A tab URL the panel can resolve: present (the extension may read it)
// and not one of the extension's own pages — the panel opened as a
// normal tab would otherwise "resolve" itself and send its own
// extension id to brreg as a hostname.
export function isReadableSite(
  url: string | undefined,
  ownUrlPrefix: string,
): url is string {
  return !!url && !url.startsWith(ownUrlPrefix);
}

export type StartPlan = PanelView | { kind: 'probe'; host: string };

// What a freshly loaded panel shows. `tab` is the active tab's
// resolution, or undefined when the tab couldn't be read (no activeTab
// grant, no `tabs` opt-in).
//
//   1. A fresh hint (written by the open that loaded this panel) wins
//      unless the tab already explains it — the tab's resolution then
//      carries the host label and method the hint lacks.
//   2. Otherwise a readable tab wins: a leftover hint from an earlier
//      open must not override the page the user is on now.
//   3. Only when the tab can't be read does a leftover hint apply. A
//      hint orgnr is never paired with a host label: it didn't come
//      from this tab.
export function chooseStart(
  hint: PanelHint,
  tab: TabContext | undefined,
): StartPlan {
  if (tab && !hint.fresh) return viewFromContext(tab);
  if (tab && hint.orgnr !== undefined && tab.orgnr === hint.orgnr) {
    return viewFromContext(tab);
  }
  if (tab && hint.nomatch !== undefined && tab.host === hint.nomatch) {
    return viewFromContext(tab);
  }
  if (hint.orgnr !== undefined) {
    return { kind: 'company', orgnr: hint.orgnr, method: 'url' };
  }
  if (hint.nomatch !== undefined) return { kind: 'probe', host: hint.nomatch };
  return tab ? viewFromContext(tab) : { kind: 'empty' };
}

// --- the follower ---------------------------------------------------

export interface TabFields {
  url?: string;
  title?: string;
}

export interface FollowerDeps {
  loads: LoadSequence;
  // browser.runtime.getURL('') — see isReadableSite.
  ownUrlPrefix: string;
  queryActiveTab(): Promise<TabFields | undefined>;
  getTab(tabId: number): Promise<TabFields>;
  resolveTab(url: string, title: string): Promise<TabContext>;
  searchHost(host: string): Promise<DetailedResult | undefined>;
  onScreen(): PanelView | undefined;
  // Paint a different view. The painters claim their own load token.
  show(view: PanelView): void;
  // `view` is already on screen: refresh its host label / method only.
  keep(view: PanelView): void;
}

export interface PanelFollower {
  start(hint: PanelHint): Promise<void>;
  // A tab in this panel's window became active (tab omitted) or the
  // active one navigated (tab given — onUpdated hands it over).
  followTab(tabId: number, tab?: TabFields): Promise<void>;
  // A sync message: the sender already resolved the view.
  follow(view: PanelView): void;
  // A no-match message or ?nomatch= history entry: resolve the host.
  probe(host: string | undefined): Promise<void>;
}

export function createPanelFollower(deps: FollowerDeps): PanelFollower {
  function apply(view: PanelView): void {
    if (sameView(deps.onScreen(), view)) deps.keep(view);
    else deps.show(view);
  }

  async function probeWith(
    run: LoadToken,
    host: string | undefined,
  ): Promise<void> {
    if (!host) {
      apply({ kind: 'empty' });
      return;
    }
    let view: PanelView;
    try {
      view = viewFromHostSearch(host, await deps.searchHost(host));
    } catch {
      view = { kind: 'empty', host, degraded: true };
    }
    if (run.isStale()) return;
    apply(view);
  }

  async function readTab(
    run: LoadToken,
    tab: TabFields | undefined,
  ): Promise<TabContext | undefined> {
    if (!tab || !isReadableSite(tab.url, deps.ownUrlPrefix)) return undefined;
    const ctx = await deps.resolveTab(tab.url, tab.title ?? '');
    return run.isStale() ? undefined : ctx;
  }

  return {
    async start(hint) {
      const run = deps.loads.begin();
      let tab: TabContext | undefined;
      try {
        tab = await readTab(run, await deps.queryActiveTab());
      } catch {
        tab = undefined;
      }
      if (run.isStale()) return;
      const plan = chooseStart(hint, tab);
      if (plan.kind === 'probe') {
        await probeWith(run, plan.host);
        return;
      }
      apply(plan);
    },

    async followTab(tabId, given) {
      const run = deps.loads.begin();
      let view: PanelView;
      try {
        const tab = given ?? (await deps.getTab(tabId));
        if (run.isStale()) return;
        const ctx = await readTab(run, tab);
        // An unreadable tab (about:, the extension's own pages, a
        // revoke racing this event) clears the panel like any other
        // page brreg-snap can't resolve.
        view = ctx ? viewFromContext(ctx) : { kind: 'empty' };
      } catch {
        // The tab closed before we could read it. Painting still
        // matters: this event already made any in-flight load stale.
        view = { kind: 'empty' };
      }
      if (run.isStale()) return;
      apply(view);
    },

    follow(view) {
      // Claim even when the view is kept: an older tab event still
      // resolving must not paint over what this newer message says.
      deps.loads.begin();
      apply(view);
    },

    async probe(host) {
      await probeWith(deps.loads.begin(), host);
    },
  };
}
