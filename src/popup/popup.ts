import { fetchEnhet, fetchRoller, searchEnheter } from '../lib/brreg.js';
import { renderOrgnrCopy } from '../lib/copy-orgnr.js';
import { formatAddress } from '../lib/format.js';
import { resolveOrgnrAsync } from '../lib/orgnr.js';
import { findDagligLeder } from '../lib/roller.js';
import type { Enhet, RollerResponse } from '../types/brreg.js';

const app = document.getElementById('app') as HTMLElement;
const brandMark = document.getElementById('brand-mark') as HTMLImageElement;
brandMark.src = browser.runtime.getURL('icons/icon-32.png');
const statusEl = document.getElementById('status') as HTMLElement;
const resultEl = document.getElementById('result') as HTMLElement;
const searchEl = document.getElementById('search') as HTMLElement;
const queryInput = document.getElementById('query') as HTMLInputElement;
const searchResults = document.getElementById('search-results') as HTMLUListElement;
const brregLink = document.getElementById('brreg-link') as HTMLAnchorElement;
const detailsLink = document.getElementById('details-link') as HTMLAnchorElement;

const BRREG_LINK_FALLBACK =
  'https://virksomhet.brreg.no/nb/oppslag/enheter';

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

async function init(): Promise<void> {
  try {
    const tab = await getActiveTab();
    const orgnr = await resolveOrgnrAsync({
      url: tab?.url ?? '',
      title: tab?.title ?? '',
    });

    if (orgnr) {
      await loadAndRender(orgnr);
    } else {
      showSearch('Ingen bedrift oppdaget på denne siden — søk i stedet:');
    }
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
    const tab = await getActiveTab();
    let host: string | undefined;
    if (tab?.url) {
      try {
        host = new URL(tab.url).hostname;
      } catch {
        /* invalid url — leave host undefined */
      }
    }
    await Promise.allSettled([
      browser.sidebarAction.setPanel({ panel: url }),
      browser.runtime.sendMessage({ type: 'sync', orgnr, host }),
    ]);
  } catch {
    // sidebarAction may be unavailable. Silent fail — the popup
    // itself still rendered.
  }
}

async function getActiveTab(): Promise<browser.tabs.Tab | undefined> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
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

function showSearch(message: string): void {
  setState('search');
  statusEl.textContent = message;
  setBrregLink();
  setDetailsLink();
  queryInput.focus();
}

function showError(err: unknown): void {
  setState('error');
  setDetailsLink();
  const message = err instanceof Error ? err.message : String(err);
  statusEl.textContent = `Feil: ${message}`;
}

function setState(state: 'loading' | 'result' | 'search' | 'error'): void {
  app.dataset.state = state;
  // In the result state we have a full company panel; the lingering
  // "Loading …" status would just stack on top of it. Hide it.
  statusEl.hidden = state === 'result';
  resultEl.hidden = state !== 'result';
  searchEl.hidden = state !== 'search';
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchRunId = 0;

queryInput.addEventListener('input', () => {
  if (searchTimer) clearTimeout(searchTimer);
  // Invalidate any in-flight search; whoever lands last must drop its results.
  searchRunId += 1;
  const value = queryInput.value.trim();
  if (value.length < 2) {
    searchResults.innerHTML = '';
    return;
  }
  // Cap user-supplied search length before it hits the brreg API.
  const capped = value.slice(0, 100);
  searchTimer = setTimeout(() => {
    void runSearch(capped);
  }, 250);
});

async function runSearch(query: string): Promise<void> {
  const myRunId = ++searchRunId;
  try {
    const results = await searchEnheter(query, 10);
    if (myRunId !== searchRunId) return; // stale — newer search in flight
    searchResults.innerHTML = '';
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
      searchResults.appendChild(li);
    }
    if (results.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'Ingen treff.';
      searchResults.appendChild(li);
    }
  } catch (err) {
    if (myRunId !== searchRunId) return; // stale — let newer search render
    showError(err);
  }
}

void init();
