// The seam between the panel's controller (controller.ts) and whatever
// paints it. The controller decides WHAT is on screen and passes raw
// data; a painter decides HOW it looks. Nothing here names a DOM type,
// so the controller is tested with a fake painter and a redesigned
// painter plugs in without touching the state machine.
//
// The painter is painter.ts: it builds the trust view from these inputs
// (buildTrustView takes company / method / host / remembered) and
// paints it with the shared components.

import type { CompanyData } from '../lib/company-load.js';
import type { Candidate, RememberedChoice } from '../lib/hostname-search.js';
import type { ResolutionMethod } from '../lib/resolution-method.js';

// Where keyboard focus goes after a result paints. The controller
// already applied the "only when the panel window has focus" rule
// (document.hasFocus()): a painter focuses exactly what it is told.
//   heading — an in-panel drill-in or a Back/Forward restore: the
//             element the user activated was torn down, so focus moves
//             to the company heading and screen readers announce it.
//   refresh — «Oppdater»: the button was hidden with the footer while
//             loading, so focus fell to <body>; hand it back.
//   none    — every other load (startup, sync, picker pick, manual
//             search, a background tab event).
export type ResultFocus = 'heading' | 'refresh' | 'none';

export interface ResultPaint {
  company: CompanyData;
  // How the orgnr was reached; drives «Feil bedrift?» (isHostDerived).
  method: ResolutionMethod | undefined;
  // The site the company was resolved from («Synket fra <host>»).
  // Undefined after a drill-in, a manual pick or a recents pick.
  host: string | undefined;
  // What the user has stored for `host` (picker choice, «Ingen av
  // disse», rejections), for «Glem valget». Only fetched with a host.
  remembered?: RememberedChoice;
  // When the data was fetched from brreg — a cache hit can be a day
  // old — never when it was painted.
  fetchedAt: number;
  // True once this result is no longer the one on screen. A painter
  // that fetches after painting must check it before writing. It stays
  // false across a same-company sync that keeps the view, unlike the
  // load token.
  isStale: () => boolean;
  focus: ResultFocus;
  // The tab the panel follows (the one it resolved at startup or on a
  // tab event): its toolbar badge is set from this result — the answer's
  // tone when the company is the tab's own (host-derived, warn or
  // danger), cleared otherwise. Undefined = no tab known; the badge is
  // left alone.
  tabId?: number;
}

// Refresh of how the company on screen was reached, without a repaint:
// a sync or tab event for the company already shown (same-view keep).
// Scroll, focus, the open tab and the «Data hentet» stamp stay put.
export interface ProvenancePaint {
  method: ResolutionMethod;
  host: string | undefined;
  remembered?: RememberedChoice;
  tabId?: number;
}

export interface EmptyPaint {
  host?: string;
  // The hostname search itself failed (offline, brreg down): "we
  // couldn't check" must not read as a confirmed "no match".
  degraded: boolean;
  // Prefill the manual search with this and run it (selection lookup).
  query?: string;
  // Move focus into the search box. False for a background repaint.
  focus: boolean;
  // The followed tab: its badge is cleared (no company on screen).
  tabId?: number;
}

export interface ErrorPaint {
  // Offer «Prøv igjen»: false when asking again can't change the
  // answer (a not-found) or there is no load to re-trigger.
  retry: boolean;
  focus: boolean;
  tabId?: number;
}

export interface PanelPainter {
  // The skeleton, with `orgnr` in the live status («Henter …»).
  loading(orgnr: string): void;
  result(paint: ResultPaint): void;
  provenance(paint: ProvenancePaint): void;
  // The candidates for `host`. The painter's picker persists the
  // choice (setPickerChoice) before it calls intents.pick / none.
  picker(host: string, candidates: Candidate[], opts: { focus: boolean; tabId?: number }): void;
  empty(paint: EmptyPaint): void;
  error(err: unknown, paint: ErrorPaint): void;
  // «Tilbake»: only a drilled-in entity has an in-panel back to offer.
  setBack(visible: boolean): void;
  // Reflect a restored ?tab= (Back/Forward) without persisting it.
  selectTab(key: string): void;
}

// What the painter can ask of the controller. Every intent is
// user-initiated: it may move focus, and it wins over any load still
// in flight.
export interface PanelIntents {
  // In-panel drill-in into a related entity (parent, a role-holder).
  drill: (orgnr: string) => void;
  // «Tilbake» after a drill-in.
  back: () => void;
  // «Feil bedrift?»: record the rejection, re-run the host search,
  // re-open the picker. Resolves when the flow has settled; the
  // painter may disable the button meanwhile.
  reject: () => Promise<void>;
  // «Glem valget for <site>»: drop everything stored for the host and
  // resolve it afresh.
  forget: () => Promise<void>;
  // «Prøv igjen» in the error state.
  retry: () => void;
  // «Oppdater»: refetch the company on screen past the cache.
  refresh: () => void;
  // A picker row, after the choice was persisted for `host`.
  pick: (host: string, orgnr: string) => void;
  // «Ingen av disse», after the negative choice was persisted.
  none: (host: string) => void;
  // A manual-search hit.
  manual: (orgnr: string) => void;
  // A recents-list entry.
  recent: (orgnr: string) => void;
  // Search for text in the empty state (the selection lookup).
  search: (query: string) => void;
  // The user selected a tab; persists ?tab= into the history entry.
  selectTab: (key: string) => void;
}
