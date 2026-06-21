// Side-effect import: aliases `globalThis.browser = chrome` on Chromium
// before any `browser.*` access. Must stay the first import.
import '../lib/platform/globals.js';
import { decideToggle } from '../lib/auto-sync-controller.js';
import { getAutoSync, setAutoSync } from '../lib/auto-sync-settings.js';
import {
  fetchEnhet,
  fetchRegnskap,
  fetchRoller,
  fetchUnderenheter,
} from '../lib/brreg.js';
import { formatRelativeTime } from '../lib/format.js';
import { searchByHostnameDetailed } from '../lib/hostname-search.js';
import { isValidOrgnr } from '../lib/mod11.js';
import { attachManualSearch } from '../lib/ui/manual-search.js';
import { createPicker, setupRejectChoice } from '../lib/ui/picker.js';
import {
  resolveTabContext,
  type ResolutionMethod,
  type TabContext,
} from '../lib/ui/resolve-tab.js';
import { createSourceLabel } from '../lib/ui/source-label.js';
import type {
  RegnskapResponse,
  RollerResponse,
  SearchHit,
  Underenhet,
} from '../types/brreg.js';
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
const brregLink = $('brreg-link') as HTMLAnchorElement;
const footerUpdated = $('footer-updated');
const updatedTime = $('updated-time') as HTMLTimeElement;
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
const resolutionActionsEl = $('resolution-actions');
const rejectChoiceBtn = $('reject-choice') as HTMLButtonElement;

let currentOrgnr: string | undefined;
let currentResolutionMethod: ResolutionMethod | undefined;
let lastUpdatedAt: number | undefined;
let updatedTimerId: number | undefined;
let loadRunId = 0;
// Re-trigger for the "Prøv igjen" button in the full error state.
let lastLoad: (() => void) | undefined;

const sourceLabel = createSourceLabel(footerSource, sourceHostEl);

const picker = createPicker({
  appEl: app,
  listEl: pickerListEl,
  noneBtn: pickerNoneBtn,
  onChoose: (_host, orgnr) => {
    setHistoryOrgnr(orgnr, 'host-pick', false);
    void loadOrgnr(orgnr, 'host-pick');
  },
  onNone: (host) => {
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

setupRejectChoice({
  buttonEl: rejectChoiceBtn,
  getContext: () => ({ host: sourceLabel.get(), orgnr: currentOrgnr }),
  showPicker,
  showEmptyState,
});

retryLoadBtn.addEventListener('click', () => {
  lastLoad?.();
});

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
  void loadOrgnr(orgnr, 'drill-in');
}

function setState(
  state: 'loading' | 'result' | 'error' | 'picker' | 'empty',
): void {
  // Leaving the picker — clear candidate state so a stray keydown
  // can't fire the picker's onChoose on a previous host's list.
  if (state !== 'picker') picker.clear();
  app.dataset.state = state;
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
  pickerEl.hidden = state !== 'picker';
  emptyStateEl.hidden = state !== 'empty';
  if (state !== 'result') {
    // The "Synket fra <host> · Oppdatert …" footer describes the
    // company on screen — hide it (and stop the 30s repaint) when no
    // company is on screen. markUpdated() re-arms both on the next
    // successful load.
    footerUpdated.hidden = true;
    if (updatedTimerId !== undefined) {
      clearInterval(updatedTimerId);
      updatedTimerId = undefined;
    }
  }
}

function showError(err: unknown): void {
  setState('error');
  const message = err instanceof Error ? err.message : String(err);
  statusEl.textContent = `Feil: ${message}`;
  // "Prøv igjen" only makes sense when there is a load to re-trigger.
  errorActionsEl.hidden = lastLoad === undefined;
}

function showEmptyState(host?: string): void {
  setState('empty');
  clearOrgnrFromUrl();
  currentOrgnr = undefined;
  sourceLabel.set(host);
  emptyMessageEl.textContent = host
    ? `Ingen bedrift identifisert på ${host}. Søk for å finne riktig bedrift.`
    : 'Sidepanelet ble åpnet uten en bedrift å vise. Søk i Brønnøysundregistrene under.';
  manualSearch.reset();
  // Focus the search box only when the sidebar window itself has
  // focus — with auto-sync on, a tab switch to an unresolvable site
  // repaints this panel in the background, and an unconditional
  // focus() would yank keyboard focus out of the page.
  if (document.hasFocus()) manualQueryEl.focus();
}

function showPicker(host: string, candidates: SearchHit[]): void {
  setState('picker');
  sourceLabel.set(host);
  // Bump loadRunId so any in-flight loadOrgnr from a previous tab
  // can't overwrite the picker when its fetches land.
  ++loadRunId;
  currentOrgnr = undefined;
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
): Promise<void> {
  // Monotonic guard — if the popup pushes a second sync while the
  // first is still in flight, the older fetches must not overwrite
  // the newer ones when they land out of order.
  const myRunId = ++loadRunId;
  currentOrgnr = orgnr;
  if (method !== undefined) currentResolutionMethod = method;
  lastLoad = () => {
    void loadOrgnr(orgnr, method);
  };

  brregLink.href = `https://virksomhet.brreg.no/nb/oppslag/enheter/${orgnr}`;

  setState('loading');
  statusEl.textContent = `Henter ${orgnr}…`;

  try {
    // Run in parallel — none of these depend on each other and the
    // user is waiting on the slowest of four.
    const [enhet, roller, underenheter, regnskap] = await Promise.all([
      fetchEnhet(orgnr),
      fetchRoller(orgnr).catch(() => ({ rollegrupper: [] }) as RollerResponse),
      fetchUnderenheter(orgnr).catch(() => [] as Underenhet[]),
      fetchRegnskap(orgnr).catch(() => ({ items: [] }) as RegnskapResponse),
    ]);
    if (myRunId !== loadRunId) return;

    renderHeader(enhet);
    renderOverview(enhet, roller);
    renderContact(enhet);
    renderRoles(roller, navigateToRelated);
    void renderParent(enhet.overordnetEnhet, navigateToRelated);
    renderUnderenheter(underenheter);
    renderNokkeltall(regnskap);
    setState('result');
    updateRejectButtonVisibility();
    markUpdated();
  } catch (err) {
    if (myRunId !== loadRunId) return;
    showError(err);
  }
}

function markUpdated(): void {
  lastUpdatedAt = Date.now();
  footerUpdated.hidden = false;
  paintUpdatedLabel();
  // Refresh the relative label every 30s so "akkurat nå" → "for 1 min siden"
  // transitions don't look stuck.
  if (updatedTimerId !== undefined) clearInterval(updatedTimerId);
  updatedTimerId = window.setInterval(paintUpdatedLabel, 30_000);
}

function paintUpdatedLabel(): void {
  if (lastUpdatedAt === undefined) return;
  updatedTime.dateTime = new Date(lastUpdatedAt).toISOString();
  updatedTime.textContent = formatRelativeTime(lastUpdatedAt);
}

// Cached effective state of the toggle. Kept in sync with
// storage + permission grant so handleToggleChange can call
// browser.permissions.request *without* an await between the
// click handler and the request — Firefox consumes the user
// activation token across the first await, and consumed activation
// makes permissions.request reject with "Firefox blokkerte
// forespørselen".
let currentAutoSyncEnabled = false;

async function setupAutoSyncToggle(): Promise<void> {
  // Reconcile UI state with reality on load. The toggle is "on" only
  // if both storage says so AND the tabs permission is currently
  // granted (the user can revoke externally via about:addons or
  // chrome://extensions). `tabs` is an optional (runtime opt-in)
  // permission in both manifests, so this flow is engine-agnostic.
  const [storedOn, hasTabs] = await Promise.all([
    getAutoSync(),
    browser.permissions.contains({ permissions: ['tabs'] }),
  ]);
  currentAutoSyncEnabled = storedOn && hasTabs;
  autoSyncToggle.checked = currentAutoSyncEnabled;
  if (storedOn && !hasTabs) {
    // Storage said on but permission was revoked externally. Reset.
    await setAutoSync(false);
  }

  autoSyncToggle.addEventListener('change', () => {
    void handleToggleChange(autoSyncToggle.checked);
  });

  // External revoke (about:addons) — flip the checkbox live and
  // clear stored state so the UI doesn't lie next reload. Sync shim
  // around the async handler so addListener gets a void-returning
  // function (same pattern as background.ts).
  browser.permissions.onRemoved.addListener(onPermissionsRemoved);
}

function onPermissionsRemoved(perms: browser.permissions.Permissions): void {
  void handlePermissionsRemoved(perms);
}

async function handlePermissionsRemoved(
  perms: browser.permissions.Permissions,
): Promise<void> {
  if (!perms.permissions?.includes('tabs')) return;
  currentAutoSyncEnabled = false;
  autoSyncToggle.checked = false;
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

    if (decision.persist) {
      await setAutoSync(decision.nextEnabled);
      currentAutoSyncEnabled = decision.nextEnabled;
    }

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

async function resolveFromActiveTab(): Promise<TabContext> {
  // tabs.query returns the active tab's url and title only when the
  // extension holds activeTab on it — which Firefox grants on the
  // user action that toggles the sidebar (clicking the sidebar
  // icon, our toolbar action, or a keyboard shortcut). When grant
  // is absent (e.g. tab switched after the sidebar was opened from
  // the Firefox View menu), url and title come back empty and we
  // silently fall back to whatever was in the URL param. The cascade
  // itself is shared with the popup — lib/ui/resolve-tab.ts.
  try {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    const tab = tabs[0];
    if (!tab) return {};
    return await resolveTabContext(tab.url ?? '', tab.title ?? '');
  } catch {
    return {};
  }
}

async function init(): Promise<void> {
  // ?nomatch=<host> means a deliberate trigger (menu, fresh sidebar
  // open) landed on a page with no resolvable orgnr. Re-probe via
  // picker-aware resolver so an ambiguous host gets the picker UI
  // instead of the bare empty state.
  const noMatchHost = getNoMatchHostFromUrl();
  if (noMatchHost !== undefined) {
    await handleNoMatchBroadcast(noMatchHost);
    return;
  }

  // Prefer the active tab over the URL param. The sidebar may have
  // been opened with a stale orgnr (e.g. last popup-click was on
  // DNB, user has since switched to VG and re-toggled the sidebar
  // panel). Trust the tab when we can read it.
  const fromTab = await resolveFromActiveTab();
  const fromUrl = getOrgnrFromUrl();
  const orgnr = fromTab.orgnr ?? fromUrl;

  if (!orgnr) {
    if (fromTab.pickerCandidates && fromTab.host) {
      showPicker(fromTab.host, fromTab.pickerCandidates);
      return;
    }
    // Neither the active tab nor the URL has a company. The sidebar
    // was opened manually (Firefox View > Sidebars) on a page brreg-snap
    // does not recognise. Show a hint, not a hard error.
    showEmptyState(fromTab.host);
    return;
  }

  sourceLabel.set(fromTab.host);
  // fromTab.orgnr was set by resolveFromActiveTab and carries a
  // method; an orgnr inherited only from ?orgnr= in the URL has no
  // tab-resolution context and is treated as 'url' so the override
  // button stays hidden (we don't know if the param originated from
  // a host-resolution). Stamp the method into the initial history
  // entry (replace, not push) so a Back from a later drill-in restores
  // it with the right override visibility.
  const method: ResolutionMethod = fromTab.orgnr
    ? fromTab.method ?? 'url'
    : 'url';
  setHistoryOrgnr(orgnr, method, false);
  await loadOrgnr(orgnr, method);
}

interface SyncMessage {
  type: 'sync';
  orgnr: string;
  host?: string;
}

interface NoMatchMessage {
  type: 'no-match';
  host?: string;
}

function isSyncMessage(msg: unknown): msg is SyncMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as { type?: unknown; orgnr?: unknown; host?: unknown };
  return (
    m.type === 'sync' &&
    typeof m.orgnr === 'string' &&
    (m.host === undefined || typeof m.host === 'string')
  );
}

function isNoMatchMessage(msg: unknown): msg is NoMatchMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as { type?: unknown; host?: unknown };
  return (
    m.type === 'no-match' &&
    (m.host === undefined || typeof m.host === 'string')
  );
}

// The popup broadcasts a 'sync' message after resolving the active
// tab's orgnr. sidebarAction.setPanel alone does not reliably repaint
// an already-open sidebar in Firefox, so we listen here and repaint
// ourselves. history.replaceState keeps the URL in sync without a
// full document reload (which would flicker and reset scroll).
// 'no-match' is the counterpart: a deliberate trigger (menu, tab
// switch with auto-sync on) landed on a page brreg-snap can't resolve
// — we clear the sidebar instead of leaving stale company data up.
browser.runtime.onMessage.addListener((msg: unknown) => {
  if (isNoMatchMessage(msg)) {
    // Bump loadRunId so any in-flight loadOrgnr from a previous sync
    // doesn't overwrite the picker / empty state when it lands.
    ++loadRunId;
    void handleNoMatchBroadcast(msg.host);
    return;
  }
  if (!isSyncMessage(msg)) return;
  if (!isValidOrgnr(msg.orgnr)) return;
  sourceLabel.set(msg.host);
  // Sync messages from the popup don't carry the original resolution
  // method. Hide the override button rather than risk exposing it on a
  // URL-derived pick the user can't actually override. replaceState
  // (not push) — this tracks the active tab, not a reversible nav.
  setHistoryOrgnr(msg.orgnr, 'sync-broadcast', false);
  void loadOrgnr(msg.orgnr, 'sync-broadcast');
});

// Browser Back / Forward within the panel — only reachable after an
// in-panel drill-in pushed an entry. Restore from history.state,
// falling back to the URL params for the initial entry (which may
// predate state stamping). Bump loadRunId first so a slower in-flight
// load can't paint over the restored entry when it lands.
window.addEventListener('popstate', (ev) => {
  ++loadRunId;
  const entry = isHistoryEntry(ev.state) ? ev.state : undefined;
  const orgnr = entry?.orgnr ?? getOrgnrFromUrl();
  if (orgnr && isValidOrgnr(orgnr)) {
    sourceLabel.set(entry?.host);
    void loadOrgnr(orgnr, entry?.method ?? 'url');
    return;
  }
  const host = getNoMatchHostFromUrl();
  if (host !== undefined) {
    void handleNoMatchBroadcast(host);
    return;
  }
  showEmptyState(undefined);
});

async function handleNoMatchBroadcast(
  host: string | undefined,
): Promise<void> {
  // Background broadcasts no-match when the sync cascade (and the
  // AUTO band of hostname-search) couldn't resolve. Re-run the
  // picker-aware resolver here — cache hits make this nearly free,
  // and it surfaces the picker for ambiguous sites instead of the
  // bare empty state.
  if (!host) {
    showEmptyState(undefined);
    return;
  }
  const detailed = await searchByHostnameDetailed(host);
  if (detailed?.band === 'picker') {
    showPicker(host, detailed.candidates);
    return;
  }
  if (detailed?.band === 'auto' && detailed.choice) {
    sourceLabel.set(host);
    const method: ResolutionMethod =
      detailed.candidates.length === 0 ? 'host-pick' : 'host-auto';
    setHistoryOrgnr(detailed.choice, method, false);
    await loadOrgnr(detailed.choice, method);
    return;
  }
  showEmptyState(host);
}

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

  // Restore the deep-linked / previously-selected tab on load instead
  // of always booting Oversikt. No-op (and no persist) when ?tab= is
  // absent or unknown, leaving the HTML default selected.
  const wanted = new URLSearchParams(window.location.search).get('tab');
  if (wanted) {
    const match = tabs.find((t) => tabKey(t.id) === wanted);
    if (match) activate(match.id, { persist: false });
  }

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
