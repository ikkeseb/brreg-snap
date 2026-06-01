// Side-effect import: aliases `globalThis.browser = chrome` on Chromium
// before any `browser.*` access. Must stay the first import.
import '../lib/platform/globals.js';
import { sidebar } from '../lib/platform/sidebar.js';
import { fetchEnhet, fetchRoller, searchEnheter } from '../lib/brreg.js';
import { renderOrgnrCopy } from '../lib/copy-orgnr.js';
import { formatAddress } from '../lib/format.js';
import {
  addRejectedChoice,
  MAX_PICKER_CANDIDATES,
  searchByHostnameDetailed,
  setPickerChoice,
} from '../lib/hostname-search.js';
import { resolveOrgnr } from '../lib/orgnr.js';
import { findDagligLeder } from '../lib/roller.js';
import type { Enhet, RollerResponse, SearchHit } from '../types/brreg.js';
import { getRecent, pushRecent } from './recent.js';

const app = document.getElementById('app') as HTMLElement;
const brandMark = document.getElementById('brand-mark') as HTMLImageElement;
brandMark.src = browser.runtime.getURL('icons/icon-32.png');
const statusEl = document.getElementById('status') as HTMLElement;
const resultEl = document.getElementById('result') as HTMLElement;
const resolutionActionsEl = document.getElementById(
  'resolution-actions',
) as HTMLElement;
const rejectChoiceBtn = document.getElementById(
  'reject-choice',
) as HTMLButtonElement;
const pickerEl = document.getElementById('picker') as HTMLElement;
const pickerListEl = document.getElementById('picker-list') as HTMLUListElement;
const pickerNoneBtn = document.getElementById(
  'picker-none',
) as HTMLButtonElement;
const emptyStateEl = document.getElementById('empty-state') as HTMLElement;
const emptyMessageEl = document.getElementById('empty-message') as HTMLElement;
const manualQueryEl = document.getElementById(
  'manual-query',
) as HTMLInputElement;
const manualResultsEl = document.getElementById(
  'manual-results',
) as HTMLUListElement;
const recentSectionEl = document.getElementById(
  'recent-section',
) as HTMLElement;
const recentListEl = document.getElementById('recent-list') as HTMLUListElement;
const brregLink = document.getElementById('brreg-link') as HTMLAnchorElement;
const detailsLink = document.getElementById('details-link') as HTMLAnchorElement;
const footerSourceEl = document.getElementById('footer-source') as HTMLElement;
const sourceHostEl = document.getElementById('source-host') as HTMLElement;

const BRREG_LINK_FALLBACK =
  'https://virksomhet.brreg.no/nb/oppslag/enheter';

// Why the current orgnr is on screen. Only host-resolved orgnrs are
// overridable via the "Feil treff?" button — URL-derived orgnrs
// (regex hit in path or title) are authoritative for their domain.
type ResolutionMethod =
  | 'host-auto'
  | 'host-pick'
  | 'url'
  | 'manual';

let currentOrgnr: string | undefined;
let currentSourceHost: string | undefined;
let currentResolutionMethod: ResolutionMethod | undefined;
// Active tab/window ids captured during resolution so the "open in
// side panel" click can pass them to sidebar.open() synchronously —
// Chrome's sidePanel.open needs a windowId/tabId and can't await a
// tabs.query inside the gesture. Unused by the Firefox adapter.
let currentWindowId: number | undefined;
let currentTabId: number | undefined;
// Picker state held at module scope so the document-level keydown
// handler can look up which candidate maps to keys 1-4 without
// re-reading the DOM.
let currentPickerHost: string | undefined;
let currentPickerCandidates: SearchHit[] = [];

function setBrregLink(orgnr?: string): void {
  brregLink.href = orgnr
    ? `https://virksomhet.brreg.no/nb/oppslag/enheter/${orgnr}`
    : BRREG_LINK_FALLBACK;
}

function setDetailsLink(): void {
  // Visible in every state where the sidebar can do something useful:
  // resolved orgnr → ?orgnr=, or host-without-pick → ?nomatch= so the
  // sidebar opens on the picker/empty surface for the same host
  // instead of stale state. Only hidden when we have neither — popup
  // opened on about:blank or an unresolvable URL.
  let relPath: string | undefined;
  if (currentOrgnr) {
    relPath = `details/details.html?orgnr=${currentOrgnr}`;
  } else if (currentSourceHost) {
    relPath = `details/details.html?nomatch=${encodeURIComponent(currentSourceHost)}`;
  }
  if (!relPath) {
    detailsLink.hidden = true;
    detailsLink.removeAttribute('href');
    detailsLink.onclick = null;
    return;
  }
  const path = relPath;
  detailsLink.hidden = false;
  // Keep href so middle-click and keyboard activation still open the
  // details page somewhere. The onclick docks it into the browser's
  // sidebar / side panel instead of stealing focus into a new tab or
  // popup window.
  detailsLink.href = browser.runtime.getURL(path);
  detailsLink.onclick = (ev) => {
    ev.preventDefault();
    // setPanel + open must both fire inside this click's gesture stack.
    // No await before open() — both engines consume the activation
    // token on the first await, and Chrome's sidePanel.open hard-
    // requires a live gesture. open() picks up the panel path setPanel
    // just queued.
    sidebar.setPanel(path);
    sidebar.open({ windowId: currentWindowId, tabId: currentTabId });
    window.close();
  };
}

function paintSourceLabel(): void {
  if (!currentSourceHost) {
    footerSourceEl.hidden = true;
    sourceHostEl.textContent = '';
    return;
  }
  footerSourceEl.hidden = false;
  sourceHostEl.textContent = currentSourceHost;
}

function updateRejectButtonVisibility(): void {
  // Only host-resolved orgnrs are disputable. URL-derived orgnrs are
  // authoritative for their domain; manual picks are the user's own
  // explicit choice and not subject to the "Feil treff?" reframe.
  const overridable =
    app.dataset.state === 'result' &&
    (currentResolutionMethod === 'host-auto' ||
      currentResolutionMethod === 'host-pick') &&
    currentSourceHost !== undefined &&
    currentOrgnr !== undefined;
  resolutionActionsEl.hidden = !overridable;
}

interface TabContext {
  orgnr?: string;
  host?: string;
  pickerCandidates?: SearchHit[];
  // Why we landed on this orgnr — drives whether the "Feil treff?"
  // override is offered. Sync (URL/title regex) is authoritative;
  // host-auto is the only one the user can dispute via this code path.
  method?: ResolutionMethod;
}

async function getActiveTab(): Promise<browser.tabs.Tab | undefined> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  // Capture for the gesture-bound side-panel open (Chrome). Harmless on
  // Firefox, whose adapter ignores the target.
  currentWindowId = tab?.windowId;
  currentTabId = tab?.id;
  return tab;
}

async function resolveFromActiveTab(): Promise<TabContext> {
  // Same band-aware cascade as the sidebar's resolveFromActiveTab —
  // sync regex first (URL/title), then a picker-aware hostname search
  // that tells us whether to auto-resolve, show the picker, or fall
  // through to the empty/manual-search state.
  const tab = await getActiveTab();
  const url = tab?.url ?? '';
  const title = tab?.title ?? '';
  let host: string | undefined;
  if (url) {
    try {
      host = new URL(url).hostname;
    } catch {
      /* invalid url — leave host undefined */
    }
  }
  const sync = resolveOrgnr({ url, title });
  if (sync) return { orgnr: sync, host, method: 'url' };
  if (!host) return {};
  const detailed = await searchByHostnameDetailed(host);
  if (!detailed) return { host };
  if (detailed.band === 'auto') {
    // detailed.choice may have been written by an earlier picker pick
    // (positive picker-choice short-circuit) — both deserve the
    // override button, so distinguish via candidates.
    const method: ResolutionMethod =
      detailed.candidates.length === 0 ? 'host-pick' : 'host-auto';
    return { orgnr: detailed.choice, host, method };
  }
  if (detailed.band === 'picker') {
    return { host, pickerCandidates: detailed.candidates };
  }
  return { host };
}

async function init(): Promise<void> {
  try {
    const ctx = await resolveFromActiveTab();
    currentSourceHost = ctx.host;
    paintSourceLabel();
    if (ctx.orgnr) {
      await loadAndRender(ctx.orgnr, ctx.method);
      return;
    }
    if (ctx.pickerCandidates && ctx.host) {
      showPicker(ctx.host, ctx.pickerCandidates);
      return;
    }
    showEmptyState(ctx.host);
  } catch (err) {
    showError(err);
  }
}

async function syncSidebarIfOpen(orgnr: string): Promise<void> {
  // The popup runs with activeTab grant on the current tab — it can
  // read the URL and resolve the orgnr. The sidebar, opened earlier
  // on a different tab, holds stale data until something tells it
  // to repaint.
  //
  // Two parallel mechanisms:
  //   1. setPanel updates the sidebar's panel URL so the next open
  //      (from the View > Sidebars menu) lands on this orgnr.
  //   2. runtime.sendMessage broadcasts a 'sync' notification that
  //      the open details page picks up and uses to re-render in
  //      place — this is what actually repaints the visible sidebar.
  //      setPanel alone is not enough; Firefox doesn't reliably
  //      repaint an open sidebar when its panel URL changes.
  //
  // Fire-and-forget — popup rendering shouldn't block on this, and
  // both calls survive the popup closing.
  try {
    if (!(await sidebar.isOpen())) return;
  } catch {
    // Sidebar API unavailable / errored — the popup itself still
    // rendered; nothing more to do.
    return;
  }
  sidebar.setPanel(`details/details.html?orgnr=${orgnr}`);
  try {
    await browser.runtime.sendMessage({
      type: 'sync',
      orgnr,
      host: currentSourceHost,
    });
  } catch {
    // No listener (sidebar closed) — sendMessage rejects; expected.
  }
}

async function syncSidebarNoMatch(host: string | undefined): Promise<void> {
  // Counterpart to syncSidebarIfOpen for the "Ingen av disse" path —
  // tells an open sidebar that this host has no current pick so it
  // can clear stale company data instead of keeping the previous
  // picker / result up. setPanel resets the panel URL so a fresh
  // open lands on the empty state, not the prior orgnr.
  try {
    if (!(await sidebar.isOpen())) return;
  } catch {
    return; /* silent — popup still rendered */
  }
  sidebar.setPanel(
    host
      ? `details/details.html?nomatch=${encodeURIComponent(host)}`
      : 'details/details.html',
  );
  try {
    await browser.runtime.sendMessage({ type: 'no-match', host });
  } catch {
    // No listener (sidebar closed) — expected.
  }
}

async function loadAndRender(
  orgnr: string,
  method?: ResolutionMethod,
): Promise<void> {
  currentOrgnr = orgnr;
  if (method !== undefined) currentResolutionMethod = method;
  setState('loading');
  statusEl.textContent = `Henter ${orgnr}…`;
  setBrregLink(orgnr);
  setDetailsLink();
  void syncSidebarIfOpen(orgnr);
  try {
    // Roller is a second API call but it lives behind the same 24h
    // session cache, and we want daglig leder visible in the quick
    // glance — not just in the sidebar details view.
    const [enhet, roller] = await Promise.all([
      fetchEnhet(orgnr),
      fetchRoller(orgnr).catch(
        () => ({ rollegrupper: [] }) as RollerResponse,
      ),
    ]);
    renderEnhet(enhet, roller);
  } catch (err) {
    showError(err);
  }
}

function renderEnhet(enhet: Enhet, roller: RollerResponse): void {
  setState('result');
  resultEl.replaceChildren();

  // Stamp the recent stack as soon as we have a confirmed Enhet — earlier
  // than this we don't know the navn, later (in init or loadAndRender)
  // would also persist orgnrs that failed to fetch.
  void pushRecent(enhet.organisasjonsnummer, enhet.navn);

  const heading = document.createElement('h2');
  heading.textContent = enhet.navn;
  resultEl.appendChild(heading);

  const orgnrEl = document.createElement('div');
  orgnrEl.className = 'orgnr';
  renderOrgnrCopy(orgnrEl, enhet.organisasjonsnummer);
  resultEl.appendChild(orgnrEl);

  const dl = document.createElement('dl');
  addRow(dl, 'Form', enhet.organisasjonsform?.beskrivelse);
  addRow(dl, 'Registrert', enhet.registreringsdatoEnhetsregisteret);
  addRow(dl, 'Næring', enhet.naeringskode1?.beskrivelse);
  addRow(dl, 'Ansatte', enhet.antallAnsatte?.toString());
  // Always render daglig leder, even when missing, so the user sees we
  // looked — empty fallback distinguishes "no role registered" from
  // "we forgot to check". Other rows can legitimately be missing on
  // certain forms (ENK has no Form-suffix, foreign entities lack næring).
  addRow(dl, 'Daglig leder', findDagligLeder(roller) ?? '—');
  addRow(dl, 'Adresse', formatAddress(enhet.forretningsadresse));
  if (enhet.hjemmeside) {
    const href = enhet.hjemmeside.startsWith('http')
      ? enhet.hjemmeside
      : `https://${enhet.hjemmeside}`;
    addLink(dl, 'Hjemmeside', href, enhet.hjemmeside);
  }
  resultEl.appendChild(dl);

  const flags = document.createElement('div');
  flags.className = 'flags';
  const negativeStatus =
    enhet.konkurs ||
    enhet.underAvvikling ||
    enhet.underTvangsavviklingEllerTvangsopplosning;
  if (!negativeStatus) flags.appendChild(makeFlag('Aktiv', 'ok'));
  if (enhet.konkurs) flags.appendChild(makeFlag('Konkurs', 'danger'));
  if (enhet.underAvvikling) flags.appendChild(makeFlag('Under avvikling', 'warn'));
  if (enhet.underTvangsavviklingEllerTvangsopplosning)
    flags.appendChild(makeFlag('Tvangsavvikling', 'danger'));
  if (enhet.registrertIMvaregisteret) flags.appendChild(makeFlag('MVA-registrert'));
  if (enhet.registrertIForetaksregisteret)
    flags.appendChild(makeFlag('Foretaksregistret'));
  if (flags.childNodes.length > 0) resultEl.appendChild(flags);

  updateRejectButtonVisibility();
}

function makeFlag(
  label: string,
  severity?: 'ok' | 'warn' | 'danger',
): HTMLElement {
  const el = document.createElement('span');
  el.className = 'flag';
  if (severity) el.dataset.severity = severity;
  el.textContent = label;
  return el;
}

function addRow(dl: HTMLDListElement, label: string, value?: string): void {
  if (!value) return;
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  dl.append(dt, dd);
}

function addLink(
  dl: HTMLDListElement,
  label: string,
  href: string,
  text: string,
): void {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = text;
  dd.appendChild(a);
  dl.append(dt, dd);
}

function showPicker(host: string, candidates: SearchHit[]): void {
  currentOrgnr = undefined;
  currentPickerHost = host;
  currentPickerCandidates = candidates.slice(0, MAX_PICKER_CANDIDATES);
  setState('picker');
  setBrregLink();
  setDetailsLink();
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

async function handlePickerChoice(host: string, orgnr: string): Promise<void> {
  await setPickerChoice(host, orgnr);
  await loadAndRender(orgnr, 'host-pick');
}

async function handlePickerNone(host: string): Promise<void> {
  await setPickerChoice(host, null);
  void syncSidebarNoMatch(host);
  showEmptyState(host);
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

pickerNoneBtn.addEventListener('click', () => {
  if (!currentSourceHost) return;
  void handlePickerNone(currentSourceHost);
});

rejectChoiceBtn.addEventListener('click', () => {
  if (rejectChoiceBtn.disabled) return;
  void handleRejectChoice();
});

function showEmptyState(host: string | undefined): void {
  currentOrgnr = undefined;
  currentResolutionMethod = undefined;
  setState('empty');
  setBrregLink();
  setDetailsLink();
  emptyMessageEl.textContent = host
    ? `Ingen bedrift identifisert på ${host}. Søk for å finne riktig bedrift.`
    : 'Popup-en ble åpnet uten en bedrift å vise. Søk i Brønnøysundregistrene under.';
  manualQueryEl.value = '';
  manualResultsEl.replaceChildren();
  void renderRecentList();
  manualQueryEl.focus();
}

async function renderRecentList(): Promise<void> {
  const entries = await getRecent();
  recentListEl.replaceChildren();
  if (entries.length === 0) {
    recentSectionEl.hidden = true;
    return;
  }
  recentSectionEl.hidden = false;
  for (const entry of entries) {
    const li = document.createElement('li');
    li.tabIndex = 0;

    const name = document.createElement('span');
    name.className = 'recent-name';
    name.textContent = entry.navn;
    li.appendChild(name);

    const orgnr = document.createElement('span');
    orgnr.className = 'recent-orgnr';
    orgnr.textContent = entry.orgnr;
    li.appendChild(orgnr);

    const select = (): void => {
      void loadAndRender(entry.orgnr, 'manual');
    };
    li.addEventListener('click', select);
    li.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') select();
    });
    recentListEl.appendChild(li);
  }
}

function showError(err: unknown): void {
  setState('error');
  setDetailsLink();
  const message = err instanceof Error ? err.message : String(err);
  statusEl.textContent = `Feil: ${message}`;
}

function setState(
  state: 'loading' | 'result' | 'picker' | 'empty' | 'error',
): void {
  // Leaving the picker — clear candidate state so a stray keydown
  // can't fire handlePickerChoice on a previous host's list.
  if (state !== 'picker') {
    currentPickerHost = undefined;
    currentPickerCandidates = [];
  }
  app.dataset.state = state;
  // statusEl is the loading and error surface. Hide it on the data
  // states ('result', 'picker', 'empty') so the previous status text
  // doesn't stack above the new content.
  statusEl.hidden = state !== 'loading' && state !== 'error';
  resultEl.hidden = state !== 'result';
  pickerEl.hidden = state !== 'picker';
  emptyStateEl.hidden = state !== 'empty';
  updateRejectButtonVisibility();
}

// Manual search inside the empty state. Mirrors sidebar's runManualSearch:
// 250ms debounce, monotonic runId so out-of-order responses drop, min
// 2 chars, capped to 100 before reaching brreg.
let manualSearchTimer: ReturnType<typeof setTimeout> | undefined;
let manualSearchRunId = 0;

manualQueryEl.addEventListener('input', () => {
  if (manualSearchTimer) clearTimeout(manualSearchTimer);
  manualSearchRunId += 1;
  const value = manualQueryEl.value.trim();
  if (value.length < 2) {
    manualResultsEl.replaceChildren();
    // Empty query restores the recent list; an active query hides it
    // so manual-search results don't share airspace with stale recents.
    void renderRecentList();
    return;
  }
  recentSectionEl.hidden = true;
  const capped = value.slice(0, 100);
  manualSearchTimer = setTimeout(() => {
    void runManualSearch(capped);
  }, 250);
});

async function runManualSearch(query: string): Promise<void> {
  const myRunId = ++manualSearchRunId;
  try {
    const results = await searchEnheter(query, 10);
    if (myRunId !== manualSearchRunId) return;
    manualResultsEl.replaceChildren();
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
        void loadAndRender(item.organisasjonsnummer, 'manual');
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

// Keyboard shortcuts when the picker is active: digits 1-4 pick the
// corresponding row, 0 or Escape triggers "Ingen av disse". Bail when
// the picker isn't visible or when the user is typing into a form
// control (no inputs in picker state today, but defensive against
// future additions). Modifier keys also bail so OS shortcuts (cmd+w,
// ctrl+a) keep working.
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
