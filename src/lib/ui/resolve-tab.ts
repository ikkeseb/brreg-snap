// Resolve-from-active-tab cascade shared by the popup and the sidebar.
// The tabs.query itself stays at the call sites: the popup captures
// windowId/tabId for the gesture-bound side-panel open, the sidebar
// wraps the query in its own error handling — only the band-aware
// cascade over the already-read tab fields is shared here.

import { searchByHostnameDetailed } from '../hostname-search.js';
import { resolveOrgnr } from '../orgnr.js';
import type { SearchHit } from '../../types/brreg.js';

// Why the current orgnr is on screen. Only host-resolved orgnrs are
// overridable via the "Feil bedrift?" button — URL-derived orgnrs
// (regex hit in path or title) are authoritative for their domain;
// manual picks are the user's own explicit choice. 'sync-broadcast'
// (sidebar only) hides the override because the popup's sync message
// doesn't carry the original resolution method. 'drill-in' (sidebar
// only) is an in-panel navigation into a related entity (parent /
// role-holder); it's not host-resolved, so the override stays hidden.
export type ResolutionMethod =
  | 'host-auto'
  | 'host-pick'
  | 'url'
  | 'manual'
  | 'sync-broadcast'
  | 'drill-in';

export interface TabContext {
  orgnr?: string;
  host?: string;
  pickerCandidates?: SearchHit[];
  // Why we landed on this orgnr — drives whether the "Feil bedrift?"
  // override is offered. Sync (URL/title regex) is authoritative;
  // host-auto is the only one the user can dispute via this code path.
  method?: ResolutionMethod;
  // True when the hostname search came back empty-handed because one
  // or more brreg queries FAILED — "we couldn't check", not "no
  // match". The empty state must not claim the host is unknown.
  degraded?: boolean;
}

// Band-aware cascade: sync regex first (URL/title), then a
// picker-aware hostname search that tells us whether to auto-resolve,
// show the picker, or fall through to the empty/manual-search state.
export async function resolveTabContext(
  url: string,
  title: string,
): Promise<TabContext> {
  if (!url && !title) return {};
  let host: string | undefined;
  if (url) {
    try {
      host = new URL(url).hostname;
    } catch {
      /* invalid url — leave host undefined */
    }
  }
  const sync = resolveOrgnr({ url, title });
  if (sync) return { orgnr: sync, host, method: 'url' };
  if (!host) return {};
  const detailed = await searchByHostnameDetailed(host);
  if (!detailed) return { host };
  if (detailed.band === 'auto') {
    // detailed.choice may have been written by an earlier picker pick
    // (positive picker-choice short-circuit) — both deserve the
    // override button, so distinguish via candidates.
    const method: ResolutionMethod =
      detailed.candidates.length === 0 ? 'host-pick' : 'host-auto';
    return { orgnr: detailed.choice, host, method };
  }
  if (detailed.band === 'picker') {
    return { host, pickerCandidates: detailed.candidates };
  }
  return { host, degraded: !detailed.complete || undefined };
}
