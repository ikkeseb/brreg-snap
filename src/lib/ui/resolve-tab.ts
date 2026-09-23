// Resolve-from-active-tab cascade shared by the popup and the sidebar.
// The tabs.query itself stays at the call sites: the popup captures
// windowId/tabId for the gesture-bound side-panel open, the sidebar
// wraps the query in its own error handling — only the band-aware
// cascade over the already-read tab fields is shared here.

import {
  getRejectedChoices,
  searchByHostnameDetailed,
  type Candidate,
} from '../hostname-search.js';
import { resolveOrgnr } from '../orgnr.js';
import type { ResolutionMethod } from '../resolution-method.js';

export {
  isHostDerived,
  RESOLUTION_METHODS,
  UNKNOWN_URL_METHOD,
  type ResolutionMethod,
} from '../resolution-method.js';

export interface TabContext {
  orgnr?: string;
  host?: string;
  pickerCandidates?: Candidate[];
  // How we landed on this orgnr (see ResolutionMethod).
  method?: ResolutionMethod;
  // True when the hostname search came back empty-handed because one
  // or more brreg queries FAILED — "we couldn't check", not "no
  // match". The empty state must not claim the host is unknown.
  degraded?: boolean;
}

function hostOf(url: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

// Band-aware cascade: sync regex first (URL/title), then a
// picker-aware hostname search that tells us whether to auto-resolve,
// show the picker, or fall through to the empty/manual-search state.
// An orgnr the user rejected for this site («Feil bedrift?») is not
// taken from the URL/title again: the hostname search decides instead.
// The title rides along to the hostname search as a word-boundary hint
// (hostname-search.ts § title segmentation).
export async function resolveTabContext(
  url: string,
  title: string,
): Promise<TabContext> {
  if (!url && !title) return {};
  const host = hostOf(url);
  const sync = resolveOrgnr({ url, title });
  if (sync && !(host && (await getRejectedChoices(host)).includes(sync.orgnr))) {
    return { orgnr: sync.orgnr, host, method: sync.method };
  }
  if (!host) return {};
  const detailed = await searchByHostnameDetailed(host, title || undefined);
  if (!detailed) return { host };
  if (detailed.band === 'auto') {
    // detailed.choice may have been written by an earlier picker pick
    // (positive picker-choice short-circuit) — distinguish via
    // candidates.
    const method: ResolutionMethod =
      detailed.candidates.length === 0 ? 'host-pick' : 'host-auto';
    return { orgnr: detailed.choice, host, method };
  }
  if (detailed.band === 'picker') {
    return { host, pickerCandidates: detailed.candidates };
  }
  return { host, degraded: !detailed.complete || undefined };
}
