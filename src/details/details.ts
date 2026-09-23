// Side-effect import: aliases `globalThis.browser = chrome` on Chromium
// before any `browser.*` access. Must stay the first import.
import '../lib/platform/globals.js';
import { decideToggle } from '../lib/auto-sync-controller.js';
import {
  AUTO_SYNC_STORAGE_KEY,
  getAutoSync,
  setAutoSync,
} from '../lib/auto-sync-settings.js';
import { invalidateCache } from '../lib/brreg.js';
import { isPermanentLoadError, loadCompany } from '../lib/company-load.js';
import { formatRelativeTime } from '../lib/format.js';
import { searchByHostnameDetailed } from '../lib/hostname-search.js';
import { isValidOrgnr } from '../lib/mod11.js';
import {
  createLoadSequence,
  createPanelFollower,
  type LoadToken,
  type PanelView,
} from '../lib/panel-follow.js';
import {
  isForWindow,
  parsePanelMessage,
  readPanelHint,
} from '../lib/panel-protocol.js';
import { isFirefox } from '../lib/platform/engine.js';
import { createTabWatcher, type TabWatcher } from '../lib/tab-sync.js';
import { describeLoadError } from '../lib/ui/error-message.js';
import { attachManualSearch } from '../lib/ui/manual-search.js';
import { createPicker, setupRejectChoice } from '../lib/ui/picker.js';
import { pushRecent, renderRecentSection } from '../lib/ui/recent.js';
import {
  resolveTabContext,
  type ResolutionMethod,
} from '../lib/ui/resolve-tab.js';
import { createSourceLabel } from '../lib/ui/source-label.js';
import { avdelingNote } from '../lib/ui/summary-lines.js';
import type { SearchHit } from '../types/brreg.js';
import { $ } from './render/dom.js';
import { renderHeader } from './render/header.js';
import { renderNokkeltall } from './render/nokkeltall.js';
import { renderContact, renderOverview } from './render/overview.js';
import { renderParent } from './render/parent.js';
import { renderRoles } from './render/roles.js';
import { renderUnderenheter } from './render/underenheter.js';

const app = $('app');
const brandMark = $('brand-mark') as HTMLImageElement;
brandMark.src = browser.runtime.getURL('icons/icon-48.png');
const statusEl = $('status');
const errorActionsEl = $('error-actions');
const retryLoadBtn = $('retry-load') as HTMLButtonElement;
const skeletonEl = $('skeleton');
const resultEl = $('result');
const nameEl = $('name');
const avdelingNoteEl = $('avdeling-note');
const brregLink = $('brreg-link') as HTMLAnchorElement;
const footerUpdated = $('footer-updated');
const updatedTime = $('updated-time') as HTMLTimeElement;
const refreshBtn = $('refresh-data') as HTMLButtonElement;
const autoSyncToggle = $('auto-sync-toggle') as HTMLInputElement;
const autoSyncStatus = $('auto-sync-status');
const footerSource = $('footer-source');
const sourceHostEl = $('source-host');
const pickerEl = $('picker');
const pickerListEl = $('picker-list') as HTMLUListElement;
const pickerNoneBtn = $('picker-none') as HTMLButtonElement;
const emptyStateEl = $('empty-state');
const emptyMessageEl = $('empty-message');
const manualQueryEl = $('manual-query') as HTMLInputElement;
const manualResultsEl = $('manual-results') as HTMLUListElement;
const recentSectionEl = $('recent-section');
const recentListEl = $('recent-list') as HTMLUListElement;
const resolutionActionsEl = $('resolution-actions');
const rejectChoiceBtn = $('reject-choice') as HTMLButtonElement;
const backBtn = $('back-link') as HTMLButtonElement;

const BRREG_LINK_FALLBACK = 'https://virksomhet.brreg.no/nb/oppslag/enheter';

// The orgnr asked for (URL, sync, search). For an underenhet that is
// not the company on screen — see shownEnhetOrgnr.
let currentOrgnr: string | undefined;
// The enhet actually rendered: currentOrgnr, or its parent when
// currentOrgnr is an underenhet. «Oppdater» drops both from the cache.
let shownEnhetOrgnr: string | undefined;
let currentResolutionMethod: ResolutionMethod | undefined;
// When the data on screen was fetched from brreg, not when it was
// painted: a cache hit can be up to a day old.
let fetchedAt: number | undefined;
let updatedTimerId: number | undefined;
// Every flow that ends in a paint claims a token from this one
// sequence (the painters below claim their own; flows that await first
// claim at entry) and drops its result once a newer flow has started.
// See panel-follow.ts.
const loads = createLoadSequence();
// What the panel settled on (result / picker / empty) — undefined
// while loading or on error. Lets a sync or tab event for what's
// already shown keep it instead of repainting through the skeleton.
let onScreen: PanelView | undefined;
// The load whose result is on screen. renderParent's late name upgrade
// checks this rather than the load token: a sync that keeps the same
// company claims a token but leaves this load's result standing.
let shownLoad: LoadToken | undefined;
// Re-trigger for the "Prøv igjen" button in the full error state.
let lastLoad: (() => void) | undefined;
// Assigned by setupTabs; lets popstate re-activate the tab named by a
// restored ?tab= entry without reaching into setupTabs' closure.
let activateTabByKey: (key: string) => void = () => {};

const sourceLabel = createSourceLabel(footerSource, sourceHostEl);

// The picker persists the choice before calling back. If a tab event
// or sync repainted the panel during that write, the pick is for a
// picker no longer on screen: keep the newer view (the choice is saved
// and applies next time the host resolves).
function pickerStillShown(host: string): boolean {
  return onScreen?.kind === 'picker' && onScreen.host === host;
}

const picker = createPicker({
  appEl: app,
  listEl: pickerListEl,
  noneBtn: pickerNoneBtn,
  onChoose: (host, orgnr) => {
    if (!pickerStillShown(host)) return;
    setHistoryOrgnr(orgnr, 'host-pick', false);
    void loadOrgnr(orgnr, 'host-pick');
  },
  onNone: (host) => {
    if (!pickerStillShown(host)) return;
    showEmptyState(host);
  },
});

const manualSearch = attachManualSearch({
  inputEl: manualQueryEl,
  resultsEl: manualResultsEl,
  onSelect: (hit) => {
    setHistoryOrgnr(hit.organisasjonsnummer, 'manual', false);
    void loadOrgnr(hit.organisasjonsnummer, 'manual');
  },
});

// «Feil bedrift?» awaits a storage write and a fresh host search
// before it paints. getContext runs synchronously on the click, so the
// flow claims its load token there; a tab event or sync that arrives
// during the search then wins over this flow's late picker.
let rejectRun: LoadToken | undefined;
setupRejectChoice({
  buttonEl: rejectChoiceBtn,
  getContext: () => {
    rejectRun = loads.begin();
    return { host: sourceLabel.get(), orgnr: currentOrgnr };
  },
  showPicker: (host, candidates) => {
    if (!rejectRun?.isStale()) showPicker(host, candidates);
  },
  showEmptyState: (host) => {
    if (!rejectRun?.isStale()) showEmptyState(host);
  },
});

retryLoadBtn.addEventListener('click', () => {
  lastLoad?.();
});

// «Oppdater» in the footer: refetch the company on screen instead of
// serving the cached copy. Only shown with a result.
refreshBtn.addEventListener('click', () => {
  if (!currentOrgnr || app.dataset.state !== 'result') return;
  void loadOrgnr(currentOrgnr, currentResolutionMethod, {
    invalidate: [currentOrgnr, shownEnhetOrgnr],
  });
});

// The popstate listener below does the actual restore.
backBtn.addEventListener('click', () => {
  window.history.back();
});

// The window this panel document lives in. Firefox sidebars and
// Chrome side panels are one document per browser window, and
// windows.getCurrent() called from one returns that window (MDN
// windows.getCurrent; Chrome windows § "The current window"). Messages
// and tab events are scoped to it.
const panelWindowId: Promise<number | undefined> = browser.windows
  .getCurrent()
  .then(
    (win) => win.id,
    () => undefined,
  );

setupTabs();
void setupAutoSyncToggle();

function getOrgnrFromUrl(): string | undefined {
  const params = new URLSearchParams(window.location.search);
  const orgnr = params.get('orgnr');
  if (orgnr && isValidOrgnr(orgnr)) return orgnr;
  return undefined;
}

function getNoMatchHostFromUrl(): string | undefined {
  const params = new URLSearchParams(window.location.search);
  const host = params.get('nomatch');
  return host ?? undefined;
}

function clearOrgnrFromUrl(): void {
  // Clear any orgnr left in the URL so a panel reload doesn't re-fetch
  // the stale company.
  const url = new URL(window.location.href);
  url.searchParams.delete('orgnr');
  window.history.replaceState(null, '', url.toString());
}

// Shape stored in history.state for an orgnr entry, so popstate can
// restore the company, its override-button method, and the footer host
// without re-resolving.
interface HistoryEntry {
  orgnr: string;
  method: ResolutionMethod;
  host?: string;
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { orgnr?: unknown }).orgnr === 'string'
  );
}

// Single writer for the ?orgnr= history entry. `push: true` adds a new
// entry (in-panel drill-in, so Back returns to where you came from);
// `push: false` replaces it (resolving the active tab, sync, no-match,
// init reconcile — these track the current tab, not a navigation the
// user wants to reverse). The method is stamped into history.state so
// popstate can restore the right override-button visibility on Back.
function setHistoryOrgnr(
  orgnr: string,
  method: ResolutionMethod,
  push: boolean,
): void {
  const url = new URL(window.location.href);
  url.searchParams.set('orgnr', orgnr);
  url.searchParams.delete('nomatch');
  // Snapshot the current source host into the entry so a Back/Forward
  // restores the footer label too. Read at write time — callers set
  // sourceLabel before calling this.
  const state: HistoryEntry = { orgnr, method, host: sourceLabel.get() };
  if (push) {
    window.history.pushState(state, '', url.toString());
  } else {
    window.history.replaceState(state, '', url.toString());
  }
}

// In-panel drill-in into a related entity (parent enhet or a company
// role-holder). Pushes a history entry so the browser Back button
// returns to the entity the user came from. Drilled-in entities aren't
// host-resolved — clear the source label first so the footer doesn't
// keep claiming "synket fra <host>" (and so the snapshot in the new
// entry is host-less), and load with 'drill-in' so the "Feil bedrift?"
// override stays hidden.
function navigateToRelated(orgnr: string): void {
  if (!isValidOrgnr(orgnr)) return;
  sourceLabel.set(undefined);
  setHistoryOrgnr(orgnr, 'drill-in', true);
  void loadOrgnr(orgnr, 'drill-in', { focusResult: true });
}

function setState(
  state: 'loading' | 'result' | 'error' | 'picker' | 'empty',
): void {
  // Leaving the picker — clear candidate state so a stray keydown
  // can't fire the picker's onChoose on a previous host's list.
  if (state !== 'picker') picker.clear();
  app.dataset.state = state;
  // The painters record what settled after calling this.
  onScreen = undefined;
  shownLoad = undefined;
  skeletonEl.hidden = state !== 'loading';
  // statusEl carries the aria-live polite announcement during loading
  // (kept off-screen, not display:none, so screen readers still read it)
  // and becomes the visible error message during state='error'.
  if (state === 'loading') {
    statusEl.hidden = false;
    statusEl.classList.add('visually-hidden');
  } else if (state === 'error') {
    statusEl.hidden = false;
    statusEl.classList.remove('visually-hidden');
  } else {
    statusEl.hidden = true;
    statusEl.classList.remove('visually-hidden');
  }
  // showError unhides this when a retry target exists.
  errorActionsEl.hidden = true;
  resultEl.hidden = state !== 'result';
  updateBackButton();
  pickerEl.hidden = state !== 'picker';
  emptyStateEl.hidden = state !== 'empty';
  if (state !== 'result') {
    // The "Synket fra <host> · Data hentet …" footer describes the
    // company on screen — hide it (and stop the 30s repaint) when no
    // company is on screen. markFetched() re-arms both on the next
    // successful load.
    footerUpdated.hidden = true;
    if (updatedTimerId !== undefined) {
      clearInterval(updatedTimerId);
      updatedTimerId = undefined;
    }
  }
}

function updateBackButton(): void {
  // Only a drilled-in entity has an in-panel "back" to offer; the
  // method is stamped in history.state, so this stays correct across
  // Back/Forward restores and sync replaceState overwrites.
  backBtn.hidden =
    app.dataset.state !== 'result' ||
    !isHistoryEntry(window.history.state) ||
    window.history.state.method !== 'drill-in';
}

function setBrregLink(orgnr?: string): void {
  brregLink.href = orgnr
    ? `https://virksomhet.brreg.no/nb/oppslag/enheter/${orgnr}`
    : BRREG_LINK_FALLBACK;
}

function showError(err: unknown): void {
  setState('error');
  statusEl.textContent = describeLoadError(err);
  // "Prøv igjen" only makes sense when there is a load to re-trigger
  // and asking again could change the answer — a not-found can't.
  errorActionsEl.hidden = lastLoad === undefined || isPermanentLoadError(err);
}

function showEmptyState(host?: string, degraded = false): void {
  // Claim the token: an in-flight load must not land on top of this.
  loads.begin();
  setState('empty');
  onScreen = { kind: 'empty', host, degraded };
  clearOrgnrFromUrl();
  currentOrgnr = undefined;
  setBrregLink();
  sourceLabel.set(host);
  // degraded = the hostname search itself failed (offline, brreg down)
  // — "we couldn't check" must not read as a confirmed "no match".
  emptyMessageEl.textContent = degraded
    ? `Fikk ikke svar fra Brønnøysundregistrene, så ${host ?? 'siden'} kunne ikke sjekkes. Prøv igjen om litt.`
    : host
      ? `Ingen bedrift identifisert på ${host}. Søk for å finne riktig bedrift.`
      : 'Sidepanelet ble åpnet uten en bedrift å vise. Søk i Brønnøysundregistrene under.';
  manualSearch.reset();
  void renderRecentSection(recentSectionEl, recentListEl, (entry) => {
    setHistoryOrgnr(entry.orgnr, 'manual', false);
    void loadOrgnr(entry.orgnr, 'manual');
  });
  // Focus the search box only when the sidebar window itself has
  // focus — with auto-sync on, a tab switch to an unresolvable site
  // repaints this panel in the background, and an unconditional
  // focus() would yank keyboard focus out of the page.
  if (document.hasFocus()) manualQueryEl.focus();
}

function showPicker(host: string, candidates: SearchHit[]): void {
  // Claim the token so an in-flight loadOrgnr from a previous tab
  // can't overwrite the picker when its fetches land.
  loads.begin();
  setState('picker');
  onScreen = { kind: 'picker', host, candidates };
  sourceLabel.set(host);
  currentOrgnr = undefined;
  setBrregLink();
  clearOrgnrFromUrl();
  picker.render(host, candidates);
}

function updateRejectButtonVisibility(): void {
  const overridable =
    currentResolutionMethod === 'host-auto' ||
    currentResolutionMethod === 'host-pick';
  resolutionActionsEl.hidden = !(overridable && sourceLabel.get());
}

async function loadOrgnr(
  orgnr: string,
  method?: ResolutionMethod,
  opts: {
    focusResult?: boolean;
    // «Oppdater»: orgnrs whose cached data is dropped first, so every
    // part is refetched from brreg.
    invalidate?: Array<string | undefined>;
  } = {},
): Promise<void> {
  // If a second sync lands while this one is still in flight, the
  // older fetches must not overwrite the newer ones when they land out
  // of order.
  const run = loads.begin();
  currentOrgnr = orgnr;
  if (method !== undefined) currentResolutionMethod = method;
  lastLoad = () => {
    void loadOrgnr(orgnr, method);
  };

  setBrregLink(orgnr);

  setState('loading');
  statusEl.textContent = `Henter ${orgnr}…`;

  try {
    if (opts.invalidate) {
      const orgnrs = new Set(opts.invalidate.filter((n) => n !== undefined));
      await Promise.all([...orgnrs].map((n) => invalidateCache(n)));
    }
    // The fetch-and-failure policy is shared with the popup: roller,
    // underenheter and regnskap come back undefined when their fetch
    // failed ("couldn't ask"), and each renderer says so instead of
    // claiming an empty registry. An underenhet orgnr loads its parent.
    const company = await loadCompany(orgnr, { underenheter: true });
    if (run.isStale()) return;
    const { enhet, avdeling, roller, underenheter, regnskap } = company;

    // Stamp the recent stack now that the Enhet is confirmed — same
    // rule as the popup: never persist orgnrs that failed to fetch.
    void pushRecent(enhet.organisasjonsnummer, enhet.navn);
    // For an underenhet that is the parent — the company on screen.
    setBrregLink(enhet.organisasjonsnummer);
    shownEnhetOrgnr = enhet.organisasjonsnummer;

    renderHeader(enhet, regnskap);
    avdelingNoteEl.hidden = !avdeling;
    avdelingNoteEl.textContent = avdeling ? avdelingNote(avdeling) : '';
    renderOverview(enhet, roller);
    renderContact(enhet);
    renderRoles(roller, navigateToRelated);
    void renderParent(
      enhet.overordnetEnhet,
      navigateToRelated,
      () => shownLoad !== run,
    );
    renderUnderenheter(underenheter);
    renderNokkeltall(regnskap, enhet);
    setState('result');
    shownLoad = run;
    onScreen = {
      kind: 'company',
      orgnr,
      method: currentResolutionMethod ?? 'url',
      host: sourceLabel.get(),
    };
    updateRejectButtonVisibility();
    markFetched(company.fetchedAt);
    // After an in-panel drill-in or Back/Forward, the <a> the user
    // activated was torn down by the re-render and focus fell to
    // <body>. Move focus to the company heading so keyboard users
    // continue from the new content and screen readers announce the
    // resolved name. Gated to drill-in/popstate (never the background
    // sync repaint) and to the sidebar window actually holding focus —
    // same guard showEmptyState uses to avoid yanking focus off the
    // active page during an auto-sync tab switch.
    if (opts.focusResult && document.hasFocus()) nameEl.focus();
    // «Oppdater» was hidden with the footer while loading, so focus
    // fell to <body>; hand it back to the button.
    else if (opts.invalidate && document.hasFocus()) refreshBtn.focus();
  } catch (err) {
    if (run.isStale()) return;
    showError(err);
  }
}

function markFetched(at: number): void {
  fetchedAt = at;
  footerUpdated.hidden = false;
  paintFetchedLabel();
  // Repaint the relative label every 30s so "akkurat nå" → "for 1 min
  // siden" transitions don't look stuck.
  if (updatedTimerId !== undefined) clearInterval(updatedTimerId);
  updatedTimerId = window.setInterval(paintFetchedLabel, 30_000);
}

function paintFetchedLabel(): void {
  if (fetchedAt === undefined) return;
  updatedTime.dateTime = new Date(fetchedAt).toISOString();
  updatedTime.textContent = formatRelativeTime(fetchedAt);
}

// --- auto-sync ------------------------------------------------------
//
// With «Auto-oppdater» on (toggle stored on AND the runtime `tabs`
// grant), this panel follows the active tab of its own window: it
// registers tabs.onActivated / onUpdated itself and resolves through
// the same cascade as startup. The panel document exists only while
// the sidebar / side panel is open (MDN "Sidebars": unloaded when the
// user closes the sidebar), so closing it stops every lookup by
// construction. See docs/notes/sidebar-sync.md § panel-hosted-auto-sync.

// Cached effective state of the toggle. Kept in sync with
// storage + permission grant so handleToggleChange can call
// browser.permissions.request *without* an await between the
// click handler and the request — Firefox consumes the user
// activation token across the first await, and consumed activation
// makes permissions.request reject with "Firefox blokkerte
// forespørselen".
let currentAutoSyncEnabled = false;
// Undefined only if the panel couldn't learn its window — then it
// can't tell its own tabs from other windows' and doesn't follow any.
let tabWatcher: TabWatcher | undefined;

function applyAutoSync(enabled: boolean): void {
  currentAutoSyncEnabled = enabled;
  autoSyncToggle.checked = enabled;
  if (enabled) tabWatcher?.attach();
  else tabWatcher?.detach();
}

async function setupAutoSyncToggle(): Promise<void> {
  const windowId = await panelWindowId;
  if (windowId !== undefined) {
    tabWatcher = createTabWatcher({
      tabs: browser.tabs,
      windowId,
      supportsUpdateFilter: isFirefox,
      onTabChange: (tabId, tab) => {
        void follower.followTab(tabId, tab);
      },
    });
  }
  await reconcileAutoSync();

  autoSyncToggle.addEventListener('change', () => {
    void handleToggleChange(autoSyncToggle.checked);
  });

  // External revoke (about:addons / chrome://extensions) — detach and
  // flip the checkbox live. Sync shim around the async handler so
  // addListener gets a void-returning function.
  browser.permissions.onRemoved.addListener(onPermissionsRemoved);
  // The toggle flipped in another window's panel: follow suit here.
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !(AUTO_SYNC_STORAGE_KEY in changes)) return;
    void reconcileAutoSync();
  });
}

async function reconcileAutoSync(): Promise<void> {
  // The toggle is "on" only if storage says so AND the tabs permission
  // is currently granted (the user can revoke externally via
  // about:addons or chrome://extensions). `tabs` is an optional
  // (runtime opt-in) permission in both manifests, so this flow is
  // engine-agnostic.
  const [storedOn, hasTabs] = await Promise.all([
    getAutoSync(),
    browser.permissions.contains({ permissions: ['tabs'] }),
  ]);
  // A click in this panel owns the state until its prompt settles.
  if (toggleInFlight) return;
  applyAutoSync(storedOn && hasTabs);
  if (storedOn && !hasTabs) {
    // Storage said on but permission was revoked externally. Reset.
    await setAutoSync(false);
  }
}

function onPermissionsRemoved(perms: browser.permissions.Permissions): void {
  void handlePermissionsRemoved(perms);
}

async function handlePermissionsRemoved(
  perms: browser.permissions.Permissions,
): Promise<void> {
  if (!perms.permissions?.includes('tabs')) return;
  // Detach before any await so no tab event slips in after the revoke.
  applyAutoSync(false);
  await setAutoSync(false);
  showAutoSyncStatus(null);
}

let toggleInFlight = false;

async function handleToggleChange(desired: boolean): Promise<void> {
  // Guard against rapid double-clicks racing the permissions.request
  // prompt. Without this, a second click while the first await is
  // pending interleaves the two decisions and the final visible state
  // can contradict what the user last clicked.
  if (toggleInFlight) return;
  toggleInFlight = true;
  autoSyncToggle.disabled = true;
  // Capture before any awaits — currentAutoSyncEnabled is module-level
  // and can be flipped by onPermissionsRemoved between calls.
  const wasEnabled = currentAutoSyncEnabled;
  try {
    let grantOutcome: 'granted' | 'denied' | 'n/a' = 'n/a';
    if (desired && !wasEnabled) {
      // CRITICAL: permissions.request must be the first async call
      // after the user's click. Any await before this consumes the
      // user-activation token and Firefox blocks the prompt.
      try {
        const granted = await browser.permissions.request({
          permissions: ['tabs'],
        });
        grantOutcome = granted ? 'granted' : 'denied';
      } catch {
        grantOutcome = 'denied';
      }
    }

    const decision = decideToggle({
      desired,
      currentlyEnabled: wasEnabled,
      grantOutcome,
    });

    // Visual checkbox state always follows the decision — important
    // when the user denied the prompt and we need to revert the tick.
    autoSyncToggle.checked = decision.nextEnabled;
    // Detach first thing on the way off, so no tab event is resolved
    // while the storage write and permission removal are pending.
    if (decision.detachListeners) applyAutoSync(false);

    if (decision.persist) {
      await setAutoSync(decision.nextEnabled);
      currentAutoSyncEnabled = decision.nextEnabled;
    }
    if (decision.attachListeners) applyAutoSync(true);

    if (decision.removePermission) {
      try {
        await browser.permissions.remove({ permissions: ['tabs'] });
      } catch {
        // Best-effort: any failure here leaves the permission granted
        // but storage already says off. User can revoke manually from
        // about:addons if the inconsistency matters.
      }
    }

    showAutoSyncStatus(decision.uiMessage);
  } finally {
    autoSyncToggle.disabled = false;
    toggleInFlight = false;
  }
}

function showAutoSyncStatus(message: string | null): void {
  if (!message) {
    autoSyncStatus.hidden = true;
    autoSyncStatus.textContent = '';
    return;
  }
  autoSyncStatus.hidden = false;
  autoSyncStatus.textContent = message;
}

// --- following the tab: startup, tab events, messages ---------------

// Paint a view the panel isn't showing yet. The painters claim the
// load token themselves.
function showView(view: PanelView): void {
  switch (view.kind) {
    case 'company':
      sourceLabel.set(view.host);
      // replaceState, not push — this tracks the active tab, not a
      // navigation the user wants to reverse.
      setHistoryOrgnr(view.orgnr, view.method, false);
      void loadOrgnr(view.orgnr, view.method);
      return;
    case 'picker':
      showPicker(view.host, view.candidates);
      return;
    case 'empty':
      showEmptyState(view.host, view.degraded);
      return;
  }
}

// The view is already on screen. A company keeps its rendered result
// (no skeleton, scroll and focus stay put); only how it was reached —
// the footer host and the «Feil bedrift?» method — is refreshed. A
// picker or empty state for the same host is left alone, including a
// half-typed manual search.
function keepView(view: PanelView): void {
  if (view.kind !== 'company') return;
  sourceLabel.set(view.host);
  currentResolutionMethod = view.method;
  setHistoryOrgnr(view.orgnr, view.method, false);
  onScreen = view;
  updateRejectButtonVisibility();
  updateBackButton();
}

const follower = createPanelFollower({
  loads,
  ownUrlPrefix: browser.runtime.getURL(''),
  // tabs.query returns the active tab's url and title only when the
  // extension may read them: an activeTab grant (Firefox grants it on
  // the user action that toggles the sidebar — the sidebar icon, our
  // toolbar action, a keyboard shortcut; the context menu too) or the
  // auto-sync `tabs` opt-in. Otherwise they come back empty and the
  // panel falls back to its URL hint (panel-follow.ts § chooseStart).
  // The cascade itself is shared with the popup — lib/ui/resolve-tab.ts.
  queryActiveTab: async () => {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    return tabs[0];
  },
  getTab: (tabId) => browser.tabs.get(tabId),
  resolveTab: resolveTabContext,
  searchHost: searchByHostnameDetailed,
  onScreen: () => onScreen,
  show: showView,
  keep: keepView,
});

function init(): Promise<void> {
  // ?orgnr= / ?nomatch= is a hint from whoever opened the panel (popup
  // link, context menu), stamped with the open's time. Drop the stamp
  // from this document's URL once read, so a later reload of the panel
  // doesn't treat it as fresh.
  const hint = readPanelHint(window.location.search, Date.now());
  const url = new URL(window.location.href);
  if (url.searchParams.has('at')) {
    url.searchParams.delete('at');
    window.history.replaceState(window.history.state, '', url.toString());
  }
  return follower.start(hint);
}

// Messages from the popup (sync after it resolved the tab, no-match
// after «Ingen av disse») and the context menu. sidebarAction.setPanel
// alone does not reliably repaint an already-open sidebar in Firefox,
// so the sender tells the panel directly. runtime messages reach every
// extension page, so each names its window and the other windows'
// panels ignore it.
browser.runtime.onMessage.addListener((raw: unknown) => {
  const msg = parsePanelMessage(raw);
  if (!msg) return;
  void panelWindowId.then((windowId) => {
    if (!isForWindow(msg, windowId)) return;
    if (msg.type === 'sync') {
      follower.follow({
        kind: 'company',
        orgnr: msg.orgnr,
        method: msg.method,
        host: msg.host,
      });
      return;
    }
    void follower.probe(msg.host);
  });
});

// Browser Back / Forward within the panel — only reachable after an
// in-panel drill-in pushed an entry. Restore from history.state,
// falling back to the URL params for the initial entry (which may
// predate state stamping). Each branch paints through a function that
// claims the load token, so a slower in-flight load can't paint over
// the restored entry when it lands.
window.addEventListener('popstate', (ev) => {
  const entry = isHistoryEntry(ev.state) ? ev.state : undefined;
  const orgnr = entry?.orgnr ?? getOrgnrFromUrl();
  if (orgnr && isValidOrgnr(orgnr)) {
    sourceLabel.set(entry?.host);
    void loadOrgnr(orgnr, entry?.method ?? 'url', { focusResult: true });
    // Re-activate the tab the restored entry's URL records, so the
    // selected tab matches the ?tab= it was left on instead of keeping
    // whatever the user last clicked before navigating away. An entry
    // with no ?tab= (e.g. the initial one) restores the default tab.
    activateTabByKey(
      new URLSearchParams(window.location.search).get('tab') ?? 'oversikt',
    );
    return;
  }
  const host = getNoMatchHostFromUrl();
  if (host !== undefined) {
    void follower.probe(host);
    return;
  }
  showEmptyState(undefined);
});

function setupTabs(): void {
  const tabs = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  );
  if (tabs.length === 0) return;

  // ?tab=<key> where key is the tab id minus its "tab-" prefix
  // ('oversikt' | 'personer' | 'nokkeltall' | 'enheter').
  const tabKey = (id: string): string => id.replace(/^tab-/, '');

  function activate(id: string, opts: { persist?: boolean } = {}): void {
    for (const tab of tabs) {
      const selected = tab.id === id;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panelId = tab.getAttribute('aria-controls');
      if (panelId) {
        const panel = document.getElementById(panelId);
        if (panel) panel.hidden = !selected;
      }
    }
    if (opts.persist !== false) persistTab(id);
  }

  function persistTab(id: string): void {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tabKey(id));
    // Keep the current orgnr history entry — only the tab param moves,
    // so a drill-in still records which tab the user was reading.
    window.history.replaceState(window.history.state, '', url.toString());
  }

  // persist:false — restoring a tab (on load or via popstate) must not
  // rewrite the history entry's ?tab=, only reflect it in the UI.
  activateTabByKey = (key: string): void => {
    const match = tabs.find((t) => tabKey(t.id) === key);
    if (match) activate(match.id, { persist: false });
  };

  // Restore the deep-linked / previously-selected tab on load instead
  // of always booting Oversikt. No-op when ?tab= is absent or unknown,
  // leaving the HTML default selected.
  const wanted = new URLSearchParams(window.location.search).get('tab');
  if (wanted) activateTabByKey(wanted);

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      activate(tab.id);
      tab.focus();
    });
    tab.addEventListener('keydown', (ev) => {
      const idx = tabs.indexOf(tab);
      let nextIdx: number;
      switch (ev.key) {
        case 'ArrowRight':
          nextIdx = (idx + 1) % tabs.length;
          break;
        case 'ArrowLeft':
          nextIdx = (idx - 1 + tabs.length) % tabs.length;
          break;
        case 'Home':
          nextIdx = 0;
          break;
        case 'End':
          nextIdx = tabs.length - 1;
          break;
        default:
          return;
      }
      ev.preventDefault();
      const next = tabs[nextIdx];
      if (!next) return;
      activate(next.id);
      next.focus();
    });
  }
}

void init();
