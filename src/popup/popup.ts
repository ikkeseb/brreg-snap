// Side-effect import: aliases `globalThis.browser = chrome` on Chromium
// before any `browser.*` access. Must stay the first import.
import '../lib/platform/globals.js';
import { sidebar } from '../lib/platform/sidebar.js';
import { fetchEnhet, fetchRoller } from '../lib/brreg.js';
import { renderOrgnrCopy } from '../lib/copy-orgnr.js';
import { formatAddress, formatNaering } from '../lib/format.js';
import { findRoleHolder } from '../lib/roller.js';
import { addLink, addRow } from '../details/render/dom.js';
import { makeActivable } from '../lib/ui/activate.js';
import { deriveStatusFlags, makeFlag } from '../lib/ui/flags.js';
import { attachManualSearch } from '../lib/ui/manual-search.js';
import { createPicker, setupRejectChoice } from '../lib/ui/picker.js';
import {
  resolveTabContext,
  type ResolutionMethod,
  type TabContext,
} from '../lib/ui/resolve-tab.js';
import { createSourceLabel } from '../lib/ui/source-label.js';
import type { Enhet, RollerResponse, SearchHit } from '../types/brreg.js';
import { getRecent, pushRecent } from './recent.js';

const app = document.getElementById('app') as HTMLElement;
const brandMark = document.getElementById('brand-mark') as HTMLImageElement;
brandMark.src = browser.runtime.getURL('icons/icon-32.png');
const statusEl = document.getElementById('status') as HTMLElement;
const skeletonEl = document.getElementById('skeleton') as HTMLElement;
const errorActionsEl = document.getElementById('error-actions') as HTMLElement;
const retryLoadBtn = document.getElementById(
  'retry-load',
) as HTMLButtonElement;
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

let currentOrgnr: string | undefined;
let currentResolutionMethod: ResolutionMethod | undefined;
// Active tab/window ids captured during resolution so the "open in
// side panel" click can pass them to sidebar.open() synchronously —
// Chrome's sidePanel.open needs a windowId/tabId and can't await a
// tabs.query inside the gesture. Unused by the Firefox adapter.
let currentWindowId: number | undefined;
let currentTabId: number | undefined;
// Monotonic guard for loadAndRender — from the empty state the user
// can click a manual result then a recent entry in quick succession;
// without this the last-to-RESOLVE fetch chain paints, which can be
// the stale one. Same pattern as the sidebar's loadRunId.
let loadRunId = 0;
// Re-trigger for the "Prøv igjen" button in the full error state.
let lastLoad: (() => void) | undefined;

const sourceLabel = createSourceLabel(footerSourceEl, sourceHostEl);

const picker = createPicker({
  appEl: app,
  listEl: pickerListEl,
  noneBtn: pickerNoneBtn,
  onChoose: (_host, orgnr) => {
    void loadAndRender(orgnr, 'host-pick');
  },
  onNone: (host) => {
    void syncSidebarNoMatch(host);
    showEmptyState(host);
  },
});

const manualSearch = attachManualSearch({
  inputEl: manualQueryEl,
  resultsEl: manualResultsEl,
  onSelect: (hit) => {
    void loadAndRender(hit.organisasjonsnummer, 'manual');
  },
  // Empty query restores the recent list; an active query hides it
  // so manual-search results don't share airspace with stale recents.
  onQueryCleared: () => {
    void renderRecentList();
  },
  onQueryActive: () => {
    recentSectionEl.hidden = true;
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
  const sourceHost = sourceLabel.get();
  if (currentOrgnr) {
    relPath = `details/details.html?orgnr=${currentOrgnr}`;
  } else if (sourceHost) {
    relPath = `details/details.html?nomatch=${encodeURIComponent(sourceHost)}`;
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

function updateRejectButtonVisibility(): void {
  // Only host-resolved orgnrs are disputable. URL-derived orgnrs are
  // authoritative for their domain; manual picks are the user's own
  // explicit choice and not subject to the "Feil bedrift?" reframe.
  const overridable =
    app.dataset.state === 'result' &&
    (currentResolutionMethod === 'host-auto' ||
      currentResolutionMethod === 'host-pick') &&
    sourceLabel.get() !== undefined &&
    currentOrgnr !== undefined;
  resolutionActionsEl.hidden = !overridable;
}

async function resolveFromActiveTab(): Promise<TabContext> {
  // Same band-aware cascade as the sidebar's resolveFromActiveTab —
  // shared in lib/ui/resolve-tab.ts. Only the tabs.query (and the
  // window/tab-id capture for the gesture-bound side-panel open)
  // lives here.
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  // Capture for the gesture-bound side-panel open (Chrome). Harmless on
  // Firefox, whose adapter ignores the target.
  currentWindowId = tab?.windowId;
  currentTabId = tab?.id;
  return resolveTabContext(tab?.url ?? '', tab?.title ?? '');
}

async function init(): Promise<void> {
  try {
    const ctx = await resolveFromActiveTab();
    sourceLabel.set(ctx.host);
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
      host: sourceLabel.get(),
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
  // Monotonic guard — a second load started while the first is still
  // in flight (manual result → recent entry) must win regardless of
  // which fetch chain resolves last.
  const myRunId = ++loadRunId;
  currentOrgnr = orgnr;
  if (method !== undefined) currentResolutionMethod = method;
  lastLoad = () => {
    void loadAndRender(orgnr, method);
  };
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
    if (myRunId !== loadRunId) return;
    renderEnhet(enhet, roller);
  } catch (err) {
    if (myRunId !== loadRunId) return;
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
  addRow(dl, 'Næring', formatNaering(enhet.naeringskode1));
  addRow(dl, 'Ansatte', enhet.antallAnsatte?.toString());
  // Always render daglig leder, even when missing, so the user sees we
  // looked — empty fallback distinguishes "no role registered" from
  // "we forgot to check". Other rows can legitimately be missing on
  // certain forms (ENK has no Form-suffix, foreign entities lack næring).
  addRow(dl, 'Daglig leder', findRoleHolder(roller, 'DAGL') ?? '—');
  // Styreleder is the natural "who else runs it" companion; shown only
  // when registered so the fast-glance popup stays tight (the sidebar
  // overview carries the fuller revisor/regnskapsfører set).
  addRow(dl, 'Styreleder', findRoleHolder(roller, 'LEDE'));
  addRow(dl, 'Adresse', formatAddress(enhet.forretningsadresse));
  if (enhet.hjemmeside) {
    const href = enhet.hjemmeside.startsWith('http')
      ? enhet.hjemmeside
      : `https://${enhet.hjemmeside}`;
    addLink(dl, 'Hjemmeside', href, enhet.hjemmeside, true);
  }
  resultEl.appendChild(dl);

  const flags = document.createElement('div');
  flags.className = 'flags';
  for (const flag of deriveStatusFlags(enhet))
    flags.appendChild(makeFlag(flag.label, flag.severity));
  if (enhet.registrertIMvaregisteret)
    flags.appendChild(makeFlag('MVA-registrert', undefined, 'registry'));
  if (enhet.registrertIForetaksregisteret)
    flags.appendChild(makeFlag('Foretaksregistret', undefined, 'registry'));
  if (enhet.registrertIStiftelsesregisteret)
    flags.appendChild(makeFlag('Stiftelsesregistret', undefined, 'registry'));
  if (enhet.registrertIFrivillighetsregisteret)
    flags.appendChild(makeFlag('Frivillighetsregistret', undefined, 'registry'));
  if (flags.childNodes.length > 0) resultEl.appendChild(flags);

  updateRejectButtonVisibility();
}

function showPicker(host: string, candidates: SearchHit[]): void {
  currentOrgnr = undefined;
  setState('picker');
  setBrregLink();
  setDetailsLink();
  picker.render(host, candidates);
}

function showEmptyState(host: string | undefined): void {
  currentOrgnr = undefined;
  currentResolutionMethod = undefined;
  setState('empty');
  setBrregLink();
  setDetailsLink();
  emptyMessageEl.textContent = host
    ? `Ingen bedrift identifisert på ${host}. Søk for å finne riktig bedrift.`
    : 'Popup-en ble åpnet uten en bedrift å vise. Søk i Brønnøysundregistrene under.';
  manualSearch.reset();
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

    const name = document.createElement('span');
    name.className = 'recent-name';
    name.textContent = entry.navn;
    li.appendChild(name);

    const orgnr = document.createElement('span');
    orgnr.className = 'recent-orgnr';
    orgnr.textContent = entry.orgnr;
    li.appendChild(orgnr);

    makeActivable(li, () => {
      void loadAndRender(entry.orgnr, 'manual');
    });
    recentListEl.appendChild(li);
  }
}

function showError(err: unknown): void {
  setState('error');
  setDetailsLink();
  const message = err instanceof Error ? err.message : String(err);
  statusEl.textContent = `Feil: ${message}`;
  // "Prøv igjen" only makes sense when there is a load to re-trigger —
  // an init-time resolution failure has nothing to retry.
  errorActionsEl.hidden = lastLoad === undefined;
}

function setState(
  state: 'loading' | 'result' | 'picker' | 'empty' | 'error',
): void {
  // Leaving the picker — clear candidate state so a stray keydown
  // can't fire the picker's onChoose on a previous host's list.
  if (state !== 'picker') picker.clear();
  app.dataset.state = state;
  // statusEl carries the polite aria-live announcement during loading
  // (kept off-screen, not display:none, so screen readers still read
  // "Henter …" while the skeleton is what's shown), and becomes the
  // visible error message during state='error'. Same pattern as the
  // sidebar (src/details/details.ts).
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
  skeletonEl.hidden = state !== 'loading';
  // showError unhides this when a retry target exists.
  errorActionsEl.hidden = true;
  resultEl.hidden = state !== 'result';
  pickerEl.hidden = state !== 'picker';
  emptyStateEl.hidden = state !== 'empty';
  updateRejectButtonVisibility();
}

void init();
