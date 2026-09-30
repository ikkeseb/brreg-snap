// The popup's paint functions: each composes the shared components
// (src/lib/view/components/) into the masthead, main and footer roots
// for one state, and returns what the controller needs for focus. No
// state lives here; popup.ts decides which paint to run and when focus
// may move.

import type { Candidate } from '../lib/hostname-search.js';
import type { RecentEntry } from '../lib/ui/recent.js';
import { COPY } from '../lib/view/copy.js';
import type { TrustView } from '../lib/view/trust-view.js';
import { buildActions, type ActionsHandlers } from '../lib/view/components/actions.js';
import {
  buildAnswer,
  buildErrorAnswer,
  type Answer,
  type ErrorAnswer,
} from '../lib/view/components/answer.js';
import type { CopyHandlers } from '../lib/view/components/copy-feedback.js';
import { button, el } from '../lib/view/components/dom.js';
import { renderFooter } from '../lib/view/components/footer.js';
import { renderIdentity } from '../lib/view/components/identity.js';
import { buildKonsernRow } from '../lib/view/components/konsern.js';
import { buildFacts, buildLedger } from '../lib/view/components/ledger.js';
import type { LiveRegion } from '../lib/view/components/live.js';
import { renderMasthead, type Masthead } from '../lib/view/components/masthead.js';
import { renderPicker, type Picker } from '../lib/view/components/picker.js';
import {
  buildListSection,
  renderRecents,
  renderSearchView,
  type SearchView,
} from '../lib/view/components/search.js';
import { renderSkeleton } from '../lib/view/components/skeleton.js';

export interface Roots {
  body: HTMLElement;
  mast: HTMLElement;
  main: HTMLElement;
  foot: HTMLElement;
  live: LiveRegion;
}

export type PopupState = 'loading' | 'result' | 'picker' | 'empty' | 'error';
export type AnswerAttr = 'ok' | 'warn' | 'danger' | 'pick' | 'empty' | 'loading';

export function setState(roots: Roots, state: PopupState, answer: AnswerAttr): void {
  roots.main.dataset.state = state;
  roots.body.dataset.answer = answer;
  const loading = state === 'loading';
  roots.main.toggleAttribute('inert', loading);
  roots.main.setAttribute('aria-busy', String(loading));
  roots.main.classList.remove('reveal');
}

export interface MastHandlers {
  onSearch: () => void;
}

function mast(roots: Roots, host: string | undefined, search: boolean, handlers: MastHandlers): Masthead {
  return renderMasthead(roots.mast, { kind: 'popup', host, search }, { onSearch: handlers.onSearch });
}

// --- loading ------------------------------------------------------------

export function paintLoading(roots: Roots, host: string | undefined, handlers: MastHandlers): void {
  mast(roots, host, true, handlers);
  setState(roots, 'loading', 'loading');
  renderSkeleton(roots.main, 'popup');
  renderFooter(roots.foot, { loading: true });
}

// --- result ---------------------------------------------------------------

export interface ResultHandlers extends CopyHandlers, MastHandlers {
  onReject: () => void;
  onForget: () => void;
  onBackToSite: () => void;
  onRefresh: () => void;
  onOpenPanel: ActionsHandlers['onOpenPanel'];
  onOpenKonsern: () => void;
  panelHref?: string;
  // The host the masthead shows.
  host?: string;
  now: number;
  // Play the answer-first reveal (data just replaced the skeleton).
  reveal: boolean;
}

export interface ResultPaint {
  heading: HTMLHeadingElement;
  answer: Answer;
}

export function paintResult(roots: Roots, view: TrustView, handlers: ResultHandlers): ResultPaint {
  mast(roots, handlers.host, true, handlers);
  setState(roots, 'result', view.answer.tone);
  const main = roots.main;
  main.replaceChildren();

  const ident = el('div');
  const { heading } = renderIdentity(ident, view.identity, handlers);
  main.appendChild(ident);

  const answer = buildAnswer(view.answer, { onReject: handlers.onReject });
  main.appendChild(answer.section);

  const ledgerHandlers = {
    onReject: handlers.onReject,
    onForget: handlers.onForget,
    reportHref: view.reportHref,
  };
  if (view.facts) {
    // Spoof: only the kobling row, then the company's facts as prose.
    main.appendChild(buildLedger(view.ledger, ledgerHandlers));
    for (const node of buildFacts(view.facts)) main.appendChild(node);
  } else {
    main.appendChild(buildLedger(view.ledger, ledgerHandlers));
  }

  if (view.konsern) {
    main.appendChild(buildKonsernRow(view.konsern, { onOpen: handlers.onOpenKonsern }));
  }

  // Undo actions the ledger has no row for: the way back after a
  // manual pick, and «Glem valget» when no kobling row carried it.
  const undo = el('p', 'undo');
  if (view.backToSite) {
    const back = button('text-btn', COPY.backToSite(view.backToSite));
    back.addEventListener('click', () => handlers.onBackToSite());
    undo.appendChild(back);
  }
  const forgetInLedger = view.ledger.some((r) => r.actions.some((a) => a.kind === 'forget'));
  if (view.forgetSite && !forgetInLedger) {
    const forget = button('text-btn', COPY.forgetSite(view.forgetSite));
    forget.addEventListener('click', () => handlers.onForget());
    undo.appendChild(forget);
  }
  if (undo.childElementCount > 0) main.appendChild(undo);

  const actions = buildActions(
    { summary: view.summary, ...(handlers.panelHref ? { panelHref: handlers.panelHref } : {}) },
    handlers,
  );
  main.appendChild(actions.container);

  if (handlers.reveal) main.classList.add('reveal');

  renderFooter(
    roots.foot,
    { fetchedAt: view.fetchedAt, now: handlers.now, reportHref: view.reportHref },
    { onRefresh: handlers.onRefresh },
  );
  return { heading, answer };
}

// --- picker ----------------------------------------------------------------

export interface PickerPaint {
  host: string;
  site: string;
  query: string;
  candidates: readonly Candidate[];
  reportHref: string;
}

export interface PickerHandlers extends MastHandlers {
  onPick: (orgnr: string) => void;
  onNone: () => void;
  onSearchSelect: (orgnr: string) => void;
}

export function paintPicker(roots: Roots, data: PickerPaint, handlers: PickerHandlers): Picker {
  mast(roots, data.host, true, handlers);
  setState(roots, 'picker', 'pick');
  const picker = renderPicker(
    roots.main,
    { site: data.site, candidates: data.candidates, query: data.query },
    {
      onPick: handlers.onPick,
      onNone: handlers.onNone,
      onSearchSelect: handlers.onSearchSelect,
      announce: roots.live.announce,
    },
  );
  renderFooter(roots.foot, { reportHref: data.reportHref });
  return picker;
}

// --- empty / search --------------------------------------------------------

export type EmptyKind =
  // The tab has no address to look up.
  | { kind: 'no-site' }
  // brreg knows no company behind the site.
  | { kind: 'no-match'; host: string }
  // The user said «Ingen av disse» for the site.
  | { kind: 'none'; host: string }
  // The hostname search failed: «we couldn't check», not «no match».
  | { kind: 'degraded'; host: string }
  // Opened from the masthead over another state.
  | { kind: 'search'; host?: string; back: string };

export interface EmptyPaint {
  kind: EmptyKind;
  site?: string;
  recents: readonly RecentEntry[];
  forgetSite?: string;
  reportHref?: string;
}

export interface EmptyHandlers extends MastHandlers {
  onSelect: (orgnr: string) => void;
  onForget: () => void;
  onRetry: () => void;
  onBack: () => void;
}

export function paintEmpty(roots: Roots, data: EmptyPaint, handlers: EmptyHandlers): SearchView {
  const { kind } = data;
  const host = 'host' in kind ? kind.host : undefined;
  // The search field is on screen in every empty kind: no icon.
  mast(roots, host, false, handlers);
  setState(roots, 'empty', kind.kind === 'degraded' ? 'warn' : 'empty');
  const site = data.site ?? '';
  let head: string;
  let text: string | undefined;
  switch (kind.kind) {
    case 'no-site':
      head = COPY.emptyNoSite;
      text = COPY.emptyNoSiteText;
      break;
    case 'no-match':
      head = COPY.emptyNoMatch(site);
      text = COPY.emptyNoMatchText;
      break;
    case 'degraded':
      head = COPY.emptyDegraded(site);
      text = COPY.emptyNoMatchText;
      break;
    case 'none':
      head = COPY.emptyNone(site);
      text = COPY.emptyNoneText;
      break;
    default:
      head = COPY.searchHead;
      text = COPY.searchText;
      break;
  }
  const after: Node[] = [];
  if (kind.kind === 'degraded') {
    const error: ErrorAnswer = {
      head: COPY.noAnswerHead,
      support: COPY.degradedSupport(site),
      retry: true,
    };
    after.push(buildErrorAnswer(error, { onRetry: handlers.onRetry }).section);
  }
  const view = renderSearchView(
    roots.main,
    {
      head,
      text,
      hint: true,
      recents: data.recents,
      after,
      ...(data.forgetSite ? { forgetSite: data.forgetSite } : {}),
      ...(kind.kind === 'search' ? { back: kind.back } : {}),
    },
    {
      onSelect: handlers.onSelect,
      announce: roots.live.announce,
      onForget: handlers.onForget,
      onBack: handlers.onBack,
    },
  );
  renderFooter(roots.foot, data.reportHref ? { reportHref: data.reportHref } : {});
  return view;
}

// --- error ------------------------------------------------------------------

export interface ErrorPaint {
  host?: string;
  // «Oppslag for <site>» / «Oppslag på org.nr …».
  context?: { label: string; strong: string };
  error: ErrorAnswer;
  recents: readonly RecentEntry[];
  reportHref?: string;
}

export interface ErrorHandlers extends MastHandlers {
  onRetry: () => void;
  onSelect: (orgnr: string) => void;
}

export function paintError(roots: Roots, data: ErrorPaint, handlers: ErrorHandlers): Answer {
  mast(roots, data.host, true, handlers);
  setState(roots, 'error', 'warn');
  const main = roots.main;
  main.replaceChildren();
  if (data.context) {
    const context = el('p', 'context');
    context.append(data.context.label);
    context.appendChild(el('b', undefined, data.context.strong));
    main.appendChild(context);
  }
  const answer = buildErrorAnswer(data.error, { onRetry: handlers.onRetry });
  main.appendChild(answer.section);
  const recents = buildListSection(COPY.recents);
  renderRecents(recents, data.recents, (entry) => handlers.onSelect(entry.orgnr));
  main.appendChild(recents.section);
  renderFooter(roots.foot, data.reportHref ? { reportHref: data.reportHref } : {});
  return answer;
}
