// Side-effect import: aliases `globalThis.browser = chrome` on Chromium
// before any `browser.*` access. Must stay the first import.
import '../lib/platform/globals.js';
import { isFirefox } from '../lib/platform/engine.js';
import { decideToggle } from '../lib/auto-sync-controller.js';
import { getAutoSync, setAutoSync } from '../lib/auto-sync-settings.js';
import {
  fetchEnhet,
  fetchRegnskap,
  fetchRoller,
  fetchUnderenheter,
  invalidateCache,
  searchEnheter,
} from '../lib/brreg.js';
import { formatRelativeTime } from '../lib/format.js';
import {
  addRejectedChoice,
  MAX_PICKER_CANDIDATES,
  searchByHostnameDetailed,
  setPickerChoice,
} from '../lib/hostname-search.js';
import { isValidOrgnr } from '../lib/mod11.js';
import { resolveOrgnr } from '../lib/orgnr.js';
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
const skeletonEl = $('skeleton');
const resultEl = $('result');
const brregLink = $('brreg-link') as HTMLAnchorElement;
const footerUpdated = $('footer-updated');
const updatedTime = $('updated-time') as HTMLTimeElement;
const refreshBtn = $('refresh-btn') as HTMLButtonElement;
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
let currentSourceHost: string | undefined;
// Picker state held at module scope so the document-level keydown
// handler can look up which candidate maps to keys 1-4 without
// re-reading the DOM.
let currentPickerHost: string | undefined;
let currentPickerCandidates: SearchHit[] = [];
// Why the current orgnr is on screen. Only host-resolved orgnrs are
// overridable via the "Feil bedrift?" button — URL-derived orgnrs
// (regex hit in path or title) are authoritative for their domain.
type ResolutionMethod =
  | 'host-auto'
  | 'host-pick'
  | 'url'
  | 'manual'
  | 'sync-broadcast';
let currentResolutionMethod: ResolutionMethod | undefined;
let lastUpdatedAt: number | undefined;
let updatedTimerId: number | undefined;

setupTabs();
setupRefresh();
setupManualSearch();
setupRejectChoice();
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

function setState(
  state: 'loading' | 'result' | 'error' | 'picker' | 'empty',
): void {
  // Leaving the picker — clear candidate state so a stray keydown
  // can't fire handlePickerChoice on a previous host's list.
  if (state !== 'picker') {
    currentPickerHost = undefined;
    currentPickerCandidates = [];
  }
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
  resultEl.hidden = state !== 'result';
  pickerEl.hidden = state !== 'picker';
  emptyStateEl.hidden = state !== 'empty';
}

function showError(err: unknown): void {
  setState('error');
  const message = err instanceof Error ? err.message : String(err);
  statusEl.textContent = `Feil: ${message}`;
}

function showEmptyState(host?: string): void {
  setState('empty');
  // Clear any orgnr left in the URL so a panel reload doesn't re-fetch
  // the stale company.
  const url = new URL(window.location.href);
  url.searchParams.delete('orgnr');
  window.history.replaceState(null, '', url.toString());
  currentOrgnr = undefined;
  setSourceHost(host);
  emptyMessageEl.textContent = host
    ? `Ingen bedrift identifisert på ${host}. Søk for å finne riktig bedrift.`
    : 'Sidepanelet ble åpnet uten en bedrift å vise. Søk i Brønnøysundregistrene under.';
  resetManualSearch();
  // Focus only when the panel is actually visible — focusing a hidden
  // input is a no-op and steals the cursor needlessly otherwise.
  manualQueryEl.focus();
}

function resetManualSearch(): void {
  manualQueryEl.value = '';
  manualResultsEl.innerHTML = '';
  manualSearchRunId += 1;
  if (manualSearchTimer) {
    clearTimeout(manualSearchTimer);
    manualSearchTimer = undefined;
  }
}

function showPicker(host: string, candidates: SearchHit[]): void {
  currentPickerHost = host;
  currentPickerCandidates = candidates.slice(0, MAX_PICKER_CANDIDATES);
  setState('picker');
  setSourceHost(host);
  // Bump loadRunId so any in-flight loadOrgnr from a previous tab
  // can't overwrite the picker when its fetches land.
  ++loadRunId;
  currentOrgnr = undefined;
  // Clear any orgnr in the URL so a panel reload doesn't re-fetch.
  const url = new URL(window.location.href);
  url.searchParams.delete('orgnr');
  window.history.replaceState(null, '', url.toString());

  pickerListEl.replaceChildren();
  for (const cand of currentPickerCandidates) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'picker-item';
    btn.addEventListener('click', () => {
      void handlePickerChoice(host, cand.organisasjonsnummer);
    });

    const name = document.createElement('span');
    name.className = 'picker-item-name';
    name.textContent = cand.navn;
    btn.appendChild(name);

    // Næring disambiguates rows that share a name root — "VG CONSULT",
    // "VG BYGG", "VGTV" all start with VG but the industry tells the
    // user which is the media house. Optional field, skip silently when
    // brreg has no NACE on record.
    const naering = cand.naeringskode1?.beskrivelse;
    if (naering) {
      const naeringEl = document.createElement('span');
      naeringEl.className = 'picker-item-naering';
      naeringEl.textContent = naering;
      btn.appendChild(naeringEl);
    }

    const meta = document.createElement('span');
    meta.className = 'picker-item-meta';
    const ansatte = cand.antallAnsatte;
    const ansatteLabel =
      typeof ansatte === 'number' && ansatte > 0
        ? `, ${ansatte} ansatte`
        : '';
    meta.textContent = `${cand.organisasjonsnummer}${ansatteLabel}`;
    btn.appendChild(meta);

    li.appendChild(btn);
    pickerListEl.appendChild(li);
  }
}

async function handlePickerChoice(
  host: string,
  orgnr: string,
): Promise<void> {
  await setPickerChoice(host, orgnr);
  const url = new URL(window.location.href);
  url.searchParams.set('orgnr', orgnr);
  window.history.replaceState(null, '', url.toString());
  await loadOrgnr(orgnr, 'host-pick');
}

async function handlePickerNone(host: string): Promise<void> {
  await setPickerChoice(host, null);
  showEmptyState(host);
}

pickerNoneBtn.addEventListener('click', () => {
  if (!currentSourceHost) return;
  void handlePickerNone(currentSourceHost);
});

function setupRejectChoice(): void {
  rejectChoiceBtn.addEventListener('click', () => {
    if (rejectChoiceBtn.disabled) return;
    void handleRejectChoice();
  });
}

async function handleRejectChoice(): Promise<void> {
  const host = currentSourceHost;
  const orgnr = currentOrgnr;
  if (!host || !orgnr) return;
  rejectChoiceBtn.disabled = true;
  try {
    await addRejectedChoice(host, orgnr);
    const detailed = await searchByHostnameDetailed(host);
    if (detailed && detailed.candidates.length > 0) {
      // Always show picker (even if a single candidate now wins
      // band='auto') — the user just expressed doubt; let them confirm.
      showPicker(host, detailed.candidates);
      return;
    }
    showEmptyState(host);
  } finally {
    rejectChoiceBtn.disabled = false;
  }
}

function updateRejectButtonVisibility(): void {
  const overridable =
    currentResolutionMethod === 'host-auto' ||
    currentResolutionMethod === 'host-pick';
  resolutionActionsEl.hidden = !(overridable && currentSourceHost);
}

// Manual search inside the empty state. Mirrors popup's runSearch:
// 250ms debounce, monotonic runId so out-of-order responses drop, min
// 2 chars, capped to 100 before reaching brreg.
let manualSearchTimer: ReturnType<typeof setTimeout> | undefined;
let manualSearchRunId = 0;

function setupManualSearch(): void {
  manualQueryEl.addEventListener('input', () => {
    if (manualSearchTimer) clearTimeout(manualSearchTimer);
    manualSearchRunId += 1;
    const value = manualQueryEl.value.trim();
    if (value.length < 2) {
      manualResultsEl.innerHTML = '';
      return;
    }
    const capped = value.slice(0, 100);
    manualSearchTimer = setTimeout(() => {
      void runManualSearch(capped);
    }, 250);
  });
}

async function runManualSearch(query: string): Promise<void> {
  const myRunId = ++manualSearchRunId;
  try {
    const results = await searchEnheter(query, 10);
    if (myRunId !== manualSearchRunId) return;
    manualResultsEl.innerHTML = '';
    if (results.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty-result';
      li.textContent = 'Ingen treff.';
      manualResultsEl.appendChild(li);
      return;
    }
    for (const item of results) {
      const li = document.createElement('li');
      li.tabIndex = 0;

      const name = document.createElement('span');
      name.className = 'picker-item-name';
      name.textContent = item.navn;
      li.appendChild(name);

      const naering = item.naeringskode1?.beskrivelse;
      if (naering) {
        const naeringEl = document.createElement('span');
        naeringEl.className = 'picker-item-naering';
        naeringEl.textContent = naering;
        li.appendChild(naeringEl);
      }

      const meta = document.createElement('span');
      meta.className = 'picker-item-meta';
      meta.textContent = item.organisasjonsnummer;
      li.appendChild(meta);

      const select = (): void => {
        const url = new URL(window.location.href);
        url.searchParams.set('orgnr', item.organisasjonsnummer);
        window.history.replaceState(null, '', url.toString());
        void loadOrgnr(item.organisasjonsnummer, 'manual');
      };
      li.addEventListener('click', select);
      li.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') select();
      });
      manualResultsEl.appendChild(li);
    }
  } catch (err) {
    if (myRunId !== manualSearchRunId) return;
    showError(err);
  }
}

let loadRunId = 0;

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
    renderRoles(roller);
    void renderParent(enhet.overordnetEnhet);
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

function setupRefresh(): void {
  refreshBtn.addEventListener('click', () => {
    if (refreshBtn.disabled) return;
    // currentOrgnr may be empty if the sidebar opened on an
    // unrecognised page. doRefresh will try the active tab if
    // tabs is granted; otherwise it's a no-op when there's nothing
    // to re-fetch.
    void doRefresh(currentOrgnr ?? '');
  });
}

// Refresh spin: three-phase rotation via Web Animations API.
// CSS-only `animation: spin linear infinite` couldn't ease in or out
// without a visible seam at the loop boundary. With WAAPI we run an
// ease-out intro (one rotation, slow start), a perfect linear loop
// while data is in flight, and an ease-in outro that settles at the
// next 360°-multiple — so the icon always lands neutral.
let spinState: 'idle' | 'intro' | 'loop' | 'outro' = 'idle';
let spinAnim: Animation | undefined;

function refreshSvgEl(): SVGElement | null {
  return refreshBtn.querySelector('svg');
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function readRotation(svg: SVGElement): number {
  // getComputedStyle returns "matrix(a, b, ...)" while a WAAPI rotate
  // animation is active. atan2(b, a) recovers the angle in radians.
  try {
    const tr = window.getComputedStyle(svg).transform;
    if (!tr || tr === 'none') return 0;
    const m = new DOMMatrixReadOnly(tr);
    const deg = (Math.atan2(m.b, m.a) * 180) / Math.PI;
    return ((deg % 360) + 360) % 360;
  } catch {
    return 0;
  }
}

async function startRefreshSpin(): Promise<void> {
  if (spinState !== 'idle') return;
  if (prefersReducedMotion()) return;
  const svg = refreshSvgEl();
  if (!svg) return;
  spinState = 'intro';
  const intro = svg.animate(
    [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
    {
      duration: 320,
      iterations: 1,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    },
  );
  spinAnim = intro;
  try {
    await intro.finished;
  } catch {
    return;
  }
  if (spinState !== 'intro') return;
  spinState = 'loop';
  spinAnim = svg.animate(
    [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
    { duration: 800, iterations: Infinity, easing: 'linear' },
  );
}

async function stopRefreshSpin(): Promise<void> {
  if (spinState === 'idle') return;
  const svg = refreshSvgEl();
  if (!svg) {
    spinState = 'idle';
    spinAnim = undefined;
    return;
  }
  const startAngle = readRotation(svg);
  spinState = 'outro';
  if (spinAnim) {
    spinAnim.cancel();
    spinAnim = undefined;
  }
  const outro = svg.animate(
    [
      { transform: `rotate(${startAngle}deg)` },
      { transform: `rotate(${startAngle + (360 - startAngle)}deg)` },
    ],
    {
      duration: 380,
      iterations: 1,
      easing: 'cubic-bezier(0.33, 1, 0.68, 1)',
    },
  );
  spinAnim = outro;
  try {
    await outro.finished;
  } catch {
    // ignored
  }
  spinAnim = undefined;
  spinState = 'idle';
}

async function doRefresh(currentOrgnrArg: string): Promise<void> {
  refreshBtn.disabled = true;
  refreshBtn.setAttribute('aria-busy', 'true');
  void startRefreshSpin();
  // Snapshot loadRunId so any path that bumps it during one of our
  // awaits (sync broadcast from popup, no-match broadcast, picker
  // path) wins over the refresh. Without this guard, refresh's
  // terminal loadOrgnr/showPicker/showEmptyState would overwrite a
  // newer state that landed concurrently.
  const startRunId = loadRunId;
  try {
    const hasTabs = await browser.permissions.contains({
      permissions: ['tabs'],
    });
    if (loadRunId !== startRunId) return;
    if (hasTabs) {
      const fromTab = await resolveFromActiveTab();
      if (loadRunId !== startRunId) return;
      if (fromTab.orgnr) {
        setSourceHost(fromTab.host);
        const url = new URL(window.location.href);
        url.searchParams.set('orgnr', fromTab.orgnr);
        window.history.replaceState(null, '', url.toString());
        await invalidateCache(fromTab.orgnr);
        if (loadRunId !== startRunId) return;
        await loadOrgnr(fromTab.orgnr, fromTab.method);
        return;
      }
      if (fromTab.pickerCandidates && fromTab.host) {
        showPicker(fromTab.host, fromTab.pickerCandidates);
        return;
      }
      if (fromTab.host) {
        showEmptyState(fromTab.host);
        return;
      }
    }
    if (!currentOrgnrArg) return;
    await invalidateCache(currentOrgnrArg);
    if (loadRunId !== startRunId) return;
    // Refresh of an existing orgnr — keep its current resolution
    // method so the override button remains visible/hidden as before.
    await loadOrgnr(currentOrgnrArg, currentResolutionMethod);
  } finally {
    // Outro phase (~380ms) gives the spin a visible wind-down even
    // on cache hits — no separate min-hold needed.
    await stopRefreshSpin();
    refreshBtn.disabled = false;
    refreshBtn.removeAttribute('aria-busy');
  }
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
  if (!isFirefox) {
    // Auto-sync (the `tabs` opt-in) is Firefox-only for now — the Chrome
    // side-panel permission-grant gesture path is deferred to a
    // post-launch update (docs/chrome-port.md Phase 6). Hide the toggle
    // so the Chrome MVP doesn't surface an inactive control, and skip
    // the permission probe (`tabs` isn't declared in the Chrome
    // manifest).
    const toggleLabel = autoSyncToggle.closest<HTMLElement>('.toggle');
    if (toggleLabel) toggleLabel.style.display = 'none';
    return;
  }
  // Reconcile UI state with reality on load. The toggle is "on" only
  // if both storage says so AND the tabs permission is currently
  // granted (the user can revoke externally via about:addons).
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
  // can contradict what the user last clicked. Same shape as the
  // refresh button's disabled-flip in doRefresh.
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

function setSourceHost(host: string | undefined): void {
  currentSourceHost = host;
  paintSourceLabel();
}

function paintSourceLabel(): void {
  if (!currentSourceHost) {
    footerSource.hidden = true;
    sourceHostEl.textContent = '';
    return;
  }
  footerSource.hidden = false;
  sourceHostEl.textContent = currentSourceHost;
}

interface TabContext {
  orgnr?: string;
  host?: string;
  pickerCandidates?: SearchHit[];
  // Why we landed on this orgnr — drives whether the "Feil bedrift?"
  // override is offered. Sync (URL/title regex) is authoritative;
  // host-auto is the only one the user can dispute via this code path.
  method?: ResolutionMethod;
}

async function resolveFromActiveTab(): Promise<TabContext> {
  // tabs.query returns the active tab's url and title only when the
  // extension holds activeTab on it — which Firefox grants on the
  // user action that toggles the sidebar (clicking the sidebar
  // icon, our toolbar action, or a keyboard shortcut). When grant
  // is absent (e.g. tab switched after the sidebar was opened from
  // the Firefox View menu), url and title come back empty and we
  // silently fall back to whatever was in the URL param.
  try {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    const tab = tabs[0];
    if (!tab) return {};
    const url = tab.url ?? '';
    const title = tab.title ?? '';
    if (!url && !title) return {};
    let host: string | undefined;
    if (url) {
      try {
        host = new URL(url).hostname;
      } catch {
        /* invalid url — leave host undefined */
      }
    }
    // Sync cascade first — fast, no network. Covers URL and title
    // regex only.
    const sync = resolveOrgnr({ url, title });
    if (sync) return { orgnr: sync, host, method: 'url' };
    if (!host) return { host };
    // Sync miss → hostname-based brreg search with band awareness.
    const detailed = await searchByHostnameDetailed(host);
    if (!detailed) return { host };
    if (detailed.band === 'auto') {
      // detailed.choice may have been written by an earlier picker
      // pick (positive picker-choice short-circuit) — both deserve
      // the override button, so distinguish via candidates.
      const method: ResolutionMethod =
        detailed.candidates.length === 0 ? 'host-pick' : 'host-auto';
      return { orgnr: detailed.choice, host, method };
    }
    if (detailed.band === 'picker') {
      return { host, pickerCandidates: detailed.candidates };
    }
    return { host };
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

  if (fromTab.orgnr && fromTab.orgnr !== fromUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set('orgnr', fromTab.orgnr);
    window.history.replaceState(null, '', url.toString());
  }
  setSourceHost(fromTab.host);
  // fromTab.orgnr was set by resolveFromActiveTab and carries a
  // method; an orgnr inherited only from ?orgnr= in the URL has no
  // tab-resolution context and is treated as 'url' so the override
  // button stays hidden (we don't know if the param originated from
  // a host-resolution).
  await loadOrgnr(orgnr, fromTab.orgnr ? fromTab.method : 'url');
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
  setSourceHost(msg.host);
  const url = new URL(window.location.href);
  url.searchParams.set('orgnr', msg.orgnr);
  window.history.replaceState(null, '', url.toString());
  // Sync messages from the popup don't carry the original
  // resolution method. Hide the override button rather than risk
  // exposing it on a URL-derived pick the user can't actually
  // override.
  void loadOrgnr(msg.orgnr, 'sync-broadcast');
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
    setSourceHost(host);
    const url = new URL(window.location.href);
    url.searchParams.set('orgnr', detailed.choice);
    window.history.replaceState(null, '', url.toString());
    const method: ResolutionMethod =
      detailed.candidates.length === 0 ? 'host-pick' : 'host-auto';
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

  function activate(id: string): void {
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
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      activate(tab.id);
      tab.focus();
    });
    tab.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
      ev.preventDefault();
      const idx = tabs.indexOf(tab);
      const nextIdx =
        ev.key === 'ArrowRight'
          ? (idx + 1) % tabs.length
          : (idx - 1 + tabs.length) % tabs.length;
      const next = tabs[nextIdx];
      if (!next) return;
      activate(next.id);
      next.focus();
    });
  }
}

// Keyboard shortcuts when the picker is active: digits 1-4 pick the
// corresponding row, 0 or Escape triggers "Ingen av disse". Bail when
// the picker isn't visible or when the user is typing into a form
// control (manual-search input is in a different state, but defensive
// against future additions). Modifier keys also bail so OS shortcuts
// (cmd+w, ctrl+a) keep working.
document.addEventListener('keydown', (ev) => {
  if (app.dataset.state !== 'picker') return;
  if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
  const target = ev.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return;
  }
  const host = currentPickerHost;
  if (!host) return;
  if (ev.key === '0' || ev.key === 'Escape') {
    ev.preventDefault();
    void handlePickerNone(host);
    return;
  }
  const idx = '1234'.indexOf(ev.key);
  if (idx === -1) return;
  const cand = currentPickerCandidates[idx];
  if (!cand) return;
  ev.preventDefault();
  void handlePickerChoice(host, cand.organisasjonsnummer);
});

void init();
