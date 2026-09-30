// The panel's painter: the 1.4 design («Dossier, stamped») behind the
// PanelPainter seam (view.ts). It composes the shared view components
// (src/lib/view/components/) into details.html's roots — one live
// region, the masthead's search field, the compact sticky head, the
// back bar, main#app[data-state] and the footer — and owns nothing the
// controller decides: what to load, when focus may move, the history.
//
// The result view is built from buildTrustView (trust-view.ts): the
// identity with flags + «Kopier sammendrag», the answer, the ledger, the
// konsern row, the undo actions, merknader + «Endret nylig», then the
// tablist (Oversikt · Personer · Økonomi · Enheter) whose panels the
// dossier components paint.
//
// The masthead field is the manual search from every state: typing
// swaps main for the search view (results, or «Nylig sett» while the
// field is empty) and keeps the previous DOM aside; Escape or the back
// bar puts it back untouched — no refetch, the open tab and a
// half-read page survive. Any paint from the controller discards it.

import { hostnameLabel } from '../lib/hostname-score.js';
import type { Candidate, RememberedChoice } from '../lib/hostname-search.js';
import { describeLoadFailure } from '../lib/ui/error-message.js';
import { attachManualSearch } from '../lib/ui/manual-search.js';
import type { RecentEntry } from '../lib/ui/recent.js';
import { COPY, reportHref } from '../lib/view/copy.js';
import { buildAnswer, buildErrorAnswer, type Answer } from '../lib/view/components/answer.js';
import { attachCopy, type CopyHandlers } from '../lib/view/components/copy-feedback.js';
import { button, el, glyph, icon, section } from '../lib/view/components/dom.js';
import { buildEnheter } from '../lib/view/components/enheter.js';
import { renderFooter } from '../lib/view/components/footer.js';
import { renderIdentity } from '../lib/view/components/identity.js';
import { buildKonsernRow } from '../lib/view/components/konsern.js';
import { buildFacts, buildLedger } from '../lib/view/components/ledger.js';
import { focusElement, type LiveRegion } from '../lib/view/components/live.js';
import { buildNotes } from '../lib/view/components/notes.js';
import { buildOkonomi } from '../lib/view/components/okonomi.js';
import { buildOversikt } from '../lib/view/components/oversikt.js';
import { buildPersoner } from '../lib/view/components/personer.js';
import { renderPicker } from '../lib/view/components/picker.js';
import {
  buildListSection,
  renderRecents,
  searchPainter,
  type ListSection,
} from '../lib/view/components/search.js';
import { buildSkeleton } from '../lib/view/components/skeleton.js';
import {
  buildTrustView,
  orgnrText,
  siteName,
  type TrustView,
  type ViewEnv,
} from '../lib/view/trust-view.js';
import type { ResolutionMethod } from '../lib/resolution-method.js';
import type { CompanyData } from '../lib/company-load.js';
import { setupTabs, type Tablist } from './tabs.js';
import type { PanelIntents, PanelPainter, ResultPaint } from './view.js';

export type PanelState = 'loading' | 'result' | 'picker' | 'empty' | 'error' | 'search';
type AnswerAttr = 'ok' | 'warn' | 'danger' | 'pick' | 'empty' | 'loading';

export const TAB_KEYS = ['oversikt', 'personer', 'okonomi', 'enheter'] as const;
export type TabKey = (typeof TAB_KEYS)[number];
const DEFAULT_TAB: TabKey = 'oversikt';
const FRESHNESS_TICK_MS = 30_000;

export interface PainterRoots {
  body: HTMLElement;
  // The masthead's search field: the manual search from every state.
  search: HTMLInputElement;
  // The compact head (inside its sticky wrapper).
  stick: HTMLElement;
  // The drill-in back bar («Tilbake til <name>»).
  back: HTMLButtonElement;
  main: HTMLElement;
  foot: HTMLElement;
  live: LiveRegion;
}

export interface PainterDeps {
  // writeClipboard in the product; a stub in tests.
  copy: (text: string) => Promise<boolean>;
  getRecent: () => Promise<RecentEntry[]>;
  getRememberedChoice: (host: string) => Promise<RememberedChoice | undefined>;
  // The picker persists the choice before it calls intents.pick / none.
  setPickerChoice: (host: string, orgnr: string | null) => Promise<void>;
  env: ViewEnv;
  now?: () => Date;
}

export interface PainterOptions {
  // The ?tab= to restore on load (history.tabFromUrl()).
  initialTab?: string;
  deps: PainterDeps;
}

interface Shown {
  company: CompanyData;
  method: ResolutionMethod | undefined;
  host: string | undefined;
  remembered?: RememberedChoice | undefined;
  view: TrustView;
  // The nodes above the tabs, so a provenance refresh can swap them
  // without touching the tabs, their panels or the scroll position.
  top: HTMLElement[];
  heading: HTMLElement;
  ident: HTMLElement;
}

interface SearchAside {
  // What was on screen, kept as live nodes.
  nodes: DocumentFragment;
  state: PanelState;
  answer: AnswerAttr;
  backHidden: boolean;
}

const isTabKey = (key: string | undefined): key is TabKey =>
  (TAB_KEYS as readonly string[]).includes(key ?? '');

export function createPanelPainter(
  roots: PainterRoots,
  intents: PanelIntents,
  opts: PainterOptions,
): PanelPainter {
  const { deps } = opts;
  const { main, body, foot, live } = roots;
  const now = deps.now ?? (() => new Date());
  const copyHandlers: CopyHandlers = { copy: deps.copy, announce: live.announce };

  let state: PanelState = 'loading';
  let answerAttr: AnswerAttr = 'loading';
  // Bumped by every paint: an async fill (recents, the stored choice)
  // that lands after a newer paint is dropped.
  let paintId = 0;
  let shown: Shown | undefined;
  let tabs: Tablist | undefined;
  // Survives across companies, like a static tablist would.
  let selectedTab: TabKey = isTabKey(opts.initialTab) ? opts.initialTab : DEFAULT_TAB;
  // A deep link to a tab (?tab=enheter from the popup's konsern row):
  // the first result scrolls the tabs into view so the section lands.
  let landOnTab = selectedTab !== DEFAULT_TAB;
  // The orgnr the last load was for (the error state's context).
  let lastOrgnr: string | undefined;
  let lastHost: string | undefined;
  // The company the user drilled in from, for «Tilbake til <name>».
  let drillFrom: string | undefined;
  let aside: SearchAside | undefined;
  // «Tilbake til <name>» when the drill-in's origin is known.
  let backName: string | undefined;
  let backHidden = true;

  // --- roots ------------------------------------------------------------

  function setState(next: PanelState, answer: AnswerAttr): void {
    state = next;
    answerAttr = answer;
    main.dataset.state = next;
    body.dataset.answer = answer;
    const loading = next === 'loading';
    main.toggleAttribute('inert', loading);
    main.setAttribute('aria-busy', String(loading));
    main.classList.remove('reveal');
  }

  function paintBack(): void {
    roots.back.replaceChildren(icon('i-back'));
    if (backName) {
      roots.back.append(COPY.back(''));
      roots.back.appendChild(el('b', undefined, backName));
    } else {
      roots.back.append(COPY.backPlain);
    }
  }
  roots.back.addEventListener('click', () => intents.back());

  // --- the compact head --------------------------------------------------

  const observer =
    typeof IntersectionObserver === 'undefined'
      ? undefined
      : new IntersectionObserver((entries) => {
          const entry = entries[entries.length - 1];
          if (!entry || state !== 'result') return;
          roots.stick.hidden = entry.isIntersecting || entry.boundingClientRect.top >= 0;
        });

  function paintStick(view: TrustView): void {
    const seal = el('span', 'answer__seal');
    seal.dataset.tone = view.answer.tone;
    seal.appendChild(glyph(view.answer.tone));
    roots.stick.replaceChildren(
      seal,
      el('b', 'stick__name', view.identity.name),
      el('span', 'stick__num tnum', view.identity.orgnr.spaced),
    );
  }

  function watchIdent(ident: HTMLElement | undefined): void {
    observer?.disconnect();
    roots.stick.hidden = true;
    if (ident && observer) observer.observe(ident);
  }

  // --- the search view (the masthead field) -----------------------------

  const results: ListSection = buildListSection(COPY.results);
  results.list.className = 'results';
  const recents: ListSection = buildListSection(COPY.recents);
  const searchView = el('div', 'search-view');
  const searchBack = button('back');
  searchBack.addEventListener('click', () => closeSearch(true));
  searchView.append(searchBack, results.section, recents.section);

  const search = attachManualSearch({
    inputEl: roots.search,
    resultsEl: results.list,
    paint: searchPainter,
    announce: live.announce,
    onSelect: (hit) => intents.manual(hit.organisasjonsnummer),
    onQueryActive: () => {
      openSearch();
      results.section.hidden = false;
      recents.section.hidden = true;
    },
    onQueryCleared: () => {
      if (!aside) return;
      results.section.hidden = true;
      recents.section.hidden = recents.list.childElementCount === 0;
    },
  });

  function searchBackLabel(): string {
    const name = shown?.view.identity.name ?? (lastHost ? siteName(lastHost) : undefined);
    return name ? COPY.back(name) : COPY.backPlain;
  }

  function openSearch(): void {
    if (aside) return;
    const nodes = document.createDocumentFragment();
    nodes.append(...main.childNodes);
    aside = { nodes, state, answer: answerAttr, backHidden: roots.back.hasAttribute('hidden') };
    roots.back.hidden = true;
    roots.stick.hidden = true;
    searchBack.replaceChildren(icon('i-back'), el('b', undefined, searchBackLabel()));
    results.section.hidden = true;
    recents.section.hidden = true;
    main.classList.remove('reveal');
    main.replaceChildren(searchView);
    main.dataset.state = 'search';
    body.dataset.answer = 'empty';
    const id = paintId;
    void deps.getRecent().then((entries) => {
      if (!aside || id !== paintId) return;
      renderRecents(recents, entries, (entry) => intents.recent(entry.orgnr));
      if (roots.search.value.trim().length < 2) recents.section.hidden = entries.length === 0;
      else recents.section.hidden = true;
    });
  }

  // `restore`: put the previous view back (Escape, the back bar). False
  // when a paint replaces it anyway.
  function closeSearch(restore: boolean): void {
    if (!aside) return;
    const kept = aside;
    aside = undefined;
    search.reset();
    if (!restore) return;
    main.replaceChildren(kept.nodes);
    main.dataset.state = kept.state;
    body.dataset.answer = kept.answer;
    roots.back.hidden = kept.backHidden;
    state = kept.state;
    answerAttr = kept.answer;
    watchIdent(shown && state === 'result' ? shown.ident : undefined);
    roots.search.focus();
  }

  roots.search.ownerDocument.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !aside) return;
    ev.preventDefault();
    closeSearch(true);
  });

  // --- pieces --------------------------------------------------------------

  const report = (orgnr?: string, host?: string, method?: ResolutionMethod): string =>
    reportHref({ host, orgnr, method, ...deps.env });

  // Everything above the tabs, in order. The heading is the focus
  // target after a drill-in.
  function buildTop(view: TrustView): { nodes: HTMLElement[]; heading: HTMLElement; ident: HTMLElement } {
    const nodes: HTMLElement[] = [];

    const ident = el('div');
    const { heading } = renderIdentity(ident, view.identity, copyHandlers);
    const row = el('div', 'ident__row');
    if (view.identity.flags) row.appendChild(el('p', 'ident__flags', view.identity.flags));
    const summary = button('text-btn');
    summary.appendChild(icon('i-summary', 'icon--copy'));
    summary.appendChild(icon('i-check', 'icon--done'));
    const label = el('span', undefined, COPY.copySummary);
    summary.appendChild(label);
    attachCopy(summary, () => view.summary, { done: COPY.summaryCopied, label }, copyHandlers);
    row.appendChild(summary);
    ident.appendChild(row);
    nodes.push(ident);

    nodes.push(buildAnswer(view.answer, { onReject: () => void reject() }).section);

    const ledgerHandlers = {
      onReject: () => void reject(),
      onForget: () => void intents.forget(),
      reportHref: view.reportHref,
    };
    nodes.push(buildLedger(view.ledger, ledgerHandlers));
    if (view.facts) nodes.push(...buildFacts(view.facts));

    if (view.konsern) {
      nodes.push(buildKonsernRow(view.konsern, { onOpen: () => openTab('enheter') }));
    }

    const undo = el('p', 'undo');
    const forgetInLedger = view.ledger.some((r) => r.actions.some((a) => a.kind === 'forget'));
    if (view.forgetSite && !forgetInLedger) {
      const forget = button('text-btn', COPY.forgetSite(view.forgetSite));
      forget.addEventListener('click', () => void intents.forget());
      undo.appendChild(forget);
    }
    if (undo.childElementCount > 0) nodes.push(undo);

    const notes = buildNotes(view.merknader, view.endringer);
    if (notes) nodes.push(notes);

    return { nodes, heading, ident };
  }

  // «Feil bedrift?» runs a storage write and a host search before it
  // paints; the buttons are disabled meanwhile so a second click can't
  // start it twice.
  let rejecting = false;
  async function reject(): Promise<void> {
    if (rejecting) return;
    rejecting = true;
    try {
      await intents.reject();
    } finally {
      rejecting = false;
    }
  }

  function drill(orgnr: string): void {
    drillFrom = shown?.view.identity.name;
    intents.drill(orgnr);
  }

  function buildTabs(view: TrustView): { tablist: HTMLElement; panels: HTMLElement[] } {
    const d = view.dossier;
    const counts: Partial<Record<TabKey, number>> = {};
    if (d?.personCount !== undefined) counts.personer = d.personCount;
    if (d?.unitCount !== undefined) counts.enheter = d.unitCount;

    const tablist = el('div', 'tabs');
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', COPY.tabsLabel);
    const panels: HTMLElement[] = [];
    for (const key of TAB_KEYS) {
      const tab = button('tab', COPY.tabs[key]);
      tab.id = `tab-${key}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', `panel-${key}`);
      tab.setAttribute('aria-selected', 'false');
      tab.tabIndex = -1;
      const count = counts[key];
      if (count !== undefined && count > 0) {
        tab.append(' ');
        tab.appendChild(el('span', 'tab__count', count.toLocaleString('nb-NO')));
      }
      tablist.appendChild(tab);

      const panel = el('div');
      panel.id = `panel-${key}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      panel.hidden = true;
      if (d) {
        const handlers = { onDrill: drill, ...copyHandlers };
        switch (key) {
          case 'oversikt':
            panel.append(...buildOversikt(d, handlers));
            break;
          case 'personer':
            panel.append(...buildPersoner(d.personer, handlers));
            break;
          case 'okonomi':
            panel.append(...buildOkonomi(d.okonomi));
            break;
          case 'enheter':
            panel.append(...buildEnheter(d.enheter, view.identity.name, handlers));
            break;
        }
      }
      panels.push(panel);
    }
    return { tablist, panels };
  }

  function openTab(key: TabKey): void {
    selectedTab = key;
    tabs?.activateByKey(key);
    intents.selectTab(key);
    scrollToTabs();
  }

  // Land on the tabs: they sit right under the compact head, which
  // shows once the identity is scrolled past (so it is measured shown).
  // Measured once the bundled font is in (its swap reflows the lines
  // above the tabs) and from layout offsets, not the bounding box the
  // reveal animation is still translating.
  function scrollToTabs(): void {
    const doc = main.ownerDocument;
    const go = (): void => {
      const tablist = main.querySelector<HTMLElement>('[role="tablist"]');
      const win = doc.defaultView;
      if (!tablist || !win) return;
      roots.stick.hidden = false;
      win.scrollTo({ top: tablist.offsetTop - roots.stick.offsetHeight });
    };
    const fonts = (doc as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    if (fonts) void fonts.ready.then(go);
    else go();
  }

  function paintFooter(): void {
    if (!shown) return;
    renderFooter(
      foot,
      { fetchedAt: shown.view.fetchedAt, now: now().getTime(), reportHref: shown.view.reportHref },
      { onRefresh: () => intents.refresh() },
    );
  }

  // «Hentet for 2 min siden» moves on while the panel sits open.
  setInterval(() => {
    if (state === 'result' && !aside) paintFooter();
  }, FRESHNESS_TICK_MS);

  function paintResult(view: TrustView, paint: Pick<ResultPaint, 'company' | 'method' | 'host' | 'remembered'>, reveal: boolean): void {
    setState('result', view.answer.tone);
    const top = buildTop(view);
    const { tablist, panels } = buildTabs(view);
    main.replaceChildren(...top.nodes, tablist, ...panels);
    tabs = setupTabs(tablist, {
      initial: selectedTab,
      onSelect: (key) => {
        if (isTabKey(key)) selectedTab = key;
        intents.selectTab(key);
      },
    });
    if (reveal) main.classList.add('reveal');
    shown = { ...paint, view, top: top.nodes, heading: top.heading, ident: top.ident };
    paintStick(view);
    watchIdent(top.ident);
    paintFooter();
  }

  function fillRecents(target: ListSection): void {
    const id = paintId;
    void deps.getRecent().then((entries) => {
      if (id !== paintId) return;
      renderRecents(target, entries, (entry) => intents.recent(entry.orgnr));
    });
  }

  // --- the painter -----------------------------------------------------------

  return {
    loading(orgnr): void {
      paintId += 1;
      closeSearch(false);
      lastOrgnr = orgnr;
      shown = undefined;
      watchIdent(undefined);
      setState('loading', 'loading');
      main.replaceChildren(buildPanelSkeleton());
      renderFooter(foot, { loading: true });
      live.announce(COPY.loadingOrgnr(orgnrText(orgnr).spaced));
    },

    result(paint): void {
      paintId += 1;
      closeSearch(false);
      lastHost = paint.host;
      const view = buildTrustView({
        company: paint.company,
        method: paint.method,
        host: paint.host,
        now: now(),
        surface: 'panel',
        ...(paint.remembered ? { remembered: paint.remembered } : {}),
        env: deps.env,
      });
      backName = paint.method === 'drill-in' ? drillFrom : undefined;
      drillFrom = undefined;
      paintBack();
      paintResult(view, paint, true);
      if (landOnTab) {
        landOnTab = false;
        scrollToTabs();
      }
      if (paint.focus === 'heading') focusElement(shown?.heading);
      else if (paint.focus === 'refresh') focusElement(foot.querySelector('button'));
    },

    // A same-company sync or tab event: how the company was reached
    // changed (host, method, the stored choice), the company did not.
    // Only what depends on that is rebuilt: everything above the tabs
    // and the footer. The open tab, its scroll position and a search in
    // progress stay.
    provenance({ method, host, remembered }): void {
      if (!shown) return;
      lastHost = host;
      const view = buildTrustView({
        company: shown.company,
        method,
        host,
        now: now(),
        surface: 'panel',
        ...(remembered ? { remembered } : {}),
        env: deps.env,
      });
      const top = buildTop(view);
      const first = shown.top[0];
      if (!first) return;
      const parent = first.parentNode;
      if (!parent) return;
      for (const node of top.nodes) parent.insertBefore(node, first);
      for (const old of shown.top) old.remove();
      shown = { ...shown, method, host, remembered, view, top: top.nodes, heading: top.heading, ident: top.ident };
      const answer = view.answer.tone;
      answerAttr = answer;
      if (aside) aside.answer = answer;
      else body.dataset.answer = answer;
      paintStick(view);
      if (!aside) watchIdent(top.ident);
      paintFooter();
    },

    picker(host, candidates, { focus }): void {
      paintId += 1;
      closeSearch(false);
      shown = undefined;
      lastHost = host;
      watchIdent(undefined);
      setState('picker', 'pick');
      const painted = paintPicker(host, candidates);
      renderFooter(foot, { reportHref: report(undefined, host) });
      if (focus) focusElement(painted.firstRow);
    },

    empty({ host, degraded, query, focus }): void {
      paintId += 1;
      const id = paintId;
      closeSearch(false);
      shown = undefined;
      lastHost = host;
      watchIdent(undefined);
      setState('empty', degraded ? 'warn' : 'empty');
      const site = host ? siteName(host) : undefined;

      const empty = el('div', 'empty');
      const heading = el('h1', undefined, site ? (degraded ? COPY.emptyDegraded(site) : COPY.emptyNoMatch(site)) : COPY.emptyNoSite);
      const text = el('p', undefined, site ? COPY.emptyNoMatchText : COPY.emptyPanelText);
      empty.append(heading, text);
      main.replaceChildren(empty);
      if (degraded && site) {
        main.appendChild(
          buildErrorAnswer(
            { head: COPY.noAnswerHead, support: COPY.degradedSupport(site), retry: true },
            { onRetry: () => intents.retry() },
          ).section,
        );
      }
      const list = buildListSection(COPY.recents);
      list.section.hidden = true;
      main.appendChild(list.section);
      fillRecents(list);
      renderFooter(foot, host ? { reportHref: report(undefined, host) } : {});

      // «Ingen av disse» / a stored choice for the site: say so, and
      // offer to forget it.
      if (host && site) {
        void deps.getRememberedChoice(host).then((remembered) => {
          if (id !== paintId || !remembered) return;
          if (remembered.kind === 'none' && !degraded) {
            heading.textContent = COPY.emptyNone(site);
            text.textContent = COPY.emptyNoneText;
          }
          const undo = el('p', 'empty__undo');
          const forget = button('text-btn', COPY.forgetSite(site));
          forget.addEventListener('click', () => void intents.forget());
          undo.appendChild(forget);
          text.after(undo);
        });
      }

      if (query !== undefined) search.search(query);
      if (focus) roots.search.focus();
    },

    error(err, { retry, focus }): void {
      paintId += 1;
      closeSearch(false);
      shown = undefined;
      watchIdent(undefined);
      setState('error', 'warn');
      const failure = describeLoadFailure(err);
      failure.retry = failure.retry && retry;
      main.replaceChildren();
      if (lastOrgnr) {
        const context = el('p', 'context', COPY.contextOrgnr);
        context.appendChild(el('b', undefined, orgnrText(lastOrgnr).spaced));
        main.appendChild(context);
      }
      const answer: Answer = buildErrorAnswer(failure, { onRetry: () => intents.retry() });
      main.appendChild(answer.section);
      const list = buildListSection(COPY.recents);
      list.section.hidden = true;
      main.appendChild(list.section);
      fillRecents(list);
      renderFooter(foot, lastOrgnr ? { reportHref: report(lastOrgnr, lastHost) } : {});
      if (focus) focusElement(answer.heading);
    },

    setBack(visible): void {
      backHidden = !visible;
      if (aside) aside.backHidden = backHidden;
      else roots.back.hidden = backHidden;
    },

    selectTab(key): void {
      if (!isTabKey(key)) return;
      selectedTab = key;
      tabs?.activateByKey(key);
    },
  };

  function paintPicker(host: string, candidates: Candidate[]) {
    return renderPicker(
      main,
      { site: siteName(host), candidates, query: hostnameLabel(host) ?? siteName(host) },
      {
        onPick: (orgnr) => void deps.setPickerChoice(host, orgnr).then(() => intents.pick(host, orgnr)),
        onNone: () => void deps.setPickerChoice(host, null).then(() => intents.none(host)),
        onSearchSelect: (orgnr) => intents.manual(orgnr),
        announce: live.announce,
      },
    );
  }
}

// The loading skeleton (S5): the shared identity + answer + ledger
// geometry, then the konsern row, the tabs and the first section, so
// the layout that lands is the layout that shimmered. Static text only:
// the tabs are not a tablist (main is inert meanwhile).
export function buildPanelSkeleton(): DocumentFragment {
  const frag = buildSkeleton('panel');
  const konsern = el('div', 'konsern');
  konsern.appendChild(el('span', 'sk sk--icon'));
  const text = el('span', 'konsern__text');
  text.appendChild(el('span', 'sk sk--m'));
  konsern.appendChild(text);
  frag.appendChild(konsern);

  const tabs = el('div', 'tabs');
  tabs.setAttribute('aria-hidden', 'true');
  for (const key of TAB_KEYS) {
    const tab = el('span', 'tab', COPY.tabs[key]);
    if (key === 'oversikt') tab.setAttribute('aria-selected', 'true');
    tabs.appendChild(tab);
  }
  frag.appendChild(tabs);

  const sec = section(COPY.registrering);
  sec.setAttribute('aria-hidden', 'true');
  const dl = el('dl');
  for (const [label, width] of [
    ['Organisasjonsform', 'sk--m'],
    ['Stiftet', 'sk--s'],
    ['Registrert', 'sk--s'],
    ['Næring', 'sk--l'],
  ] as const) {
    const row = el('div', 'def-row');
    row.appendChild(el('dt', undefined, label));
    const dd = el('dd');
    dd.appendChild(el('span', `sk ${width}`));
    row.appendChild(dd);
    dl.appendChild(row);
  }
  sec.appendChild(dl);
  frag.appendChild(sec);
  return frag;
}
