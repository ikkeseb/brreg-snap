import {
  fetchEnhet,
  fetchRoller,
  fetchUnderenheter,
  invalidateCache,
} from '../lib/brreg.js';
import { formatAddress } from '../lib/format.js';
import { isValidOrgnr } from '../lib/mod11.js';
import { findDagligLeder } from '../lib/roller.js';
import type {
  Enhet,
  Person,
  Rolle,
  RolleEnhet,
  RolleGruppe,
  RollerResponse,
  Underenhet,
} from '../types/brreg.js';

const app = $('app');
const statusEl = $('status');
const resultEl = $('result');
const nameEl = $('name');
const orgnrEl = $('orgnr');
const flagsEl = $('flags');
const overviewList = $('overview-list') as HTMLDListElement;
const contactList = $('contact-list') as HTMLDListElement;
const rolesBody = $('roles-body');
const parentSection = $('parent');
const parentBody = $('parent-body');
const underenheterSection = $('underenheter');
const underenheterBody = $('underenheter-body');
const brregLink = $('brreg-link') as HTMLAnchorElement;
const refreshButton = $('refresh-button') as HTMLButtonElement;

refreshButton.addEventListener('click', () => {
  refreshButton.dataset.spinning = 'true';
  const orgnr = getOrgnrFromUrl();
  const work = orgnr ? invalidateCache(orgnr) : Promise.resolve();
  void work.finally(() => {
    // Reload re-runs init() which refetches everything. With the cache
    // cleared above, that means a real round-trip to brreg.no rather
    // than serving the same response we already had.
    window.location.reload();
  });
});

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function getOrgnrFromUrl(): string | undefined {
  const params = new URLSearchParams(window.location.search);
  const orgnr = params.get('orgnr');
  if (orgnr && isValidOrgnr(orgnr)) return orgnr;
  return undefined;
}

function setState(state: 'loading' | 'result' | 'error'): void {
  app.dataset.state = state;
  statusEl.hidden = state === 'result';
  resultEl.hidden = state !== 'result';
}

function showError(err: unknown): void {
  setState('error');
  const message = err instanceof Error ? err.message : String(err);
  statusEl.textContent = `Feil: ${message}`;
}

function showEmptyState(): void {
  setState('error');
  statusEl.textContent =
    'Klikk verktøylinjeikonet på en bedriftsside og velg «Detaljert visning» for å vise et selskap her.';
}

async function init(): Promise<void> {
  const orgnr = getOrgnrFromUrl();
  if (!orgnr) {
    // No orgnr in the URL means the sidebar was opened manually
    // (Firefox View Sidebars menu) before any company was selected.
    // Show a hint, not a hard error.
    showEmptyState();
    return;
  }
  brregLink.href = `https://virksomhet.brreg.no/nb/oppslag/enheter/${orgnr}`;

  setState('loading');
  statusEl.textContent = `Henter ${orgnr}…`;

  try {
    // Run in parallel — roller and underenheter don't depend on the
    // enhet response and the user is waiting on the slowest of three.
    const [enhet, roller, underenheter] = await Promise.all([
      fetchEnhet(orgnr),
      fetchRoller(orgnr).catch(() => ({ rollegrupper: [] }) as RollerResponse),
      fetchUnderenheter(orgnr).catch(() => [] as Underenhet[]),
    ]);

    renderHeader(enhet);
    renderOverview(enhet, roller);
    renderContact(enhet);
    renderRoles(roller);
    void renderParent(enhet.overordnetEnhet);
    renderUnderenheter(underenheter);
    setState('result');
  } catch (err) {
    showError(err);
  }
}

function renderHeader(enhet: Enhet): void {
  nameEl.textContent = enhet.navn;
  orgnrEl.textContent = `Org.nr ${enhet.organisasjonsnummer}`;
  flagsEl.innerHTML = '';
  if (enhet.konkurs) flagsEl.appendChild(makeFlag('Konkurs', 'danger'));
  if (enhet.underAvvikling)
    flagsEl.appendChild(makeFlag('Under avvikling', 'warn'));
  if (enhet.underTvangsavviklingEllerTvangsopplosning)
    flagsEl.appendChild(makeFlag('Tvangsavvikling', 'danger'));
  if (enhet.registrertIMvaregisteret)
    flagsEl.appendChild(makeFlag('MVA-registrert'));
  if (enhet.registrertIForetaksregisteret)
    flagsEl.appendChild(makeFlag('Foretaksregistret'));
  if (enhet.registrertIStiftelsesregisteret)
    flagsEl.appendChild(makeFlag('Stiftelsesregistret'));
  if (enhet.registrertIFrivillighetsregisteret)
    flagsEl.appendChild(makeFlag('Frivillighetsregistret'));
}

function renderOverview(enhet: Enhet, roller: RollerResponse): void {
  overviewList.innerHTML = '';
  addRow(overviewList, 'Organisasjonsform', enhet.organisasjonsform?.beskrivelse);
  addRow(
    overviewList,
    'Registrert',
    enhet.registreringsdatoEnhetsregisteret,
  );
  addRow(overviewList, 'Næring', enhet.naeringskode1?.beskrivelse);
  addRow(overviewList, 'Antall ansatte', enhet.antallAnsatte?.toString());
  addRow(overviewList, 'Daglig leder', findDagligLeder(roller));
}

function renderContact(enhet: Enhet): void {
  contactList.innerHTML = '';
  const businessAddr = formatAddress(enhet.forretningsadresse);
  const postalAddr = formatAddress(enhet.postadresse);
  addRow(contactList, 'Forretningsadresse', businessAddr);
  if (postalAddr && postalAddr !== businessAddr) {
    addRow(contactList, 'Postadresse', postalAddr);
  }
  addRow(contactList, 'Telefon', enhet.telefon);
  addRow(contactList, 'Mobil', enhet.mobil);
  if (enhet.epostadresse) {
    addLink(
      contactList,
      'E-post',
      `mailto:${enhet.epostadresse}`,
      enhet.epostadresse,
    );
  }
  if (enhet.hjemmeside) {
    const href = enhet.hjemmeside.startsWith('http')
      ? enhet.hjemmeside
      : `https://${enhet.hjemmeside}`;
    addLink(contactList, 'Hjemmeside', href, enhet.hjemmeside, true);
  }
}

function renderRoles(roller: RollerResponse): void {
  rolesBody.innerHTML = '';
  const groups = roller.rollegrupper ?? [];
  const nonEmpty = groups.filter((g) => (g.roller?.length ?? 0) > 0);
  if (nonEmpty.length === 0) {
    rolesBody.appendChild(emptyLine('Ingen registrerte roller.'));
    return;
  }
  for (const group of nonEmpty) {
    rolesBody.appendChild(renderRoleGroup(group));
  }
}

function renderRoleGroup(group: RolleGruppe): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'role-group';

  const title = document.createElement('p');
  title.className = 'role-group-title';
  title.textContent = group.type.beskrivelse ?? group.type.kode;
  wrap.appendChild(title);

  const ul = document.createElement('ul');
  ul.className = 'role-list';
  for (const role of group.roller ?? []) {
    ul.appendChild(renderRoleItem(role));
  }
  wrap.appendChild(ul);
  return wrap;
}

function renderRoleItem(role: Rolle): HTMLLIElement {
  const li = document.createElement('li');
  if (role.fratraadt) li.classList.add('fratraadt');

  const subject = formatRoleSubject(role.person, role.enhet);
  const roleLabel =
    role.type.beskrivelse && role.type.beskrivelse !== role.type.kode
      ? role.type.beskrivelse
      : role.type.kode;
  li.textContent = subject
    ? `${roleLabel}: ${subject}`
    : roleLabel;
  if (role.fratraadt) li.textContent += ' (fratrådt)';
  return li;
}

function formatRoleSubject(
  person: Person | undefined,
  enhet: RolleEnhet | undefined,
): string {
  if (person?.navn) {
    const parts = [
      person.navn.fornavn,
      person.navn.mellomnavn,
      person.navn.etternavn,
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
  }
  if (enhet) {
    const navn = enhet.navn?.join(' ') ?? '';
    const orgnr = enhet.organisasjonsnummer;
    if (navn && orgnr) return `${navn} (${orgnr})`;
    if (navn) return navn;
    if (orgnr) return orgnr;
  }
  return '';
}

async function renderParent(parentOrgnr: string | undefined): Promise<void> {
  if (!parentOrgnr) {
    parentSection.hidden = true;
    return;
  }
  parentSection.hidden = false;
  parentBody.innerHTML = '';
  const link = document.createElement('a');
  link.href = `?orgnr=${parentOrgnr}`;
  link.textContent = `Org.nr ${parentOrgnr}`;
  parentBody.appendChild(link);

  try {
    const parent = await fetchEnhet(parentOrgnr);
    parentBody.innerHTML = '';
    const a = document.createElement('a');
    a.href = `?orgnr=${parentOrgnr}`;
    a.textContent = `${parent.navn} (${parentOrgnr})`;
    parentBody.appendChild(a);
  } catch {
    // Already rendered fallback link with just the orgnr.
  }
}

function renderUnderenheter(items: Underenhet[]): void {
  if (items.length === 0) {
    underenheterSection.hidden = true;
    return;
  }
  underenheterSection.hidden = false;
  underenheterBody.innerHTML = '';

  const summary = document.createElement('p');
  summary.className = 'empty';
  summary.style.fontStyle = 'normal';
  summary.style.color = 'var(--muted)';
  summary.textContent = `${items.length} registrert${items.length === 1 ? '' : 'e'}.`;
  underenheterBody.appendChild(summary);

  const table = document.createElement('table');
  table.className = 'underenheter';
  const thead = document.createElement('thead');
  thead.innerHTML =
    '<tr><th>Navn</th><th>Org.nr</th><th>Næring</th><th>Sted</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const u of items) {
    const tr = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.textContent = u.navn;
    tr.appendChild(nameCell);

    const orgnrCell = document.createElement('td');
    orgnrCell.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace';
    orgnrCell.textContent = u.organisasjonsnummer;
    tr.appendChild(orgnrCell);

    const industryCell = document.createElement('td');
    industryCell.textContent = u.naeringskode1?.beskrivelse ?? '';
    tr.appendChild(industryCell);

    const placeCell = document.createElement('td');
    placeCell.textContent =
      u.beliggenhetsadresse?.poststed ?? u.beliggenhetsadresse?.kommune ?? '';
    tr.appendChild(placeCell);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  underenheterBody.appendChild(table);
}

function makeFlag(label: string, severity?: 'warn' | 'danger'): HTMLElement {
  const el = document.createElement('span');
  el.className = 'flag';
  if (severity) el.dataset.severity = severity;
  el.textContent = label;
  return el;
}

function addRow(
  dl: HTMLDListElement,
  label: string,
  value: string | undefined,
): void {
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
  external = false,
): void {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  if (external) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  dd.appendChild(a);
  dl.append(dt, dd);
}

function emptyLine(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = text;
  return p;
}

void init();
