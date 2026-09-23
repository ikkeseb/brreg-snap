// Provenance of the orgnr on screen, shared by every module that
// carries it (resolve-tab, the panel protocol and follower, the
// surfaces, trust/kobling.ts). Kept dependency-free so the background
// script can validate messages without pulling in the resolver.

import type { SyncTier } from './orgnr.js';

// How the orgnr on screen was found — its provenance. Drives the
// «Kobling» signal (trust/kobling.ts) and whether «Feil bedrift?» is
// offered (isHostDerived below).
//   url-param / url-path / title — the site's own URL or title named
//       the orgnr (orgnr.ts § SyncTier). The site controls both, so
//       this is a claim, not a verification.
//   host-auto — the hostname search matched confidently.
//   host-pick — the user picked it for this host in the picker.
//   manual    — the user's own search or a recents entry.
//   drill-in  — in-panel navigation to a related entity (parent,
//       role-holder); sidebar only.
// A sync message carries the sender's method, so the panel needs no
// method of its own for it.
export type ResolutionMethod =
  | SyncTier
  | 'host-auto'
  | 'host-pick'
  | 'manual'
  | 'drill-in';

// Every method the panel protocol and history entries accept.
export const RESOLUTION_METHODS: readonly ResolutionMethod[] = [
  'url-param',
  'url-path',
  'title',
  'host-auto',
  'host-pick',
  'manual',
  'drill-in',
];

// The method for an orgnr that arrived without one: a panel-URL hint or
// a history entry from before methods were stamped. Such a view never
// carries a host, so neither «Feil bedrift?» nor «Kobling» (both need
// the site) reads it; 'url-path' just names where it came from — a URL.
export const UNKNOWN_URL_METHOD: ResolutionMethod = 'url-path';

// Derived from the visited site (its URL, title or hostname) rather
// than chosen by the user elsewhere. Exactly these results offer «Feil
// bedrift?» — a URL/title orgnr included, since the site controls it.
export function isHostDerived(
  method: ResolutionMethod | undefined,
): method is SyncTier | 'host-auto' | 'host-pick' {
  return (
    method === 'url-param' ||
    method === 'url-path' ||
    method === 'title' ||
    method === 'host-auto' ||
    method === 'host-pick'
  );
}

