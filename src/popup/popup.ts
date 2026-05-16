import { fetchEnhet, fetchRoller, searchEnheter } from '../lib/brreg.js';
import { renderOrgnrCopy } from '../lib/copy-orgnr.js';
import { formatAddress } from '../lib/format.js';
import {
  searchByHostnameDetailed,
  setPickerChoice,
} from '../lib/hostname-search.js';
import { resolveOrgnr } from '../lib/orgnr.js';
import { findDagligLeder } from '../lib/roller.js';
import type { Enhet, RollerResponse, SearchHit } from '../types/brreg.js';

const app = document.getElementById('app') as HTMLElement;
const brandMark = document.getElementById('brand-mark') as HTMLImageElement;
brandMark.src = browser.runtime.getURL('icons/icon-32.png');
const statusEl = document.getElementById('status') as HTMLElement;
const resultEl = document.getElementById('result') as HTMLElement;
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
const brregLink = document.getElementById('brreg-link') as HTMLAnchorElement;
const detailsLink = document.getElementById('details-link') as HTMLAnchorElement;

const BRREG_LINK_FALLBACK =
  'https://virksomhet.brreg.no/nb/oppslag/enheter';

let currentSourceHost: string | undefined;

function setBrregLink(orgnr?: string): void {
  brregLink.href = orgnr
    ? `https://virksomhet.brreg.no/nb/oppslag/enheter/${orgnr}`
    : BRREG_LINK_FALLBACK;
}

function setDetailsLink(orgnr?: string): void {
  if (!orgnr) {
    detailsLink.hidden = true;
    detailsLink.removeAttribute('href');
    detailsLink.onclick = null;
    return;
  }
  detailsLink.hidden = false;
  const url = browser.runtime.getURL(
    `details/details.html?orgnr=${orgnr}`,
  );
  // Keep href so middle-click and keyboard activation still open the
  // details page somewhere. The onclick swaps to a Firefox sidebar so
  // the panel docks into the browser chrome instead of stealing focus
  // into a new tab or popup window.
  detailsLink.href = url;
  detailsLink.onclick = (ev) => {
    ev.preventDefault();
    // setPanel + open must both fire inside the user-gesture context
    // of this click. setPanel is promise-based but fire-and-forget is
    // fine — open() picks up the new panel URL when the sidebar paints.
    void browser.sidebarAction.setPanel({ panel: url });
    void browser.sidebarAction.open();
    window.close();
  };
}

interface TabContext {
  orgnr?: string;
  host?: string;
  pickerCandidates?: SearchHit[];
}

async function getActiveTab(): Promise<browser.tabs.Tab | undefined> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
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
  if (sync) return { orgnr: sync, host };
  if (!host) return {};
  const detailed = await searchByHostnameDetailed(host);
  if (!detailed) return { host };
  if (detailed.band === 'auto') return { orgnr: detailed.choice, host };
  if (detailed.band === 'picker') {
    return { host, pickerCandidates: detailed.candidates };
  }
  return { host };
}

async function init(): Promise<void> {
  try {
    const ctx = await resolveFromActiveTab();
    currentSourceHost = ctx.host;
    if (ctx.orgnr) {
      await loadAndRender(ctx.orgnr);
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
    const open = await browser.sidebarAction.isOpen({});
    if (!open) return;
    const url = browser.runtime.getURL(
      `details/details.html?orgnr=${orgnr}`,
    );
    await Promise.allSettled([
      browser.sidebarAction.setPanel({ panel: url }),
      browser.runtime.sendMessage({
        type: 'sync',
        orgnr,
        host: currentSourceHost,
      }),
    ]);
  } catch {
    // sidebarAction may be unavailable. Silent fail — the popup
    // itself still rendered.
  }
}

async function syncSidebarNoMatch(host: string | undefined): Promise<void> {
  // Counterpart to syncSidebarIfOpen for the "Ingen av disse" path —
  // tells an open sidebar that this host has no current pick so it
  // can clear stale company data instead of keeping the previous
  // picker / result up. setPanel resets the panel URL so a fresh
  // open lands on the empty state, not the prior orgnr.
  try {
    const open = await browser.sidebarAction.isOpen({});
    if (!open) return;
    const blank = browser.runtime.getURL(
      host
        ? `details/details.html?nomatch=${encodeURIComponent(host)}`
        : 'details/details.html',
    );
    await Promise.allSettled([
      browser.sidebarAction.setPanel({ panel: blank }),
      browser.runtime.sendMessage({ type: 'no-match', host }),
    ]);
  } catch {
    /* silent — popup still rendered */
  }
}

async function loadAndRender(orgnr: string): Promise<void> {
  setState('loading');
  statusEl.textContent = `Henter ${orgnr}…`;
  setBrregLink(orgnr);
  setDetailsLink(orgnr);
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
  resultEl.innerHTML = '';

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
  addRow(dl, 'Daglig leder', findDagligLeder(roller));
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
  setState('picker');
  setBrregLink();
  setDetailsLink();
  pickerListEl.innerHTML = '';
  for (const cand of candidates.slice(0, 4)) {
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
  await loadAndRender(orgnr);
}

async function handlePickerNone(host: string): Promise<void> {
  await setPickerChoice(host, null);
  void syncSidebarNoMatch(host);
  showEmptyState(host);
}

pickerNoneBtn.addEventListener('click', () => {
  if (!currentSourceHost) return;
  void handlePickerNone(currentSourceHost);
});

function showEmptyState(host: string | undefined): void {
  setState('empty');
  setBrregLink();
  setDetailsLink();
  emptyMessageEl.textContent = host
    ? `Ingen bedrift identifisert på ${host}. Søk for å finne riktig bedrift.`
    : 'Popup-en ble åpnet uten en bedrift å vise. Søk i Brønnøysundregistrene under.';
  manualQueryEl.value = '';
  manualResultsEl.innerHTML = '';
  manualQueryEl.focus();
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
  app.dataset.state = state;
  // statusEl is the loading and error surface. Hide it on the data
  // states ('result', 'picker', 'empty') so the previous status text
  // doesn't stack above the new content.
  statusEl.hidden = state !== 'loading' && state !== 'error';
  resultEl.hidden = state !== 'result';
  pickerEl.hidden = state !== 'picker';
  emptyStateEl.hidden = state !== 'empty';
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
    manualResultsEl.innerHTML = '';
    return;
  }
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
      li.textContent = `${item.navn} (${item.organisasjonsnummer})`;
      const select = (): void => {
        void loadAndRender(item.organisasjonsnummer);
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

void init();
