// The popup controller: resolves the active tab, loads the company,
// builds the view model (buildTrustView) and runs the paints in
// views.ts. Small on purpose — every string, tone and action comes from
// the view model, every element from the shared components.
//
// Focus moves only on user-initiated transitions (a pick, a search, a
// retry): the result heading, or the first picker row. The initial
// load is not one; the popup opens with focus where the browser put it.

// Side-effect import: aliases `globalThis.browser = chrome` on Chromium
// before any `browser.*` access. Must stay the first import.
import '../lib/platform/globals.js';
import { invalidateCache } from '../lib/brreg.js';
import {
  isPermanentLoadError,
  loadCompany,
  type CompanyData,
} from '../lib/company-load.js';
import { writeClipboard } from '../lib/copy-orgnr.js';
import { hostnameLabel } from '../lib/hostname-score.js';
import {
  forgetHost,
  getRememberedChoice,
  setPickerChoice,
  type Candidate,
} from '../lib/hostname-search.js';
import {
  notifyPanel,
  panelPath,
  type PanelMessage,
  type PanelTarget,
} from '../lib/panel-protocol.js';
import { setTrustBadge } from '../lib/platform/badge.js';
import { isFirefox } from '../lib/platform/engine.js';
import { sidebar } from '../lib/platform/sidebar.js';
import { describeLoadFailure } from '../lib/ui/error-message.js';
import { primaryStatusFlag } from '../lib/ui/flags.js';
import { rejectChoice } from '../lib/ui/picker.js';
import { getRecent, pushRecent } from '../lib/ui/recent.js';
import {
  resolveTabContext,
  UNKNOWN_URL_METHOD,
  type ResolutionMethod,
  type TabContext,
} from '../lib/ui/resolve-tab.js';
import { focusElement, liveRegionOf } from '../lib/view/components/live.js';
import { COPY, reportHref } from '../lib/view/copy.js';
import {
  buildTrustView,
  orgnrText,
  siteName,
  type TrustView,
} from '../lib/view/trust-view.js';
import {
  paintEmpty,
  paintError,
  paintLoading,
  paintPicker,
  paintResult,
  type EmptyKind,
  type Roots,
} from './views.js';

const roots: Roots = {
  body: document.body,
  mast: document.getElementById('mast') as HTMLElement,
  main: document.getElementById('app') as HTMLElement,
  foot: document.getElementById('foot') as HTMLElement,
  live: liveRegionOf(document.getElementById('live') as HTMLElement),
};

// What «Rapporter feil treff» reports about this install. getManifest
// is optional-called: the preview harness's shim has none.
const env = {
  version: browser.runtime.getManifest?.()?.version ?? '',
  browser: isFirefox ? 'Firefox' : 'Chrome',
};

// The tab this popup opened on: its host is the site every lookup is
// about, its title feeds the hostname search's word hints, and its ids
// go to the gesture-bound side-panel open (Chrome's sidePanel.open
// needs a windowId/tabId and can't await a tabs.query inside the
// gesture) and to the toolbar badge.
let host: string | undefined;
let tabTitle: string | undefined;
let tabId: number | undefined;
let windowId: number | undefined;

let currentOrgnr: string | undefined;
let currentMethod: ResolutionMethod | undefined;
let currentView: TrustView | undefined;
// Monotonic guard for loadAndRender — from the empty state the user
// can click a search result then a recent entry in quick succession;
// without this the last-to-RESOLVE fetch chain paints, which can be
// the stale one.
let loadRunId = 0;
// «Prøv igjen» in the error state re-runs the last load.
let lastLoad: (() => void) | undefined;
// Re-paints the state on screen without fetching: what the search view
// (opened from the masthead over any state) returns to.
let repaint: (() => void) | undefined;
let searchOpen = false;

const site = (): string | undefined => (host ? siteName(host) : undefined);
const report = (): string =>
  reportHref({ host, orgnr: currentOrgnr, method: currentMethod, ...env });

// --- side panel -----------------------------------------------------------

function panelHref(target: PanelTarget): string {
  // The link names no window: shift-click can open it in a new one.
  return browser.runtime.getURL(panelPath(target, Date.now()));
}

function openPanel(target: PanelTarget, ev?: Event): void {
  ev?.preventDefault();
  // setPanel + open must both fire inside this click's gesture stack.
  // No await before open() — both engines consume the activation token
  // on the first await, and Chrome's sidePanel.open hard-requires a
  // live gesture. The path is stamped with the click's time and this
  // window, so the panel treats it as this open's target, not a
  // leftover, and a panel in another window ignores it.
  sidebar.setPanel(panelPath(target, Date.now(), windowId));
  sidebar.open({ windowId, tabId });
  window.close();
}

function panelTarget(): PanelTarget {
  if (currentOrgnr) return { orgnr: currentOrgnr };
  if (host) return { nomatch: host };
  return undefined;
}

async function syncOpenPanel(msg: PanelMessage): Promise<void> {
  // A panel open in this window, opened earlier on a different tab,
  // holds stale data until something tells it to repaint: this
  // message, which the open details page applies in place. No setPanel
  // here — that would only leave a global panel URL behind.
  try {
    if (!(await sidebar.isOpen(msg.windowId))) return;
  } catch {
    return;
  }
  await notifyPanel(msg);
}

function syncSidebar(orgnr: string): void {
  if (windowId === undefined) return;
  const method = currentMethod ?? UNKNOWN_URL_METHOD;
  void syncOpenPanel({
    type: 'sync',
    windowId,
    orgnr,
    // A manual pick has nothing to do with the tab's site.
    host: method === 'manual' ? undefined : host,
    method,
  });
}

function syncSidebarNoMatch(): void {
  if (windowId === undefined) return;
  void syncOpenPanel({ type: 'no-match', windowId, host });
}

// --- badge ------------------------------------------------------------------

// The toolbar button of the popup's tab: «!» / «✕» only when the company
// on screen is the tab's own and something is worth a look.
function badge(view: TrustView | undefined): void {
  if (tabId === undefined) return;
  const tone = view?.badgeTone;
  void setTrustBadge(tabId, tone === 'warn' || tone === 'danger' ? tone : undefined);
}

// --- paints -------------------------------------------------------------------

const onSearch = (): void => openSearch();

function showLoading(orgnr: string): void {
  repaint = undefined;
  paintLoading(roots, host, { onSearch });
  roots.live.announce(COPY.loadingOrgnr(orgnrText(orgnr).spaced));
}

function showResult(view: TrustView, opts: { focus: boolean; reveal: boolean }): void {
  currentView = view;
  searchOpen = false;
  const target = panelTarget();
  const paint = (reveal: boolean): ReturnType<typeof paintResult> =>
    paintResult(roots, view, {
      host,
      now: Date.now(),
      reveal,
      onSearch,
      copy: writeClipboard,
      announce: roots.live.announce,
      onReject: () => void reject(),
      onForget: () => void forget(),
      onBackToSite: () => void init({ focus: true }),
      onRefresh: () => void refresh(),
      onOpenPanel: (ev) => openPanel(target, ev),
      onOpenKonsern: () => openPanel(currentOrgnr ? { orgnr: currentOrgnr, tab: 'enheter' } : target),
      ...(target ? { panelHref: panelHref(target) } : {}),
    });
  const painted = paint(opts.reveal);
  repaint = () => paint(false);
  badge(view);
  if (opts.focus) focusElement(painted.heading);
}

function showPicker(candidates: Candidate[], opts: { focus: boolean }): void {
  if (!host) return;
  const h = host;
  currentOrgnr = undefined;
  currentView = undefined;
  searchOpen = false;
  const paint = (): ReturnType<typeof paintPicker> =>
    paintPicker(
      roots,
      {
        host: h,
        site: siteName(h),
        query: hostnameLabel(h) ?? siteName(h),
        candidates,
        reportHref: report(),
      },
      {
        onSearch,
        onPick: (orgnr) => void pick(h, orgnr),
        onNone: () => void none(h),
        onSearchSelect: (orgnr) => void loadAndRender(orgnr, 'manual', { focus: true }),
      },
    );
  const picker = paint();
  repaint = paint;
  badge(undefined);
  if (opts.focus) focusElement(picker.firstRow);
}

async function showEmpty(kind: EmptyKind, opts: { focus: boolean }): Promise<void> {
  if (kind.kind !== 'search') {
    currentOrgnr = undefined;
    currentView = undefined;
    currentMethod = undefined;
  }
  searchOpen = kind.kind === 'search';
  const [recents, remembered] = await Promise.all([
    getRecent(),
    host ? getRememberedChoice(host) : undefined,
  ]);
  const returnTo = repaint;
  const paint = (): ReturnType<typeof paintEmpty> =>
    paintEmpty(
      roots,
      {
        kind,
        recents,
        ...(site() ? { site: site() } : {}),
        ...(remembered && site() && kind.kind !== 'search' ? { forgetSite: site() } : {}),
        ...(host ? { reportHref: report() } : {}),
      },
      {
        onSearch,
        onSelect: (orgnr) => void loadAndRender(orgnr, 'manual', { focus: true }),
        onForget: () => void forget(),
        onRetry: () => void init({ focus: true }),
        onBack: () => closeSearch(returnTo),
      },
    );
  const view = paint();
  if (kind.kind !== 'search') repaint = paint;
  badge(undefined);
  if (opts.focus) focusElement(kind.kind === 'search' ? view.input : view.heading);
}

async function showError(err: unknown): Promise<void> {
  currentView = undefined;
  searchOpen = false;
  const recents = await getRecent();
  const error = describeLoadFailure(err);
  // «Prøv igjen» only when there is a load to re-run and asking again
  // could change the answer: a not-found can't.
  error.retry = error.retry && lastLoad !== undefined && !isPermanentLoadError(err);
  const context = currentOrgnr
    ? { label: COPY.contextOrgnr, strong: orgnrText(currentOrgnr).spaced }
    : site()
      ? { label: COPY.contextFor, strong: site()! }
      : undefined;
  const paint = (): void => {
    paintError(
      roots,
      {
        host,
        error,
        recents,
        ...(context ? { context } : {}),
        ...(host || currentOrgnr ? { reportHref: report() } : {}),
      },
      {
        onSearch,
        onRetry: () => lastLoad?.(),
        onSelect: (orgnr) => void loadAndRender(orgnr, 'manual', { focus: true }),
      },
    );
  };
  paint();
  repaint = paint;
  badge(undefined);
}

// --- search view (from the masthead, over any state) ------------------------

function openSearch(): void {
  if (searchOpen) return;
  const name = currentView?.identity.name ?? site();
  const back = name ? COPY.back(name) : COPY.backPlain;
  void showEmpty({ kind: 'search', host, back }, { focus: true });
}

function closeSearch(returnTo: (() => void) | undefined): void {
  searchOpen = false;
  if (returnTo) {
    returnTo();
    repaint = returnTo;
  } else {
    void showEmpty(host ? { kind: 'no-match', host } : { kind: 'no-site' }, { focus: false });
  }
  focusElement(roots.mast.querySelector('.icon-btn'));
}

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape' || !searchOpen) return;
  const back = roots.main.querySelector<HTMLButtonElement>('button.back');
  if (!back) return;
  ev.preventDefault();
  back.click();
});

// --- intents ---------------------------------------------------------------------

async function loadAndRender(
  orgnr: string,
  method: ResolutionMethod | undefined,
  opts: { focus: boolean },
): Promise<void> {
  const myRunId = ++loadRunId;
  currentOrgnr = orgnr;
  if (method !== undefined) currentMethod = method;
  lastLoad = () => void loadAndRender(orgnr, method, opts);
  showLoading(orgnr);
  syncSidebar(orgnr);
  try {
    // Roller and regnskap ride along (soft: a failure is «couldn't
    // ask», and the view omits what it can't back). Konsern is one
    // more request only when the Enhet says erIKonsern. An underenhet
    // orgnr loads its parent (company-load).
    const [company, remembered] = await Promise.all([
      loadCompany(orgnr, { konsern: true }),
      host ? getRememberedChoice(host) : undefined,
    ]);
    if (myRunId !== loadRunId) return;
    currentOrgnr = company.enhet.organisasjonsnummer;
    const view = buildTrustView({
      company,
      method: currentMethod,
      host,
      now: new Date(),
      surface: 'popup',
      ...(remembered ? { remembered } : {}),
      env,
    });
    remember(company);
    showResult(view, { focus: opts.focus, reveal: true });
  } catch (err) {
    if (myRunId !== loadRunId) return;
    await showError(err);
  }
}

// Stamp the recent stack once a company is confirmed: earlier we don't
// know the name, later would also keep orgnrs that failed to load.
function remember(company: CompanyData): void {
  const flag = primaryStatusFlag(company.enhet);
  void pushRecent(
    company.enhet.organisasjonsnummer,
    company.enhet.navn,
    flag.severity === 'danger' ? flag.label : undefined,
  );
}

async function pick(h: string, orgnr: string): Promise<void> {
  await setPickerChoice(h, orgnr);
  await loadAndRender(orgnr, 'host-pick', { focus: true });
}

async function none(h: string): Promise<void> {
  await setPickerChoice(h, null);
  syncSidebarNoMatch();
  await showEmpty({ kind: 'none', host: h }, { focus: true });
}

// «Feil bedrift?»: record the rejection, re-run the host search, and
// show what is left (the picker, or the empty state).
async function reject(): Promise<void> {
  if (!host || !currentOrgnr) return;
  const h = host;
  const myRunId = ++loadRunId;
  const outcome = await rejectChoice(h, currentOrgnr, tabTitle, () => myRunId !== loadRunId);
  if (!outcome) return;
  if (outcome.kind === 'picker') showPicker(outcome.candidates, { focus: true });
  else await showEmpty({ kind: 'no-match', host: h }, { focus: true });
}

// «Glem valget for <site>»: drop everything remembered about the site
// and resolve it from scratch.
async function forget(): Promise<void> {
  if (!host) return;
  await forgetHost(host);
  await init({ focus: true });
}

async function refresh(): Promise<void> {
  if (!currentOrgnr) return;
  await invalidateCache(currentOrgnr);
  lastLoad?.();
}

// --- init -----------------------------------------------------------------------

async function resolveFromActiveTab(): Promise<TabContext> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  windowId = tab?.windowId;
  tabId = tab?.id;
  tabTitle = tab?.title || undefined;
  const ctx = await resolveTabContext(tab?.url ?? '', tab?.title ?? '');
  host = ctx.host;
  return ctx;
}

async function init(opts: { focus: boolean }): Promise<void> {
  loadRunId += 1;
  try {
    const ctx = await resolveFromActiveTab();
    if (ctx.orgnr) {
      await loadAndRender(ctx.orgnr, ctx.method, opts);
      return;
    }
    currentOrgnr = undefined;
    currentMethod = undefined;
    if (ctx.pickerCandidates && ctx.host) {
      showPicker(ctx.pickerCandidates, opts);
      return;
    }
    if (!ctx.host) {
      await showEmpty({ kind: 'no-site' }, opts);
      return;
    }
    await showEmpty(
      ctx.degraded ? { kind: 'degraded', host: ctx.host } : { kind: 'no-match', host: ctx.host },
      opts,
    );
  } catch (err) {
    await showError(err);
  }
}

void init({ focus: false });
