import { fetchEnhet, searchEnheter } from '../lib/brreg.js';
import { resolveOrgnr } from '../lib/orgnr.js';
import type { Enhet } from '../types/brreg.js';

const app = document.getElementById('app') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const resultEl = document.getElementById('result') as HTMLElement;
const searchEl = document.getElementById('search') as HTMLElement;
const queryInput = document.getElementById('query') as HTMLInputElement;
const searchResults = document.getElementById('search-results') as HTMLUListElement;

async function init(): Promise<void> {
  try {
    const tab = await getActiveTab();
    const orgnr = resolveOrgnr({
      url: tab?.url ?? '',
      title: tab?.title ?? '',
    });

    if (orgnr) {
      await loadAndRender(orgnr);
    } else {
      showSearch('No company detected on this page — try a search:');
    }
  } catch (err) {
    showError(err);
  }
}

async function getActiveTab(): Promise<browser.tabs.Tab | undefined> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function loadAndRender(orgnr: string): Promise<void> {
  setState('loading');
  statusEl.textContent = `Loading ${orgnr}…`;
  try {
    const enhet = await fetchEnhet(orgnr);
    renderEnhet(enhet);
  } catch (err) {
    showError(err);
  }
}

function renderEnhet(enhet: Enhet): void {
  setState('result');
  resultEl.innerHTML = '';

  const heading = document.createElement('h2');
  heading.textContent = enhet.navn;
  resultEl.appendChild(heading);

  const orgnrEl = document.createElement('div');
  orgnrEl.className = 'orgnr';
  orgnrEl.textContent = `Org.nr ${enhet.organisasjonsnummer}`;
  resultEl.appendChild(orgnrEl);

  const dl = document.createElement('dl');
  addRow(dl, 'Form', enhet.organisasjonsform?.beskrivelse);
  addRow(dl, 'Registered', enhet.registreringsdatoEnhetsregisteret);
  addRow(dl, 'Industry', enhet.naeringskode1?.beskrivelse);
  addRow(dl, 'Employees', enhet.antallAnsatte?.toString());
  addRow(
    dl,
    'Address',
    enhet.forretningsadresse?.adresse?.join(', ') ??
      enhet.forretningsadresse?.poststed,
  );
  resultEl.appendChild(dl);

  const flags = document.createElement('div');
  flags.className = 'flags';
  if (enhet.konkurs) flags.appendChild(makeFlag('Konkurs', 'danger'));
  if (enhet.underAvvikling) flags.appendChild(makeFlag('Under avvikling', 'warn'));
  if (enhet.underTvangsavviklingEllerTvangsopplosning)
    flags.appendChild(makeFlag('Tvangsavvikling', 'danger'));
  if (enhet.registrertIMvaregisteret) flags.appendChild(makeFlag('MVA-registered'));
  if (enhet.registrertIForetaksregisteret)
    flags.appendChild(makeFlag('Foretaksregistret'));
  if (flags.childNodes.length > 0) resultEl.appendChild(flags);
}

function makeFlag(label: string, severity?: 'warn' | 'danger'): HTMLElement {
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

function showSearch(message: string): void {
  setState('search');
  statusEl.textContent = message;
  queryInput.focus();
}

function showError(err: unknown): void {
  setState('error');
  const message = err instanceof Error ? err.message : String(err);
  statusEl.textContent = `Error: ${message}`;
}

function setState(state: 'loading' | 'result' | 'search' | 'error'): void {
  app.dataset.state = state;
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
      li.textContent = 'No matches.';
      searchResults.appendChild(li);
    }
  } catch (err) {
    if (myRunId !== searchRunId) return; // stale — let newer search render
    showError(err);
  }
}

void init();
