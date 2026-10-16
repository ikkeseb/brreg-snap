// The panel's painter: the UI system (docs/notes/ui.md) behind the
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
// half-read page survive (the footer's freshness row steps aside with
// it). Any paint from the controller discards it.

import type { Candidate, RememberedChoice } from '../lib/hostname-search.js';
import { describeLoadFailure } from '../lib/ui/error-message.js';
import { attachManualSearch } from '../lib/ui/manual-search.js';
import type { RecentEntry } from '../lib/ui/recent.js';
import { COPY, reportHref } from '../lib/view/copy.js';
import { buildAnswer, buildErrorAnswer, type Answer } from '../lib/view/components/answer.js';
import { attachCopy, type CopyHandlers } from '../lib/view/components/copy-feedback.js';
import { button, el, glyph, icon, section } from '../lib/view/components/dom.js';
import { buildEnheter } from '../lib/view/components/enheter.js';
import { renderFooter, type FooterHandle } from '../lib/view/components/footer.js';
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
  type AnswerTone,
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
  // setTrustBadge in the product: the followed tab's toolbar badge.
  setBadge: (tabId: number, tone: AnswerTone | undefined) => Promise<void>;
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
  // A tab-region hold asked for while loading (holdTabs below).
  let holdPending = false;
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
  // A heal that came while the search view was open (ResultPaint.heal).
  let deferredHeal: ResultPaint | undefined;
  // «Tilbake til <name>» when the drill-in's origin is known.
  let backName: string | undefined;
  let backHidden = true;

  // --- roots ------------------------------------------------------------

  function setBusy(loading: boolean): void {
    main.toggleAttribute('inert', loading);
    main.setAttribute('aria-busy', String(loading));
  }

  function setState(next: PanelState, answer: AnswerAttr): void {
    if (next !== 'loading') holdPending = false;
    state = next;
    answerAttr = answer;
    main.dataset.state = next;
    body.dataset.answer = answer;
    setBusy(next === 'loading');
    main.classList.remove('reveal');
  }

  // A rebuilt block drops the control a keyboard user was on. Find the
  // equivalent in the new markup — same tag, same accessible text — and
  // put focus back there; with no equivalent (the action is gone), focus
  // is left where the browser dropped it.
  function focusKeyOf(el: Element): string {
    return `${el.tagName}|${el.getAttribute('aria-label') ?? el.textContent?.trim() ?? ''}`;
  }

  function rebuildKeepingFocus(blocks: () => Element[], rebuild: () => void): void {
    const active = main.ownerDocument.activeElement;
    const key = active && blocks().some((b) => b.contains(active)) ? focusKeyOf(active) : undefined;
    rebuild();
    if (key === undefined) return;
    for (const block of blocks()) {
      for (const el of [block, ...block.querySelectorAll('h1, button, a[href], [tabindex]')]) {
        if (focusKeyOf(el) === key) {
          focusElement(el);
          return;
        }
      }
    }
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
  // The nav landmark around the button hides with it: an empty <nav>
  // still lists for a screen reader.
  function showBack(visible: boolean): void {
    roots.back.hidden = !visible;
    const nav = roots.back.closest('nav');
    if (nav) nav.hidden = !visible;
  }

  // The followed tab's toolbar badge, same rule as the popup: the
  // answer's tone when the company on screen is the tab's own
  // (view.badgeTone is set only for a host-derived result) and it is
  // worth a look (warn / danger); cleared for everything else.
  function badge(tabId: number | undefined, view?: TrustView): void {
    if (tabId === undefined) return;
    const tone = view?.badgeTone;
    void deps.setBadge(tabId, tone === 'warn' || tone === 'danger' ? tone : undefined);
  }

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
    showBack(false);
    roots.stick.hidden = true;
    searchBack.replaceChildren(icon('i-back'), el('b', undefined, searchBackLabel()));
    results.section.hidden = true;
    recents.section.hidden = true;
    main.classList.remove('reveal');
    main.replaceChildren(searchView);
    main.dataset.state = 'search';
    body.dataset.answer = 'empty';
    // Opened over a load: the results must be operable, so main's
    // inert/busy step aside with the skeleton and come back with it.
    setBusy(false);
    // «Hentet … · Oppdater» describes the result kept aside, not the
    // search on screen: the footer keeps the attribution only.
    if (state === 'result') renderFooter(foot, {});
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
    const heal = deferredHeal;
    deferredHeal = undefined;
    if (!restore) return;
    main.replaceChildren(kept.nodes);
    main.dataset.state = kept.state;
    body.dataset.answer = kept.answer;
    showBack(!kept.backHidden);
    state = kept.state;
    answerAttr = kept.answer;
    setBusy(kept.state === 'loading');
    watchIdent(shown && state === 'result' ? shown.ident : undefined);
    if (state === 'result') paintFooter();
    // Back on the result the heal was for: it lands now, focus stays.
    if (heal && state === 'result' && !heal.isStale()) result({ ...heal, focus: 'none' });
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

    const notes = buildNotes(view.merknader, view.endringer, view.failed.includes('endringer'));
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
            panel.append(...buildOkonomi(d.okonomi, { onGrant: () => intents.grantAccess() }));
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
  // reveal animation is still translating. The tab-panel region is
  // told what the landing leaves it (--land, details.css: the head,
  // the tablist and the footer) so its min-height lets even a short
  // tab scroll that far, with the footer flush at the bottom.
  function scrollToTabs(): void {
    holdTabs();
    const doc = main.ownerDocument;
    const go = (): void => {
      const tablist = main.querySelector<HTMLElement>('[role="tablist"]');
      const panels = main.querySelector<HTMLElement>('.tab-panels');
      const win = doc.defaultView;
      if (!tablist || !win) return;
      roots.stick.hidden = false;
      const head = roots.stick.offsetHeight;
      if (panels) {
        // Everything on screen at the landing besides the panels: the
        // head, the tablist, and what follows the region (the footer).
        const after = doc.body.scrollHeight - (panels.offsetTop + panels.offsetHeight);
        panels.style.setProperty('--land', `${head + panels.offsetTop - tablist.offsetTop + after}px`);
      }
      win.scrollTo({ top: tablist.offsetTop - head });
    };
    const fonts = (doc as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    if (fonts) void fonts.ready.then(go);
    else go();
  }

  // The region's min-height (details.css) holds only once the tabs are
  // in use, a landing or a switch: it keeps the tablist put when a long
  // tab gives way to a short one. A plain load of a short dossier ends
  // without a scrollbar. A hold asked for while loading (Back/Forward
  // selects the restored tab before its result lands) waits for the
  // next result paint.
  function holdTabs(): void {
    const region = main.querySelector('.tab-panels');
    if (region) region.classList.add('tab-panels--held');
    else if (state === 'loading') holdPending = true;
  }

  let footer: FooterHandle | undefined;
  function paintFooter(): void {
    if (!shown || aside) return;
    footer = renderFooter(
      foot,
      {
        fetchedAt: shown.view.fetchedAt,
        now: now().getTime(),
        ...(shown.view.footReportHref ? { reportHref: shown.view.footReportHref } : {}),
      },
      { onRefresh: () => intents.refresh() },
    );
  }

  // «Hentet for 2 min siden» moves on while the panel sits open — in
  // place, so focus on «Oppdater» or a footer link survives the tick.
  setInterval(() => {
    if (state === 'result' && !aside) footer?.tick(now().getTime());
  }, FRESHNESS_TICK_MS);

  function paintResult(view: TrustView, paint: Pick<ResultPaint, 'company' | 'method' | 'host' | 'remembered'>, reveal: boolean): void {
    const held = holdPending;
    setState('result', view.answer.tone);
    const top = buildTop(view);
    const { tablist, panels } = buildTabs(view);
    const region = el('div', 'tab-panels');
    if (held) region.classList.add('tab-panels--held');
    region.append(...panels);
    main.replaceChildren(...top.nodes, tablist, region);
    tabs = setupTabs(tablist, {
      initial: selectedTab,
      onSelect: (key) => {
        if (isTabKey(key)) selectedTab = key;
        holdTabs();
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

  // A company result. A heal (ResultPaint.heal) never closes the user's
  // search: while it is open the heal waits for closeSearch(true).
  function result(paint: ResultPaint): void {
    if (paint.heal && aside) {
      deferredHeal = paint;
      return;
    }
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
    // A heal swaps in the figures quietly: no reveal animation.
    paintResult(view, paint, !paint.heal);
    badge(paint.tabId, view);
    if (landOnTab) {
      landOnTab = false;
      scrollToTabs();
    }
    if (paint.focus === 'heading') focusElement(shown?.heading);
    else if (paint.focus === 'refresh') focusElement(foot.querySelector('button'));
    else if (paint.focus === 'tab') {
      scrollToTabs();
      focusElement(main.querySelector('[role="tab"][aria-selected="true"]'));
    }
  }

  // --- the painter -----------------------------------------------------------

  return {
    loading(orgnr, opts): void {
      paintId += 1;
      closeSearch(false);
      lastOrgnr = orgnr;
      shown = undefined;
      watchIdent(undefined);
      setState('loading', 'loading');
      main.replaceChildren(buildPanelSkeleton(opts));
      renderFooter(foot, { loading: true });
      live.announce(COPY.loadingOrgnr(orgnrText(orgnr).spaced));
    },

    result,

    // A same-company sync or tab event: how the company was reached
    // changed (host, method, the stored choice), the company did not.
    // Only what depends on that is rebuilt: everything above the tabs
    // and the footer. The open tab, its scroll position and a search in
    // progress stay.
    provenance({ method, host, remembered, tabId }): void {
      if (!shown) return;
      // A heal waiting behind the search keeps its fresh company data
      // but must land with how the company is reached now.
      if (deferredHeal) {
        const { remembered: _old, tabId: _oldTab, ...heal } = deferredHeal;
        deferredHeal = {
          ...heal,
          method,
          host,
          ...(remembered ? { remembered } : {}),
          ...(tabId !== undefined ? { tabId } : {}),
        };
      }
      const kept = shown;
      lastHost = host;
      const view = buildTrustView({
        company: kept.company,
        method,
        host,
        now: now(),
        surface: 'panel',
        ...(remembered ? { remembered } : {}),
        env: deps.env,
      });
      // The top and the footer are rebuilt; a focused control in them
      // (a copy button, «Feil bedrift?», «Oppdater») is found again.
      rebuildKeepingFocus(
        () => [...(shown?.top ?? []), foot],
        () => {
          const top = buildTop(view);
          const first = kept.top[0];
          const parent = first?.parentNode;
          if (!first || !parent) return;
          for (const node of top.nodes) parent.insertBefore(node, first);
          for (const old of kept.top) old.remove();
          shown = { ...kept, method, host, remembered, view, top: top.nodes, heading: top.heading, ident: top.ident };
          const answer = view.answer.tone;
          answerAttr = answer;
          if (aside) aside.answer = answer;
          else body.dataset.answer = answer;
          paintStick(view);
          if (!aside) watchIdent(top.ident);
          paintFooter();
        },
      );
      badge(tabId, view);
    },

    picker(host, candidates, { focus, tabId }): void {
      paintId += 1;
      closeSearch(false);
      shown = undefined;
      lastHost = host;
      watchIdent(undefined);
      setState('picker', 'pick');
      const painted = paintPicker(host, candidates);
      renderFooter(foot, { reportHref: report(undefined, host) });
      badge(tabId);
      if (focus) focusElement(painted.firstRow);
    },

    empty({ host, degraded, query, focus, tabId }): void {
      paintId += 1;
      const id = paintId;
      closeSearch(false);
      shown = undefined;
      lastHost = host;
      watchIdent(undefined);
      setState('empty', degraded ? 'warn' : 'empty');
      const site = host ? siteName(host) : undefined;

      const empty = el('div', 'empty');
      const heading = el('h1', undefined, site ? COPY.emptyNoMatch(site) : COPY.emptyNoSite);
      const text = el('p', undefined, site && !degraded ? COPY.emptyNoMatchText : COPY.emptyPanelText);
      if (degraded && site) {
        // The error leads: its band is the answer (no h1 repeats it),
        // the masthead field the way on.
        const band = buildErrorAnswer(
          { head: COPY.noAnswerHead, support: COPY.degradedSupport(site), retry: true },
          { onRetry: () => intents.retry() },
        );
        empty.append(text);
        main.replaceChildren(band.section, empty);
      } else {
        empty.append(heading, text);
        main.replaceChildren(empty);
      }
      const list = buildListSection(COPY.recents);
      list.section.hidden = true;
      main.appendChild(list.section);
      fillRecents(list);
      renderFooter(foot, host ? { reportHref: report(undefined, host) } : {});
      badge(tabId);

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

    error(err, { retry, focus, tabId }): void {
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
      // A failed lookup has no match to report.
      renderFooter(foot, {});
      badge(tabId);
      if (focus) focusElement(answer.heading);
    },

    clearBadge(tabId): void {
      badge(tabId);
    },

    setBack(visible): void {
      backHidden = !visible;
      if (aside) aside.backHidden = backHidden;
      else showBack(visible);
    },

    selectTab(key): void {
      if (!isTabKey(key)) return;
      selectedTab = key;
      holdTabs();
      tabs?.activateByKey(key);
    },
  };

  function paintPicker(host: string, candidates: Candidate[]) {
    // The first row (or «Ingen av disse») clicked wins: a second click
    // while the first choice is still being stored is ignored, so the
    // company stored is the company loaded.
    let picking = false;
    const choose = (orgnr: string | null, then: () => void): void => {
      if (picking) return;
      picking = true;
      void deps.setPickerChoice(host, orgnr).then(then).finally(() => {
        picking = false;
      });
    };
    return renderPicker(
      main,
      { site: siteName(host), candidates },
      {
        onPick: (orgnr) => choose(orgnr, () => intents.pick(host, orgnr)),
        onNone: () => choose(null, () => intents.none(host)),
        onSearchSelect: (orgnr) => intents.manual(orgnr),
        announce: live.announce,
      },
    );
  }
}

// The loading skeleton: the shared identity + answer + ledger
// geometry, then the konsern row, the tabs and the first section, so
// the layout that lands is the layout that shimmered. Static text only:
// the tabs are not a tablist (main is inert meanwhile).
export function buildPanelSkeleton(opts: { kobling: boolean }): DocumentFragment {
  const frag = buildSkeleton('panel', opts);
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
    [COPY.organisasjonsform, 'sk--m'],
    [COPY.stiftet, 'sk--s'],
    [COPY.registrert, 'sk--s'],
    [COPY.naering, 'sk--l'],
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
