// The panel's history entries: ?orgnr= (with the resolution method,
// source host and followed tab stamped into history.state), ?nomatch=,
// ?tab=, and the ?at= stamp of a panel-URL hint. Everything the
// controller does to window.history / window.location goes through
// here, against an injectable window shape, so the controller is
// tested with a fake.

import { isValidOrgnr } from '../lib/mod11.js';
import { isTabId } from '../lib/panel-protocol.js';
import {
  RESOLUTION_METHODS,
  type ResolutionMethod,
} from '../lib/resolution-method.js';

// Shape stored in history.state for an orgnr entry, so popstate can
// restore the company, its override-button method, the footer host and
// the tab it was painted for (its toolbar badge) without re-resolving.
export interface HistoryEntry {
  orgnr: string;
  method: ResolutionMethod;
  host?: string;
  tabId?: number;
}

export function isHistoryEntry(value: unknown): value is HistoryEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { orgnr?: unknown }).orgnr === 'string' &&
    RESOLUTION_METHODS.includes((value as { method?: unknown }).method as ResolutionMethod)
  );
}

// The slice of `window` the history needs. `window` itself satisfies it.
export interface HistoryWindow {
  history: {
    readonly state: unknown;
    pushState(state: unknown, unused: string, url: string): void;
    replaceState(state: unknown, unused: string, url: string): void;
    back(): void;
  };
  location: {
    readonly href: string;
    readonly search: string;
  };
}

export interface PanelHistory {
  // The current entry, when it is a stamped orgnr entry.
  current(): HistoryEntry | undefined;
  // A popstate event's state, when it is a stamped orgnr entry.
  entryOf(state: unknown): HistoryEntry | undefined;
  // Single writer for the ?orgnr= entry. `push: true` adds a new
  // entry (in-panel drill-in, so Back returns to where you came from);
  // `push: false` replaces it (resolving the active tab, sync,
  // no-match, init reconcile — these track the current tab, not a
  // navigation the user wants to reverse). The method is stamped into
  // history.state so popstate can restore the right override-button
  // visibility on Back; the host so a Back/Forward restores the footer
  // label too; `tabId` (the tab the panel follows) so it restores the
  // tab whose badge the entry describes.
  setOrgnr(
    orgnr: string,
    method: ResolutionMethod,
    host: string | undefined,
    opts: { push: boolean; tabId: number | undefined },
  ): void;
  // Clear any orgnr left in the URL so a panel reload doesn't re-fetch
  // the stale company.
  clearOrgnr(): void;
  // Drop the ?at= stamp of a panel-URL hint once read, so a later
  // reload of the panel doesn't treat it as fresh.
  dropStamp(): void;
  // ?tab= moves alone: the current orgnr entry is kept, so a drill-in
  // still records which tab the user was reading.
  setTab(key: string): void;
  tabFromUrl(): string | undefined;
  // A valid ?orgnr= (the initial entry may predate state stamping).
  orgnrFromUrl(): string | undefined;
  noMatchFromUrl(): string | undefined;
  // Browser Back; the popstate listener does the actual restore.
  back(): void;
}

export function createPanelHistory(win: HistoryWindow): PanelHistory {
  const params = (): URLSearchParams => new URLSearchParams(win.location.search);

  // An entry written before the tab was stamped, or with junk there,
  // names no tab.
  function entryOf(state: unknown): HistoryEntry | undefined {
    if (!isHistoryEntry(state)) return undefined;
    const { tabId, ...entry } = state;
    return isTabId(tabId) ? { ...entry, tabId } : entry;
  }

  return {
    current: () => entryOf(win.history.state),
    entryOf,

    setOrgnr(orgnr, method, host, opts): void {
      const url = new URL(win.location.href);
      url.searchParams.set('orgnr', orgnr);
      url.searchParams.delete('nomatch');
      const state: HistoryEntry = { orgnr, method, host, tabId: opts.tabId };
      if (opts.push) {
        win.history.pushState(state, '', url.toString());
      } else {
        win.history.replaceState(state, '', url.toString());
      }
    },

    clearOrgnr(): void {
      const url = new URL(win.location.href);
      url.searchParams.delete('orgnr');
      win.history.replaceState(null, '', url.toString());
    },

    dropStamp(): void {
      const url = new URL(win.location.href);
      if (!url.searchParams.has('at')) return;
      url.searchParams.delete('at');
      win.history.replaceState(win.history.state, '', url.toString());
    },

    setTab(key): void {
      const url = new URL(win.location.href);
      url.searchParams.set('tab', key);
      win.history.replaceState(win.history.state, '', url.toString());
    },

    tabFromUrl: () => params().get('tab') ?? undefined,

    orgnrFromUrl(): string | undefined {
      const orgnr = params().get('orgnr');
      return orgnr && isValidOrgnr(orgnr) ? orgnr : undefined;
    },

    noMatchFromUrl: () => params().get('nomatch') ?? undefined,

    back: () => win.history.back(),
  };
}
