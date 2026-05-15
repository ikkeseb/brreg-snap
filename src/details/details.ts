import { decideToggle } from '../lib/auto-sync-controller.js';
import { getAutoSync, setAutoSync } from '../lib/auto-sync-settings.js';
import {
  fetchEnhet,
  fetchRegnskap,
  fetchRoller,
  fetchUnderenheter,
  invalidateCache,
} from '../lib/brreg.js';
import { buildOrgnrCopyButton, renderOrgnrCopy } from '../lib/copy-orgnr.js';
import { formatAddress, formatNok, formatRelativeTime } from '../lib/format.js';
import { isValidOrgnr } from '../lib/mod11.js';
import { resolveOrgnrAsync } from '../lib/orgnr.js';
import { findDagligLeder } from '../lib/roller.js';
import type {
  Enhet,
  Person,
  RegnskapResponse,
  Rolle,
  RolleEnhet,
  RolleGruppe,
  RollerResponse,
  Underenhet,
} from '../types/brreg.js';

const app = $('app');
const brandMark = $('brand-mark') as HTMLImageElement;
brandMark.src = browser.runtime.getURL('icons/icon-48.png');
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
const nokkeltallBody = $('nokkeltall-body');
const brregLink = $('brreg-link') as HTMLAnchorElement;
const footerUpdated = $('footer-updated');
const updatedTime = $('updated-time') as HTMLTimeElement;
const refreshBtn = $('refresh-btn') as HTMLButtonElement;
const autoSyncToggle = $('auto-sync-toggle') as HTMLInputElement;
const autoSyncStatus = $('auto-sync-status');
const footerSource = $('footer-source');
const sourceHostEl = $('source-host');
let currentOrgnr: string | undefined;
let currentSourceHost: string | undefined;
let lastUpdatedAt: number | undefined;
let updatedTimerId: number | undefined;

setupTabs();
setupRefresh();
void setupAutoSyncToggle();

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

function getNoMatchHostFromUrl(): string | undefined {
  const params = new URLSearchParams(window.location.search);
  const host = params.get('nomatch');
  return host ?? undefined;
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

function showEmptyState(host?: string): void {
  setState('error');
  // Clear any orgnr left in the URL so a panel reload doesn't re-fetch
  // the stale company.
  const url = new URL(window.location.href);
  url.searchParams.delete('orgnr');
  window.history.replaceState(null, '', url.toString());
  currentOrgnr = undefined;
  setSourceHost(host);
  statusEl.textContent = host
    ? `Ingen bedrift identifisert på ${host}. Klikk verktøylinjeikonet for å søke manuelt.`
    : 'Klikk verktøylinjeikonet på en bedriftsside og velg «Detaljert visning» for å vise et selskap her.';
}

let loadRunId = 0;

async function loadOrgnr(orgnr: string): Promise<void> {
  // Monotonic guard — if the popup pushes a second sync while the
  // first is still in flight, the older fetches must not overwrite
  // the newer ones when they land out of order.
  const myRunId = ++loadRunId;
  currentOrgnr = orgnr;

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

async function doRefresh(currentOrgnrArg: string): Promise<void> {
  refreshBtn.disabled = true;
  try {
    const hasTabs = await browser.permissions.contains({
      permissions: ['tabs'],
    });
    if (hasTabs) {
      const fromTab = await resolveFromActiveTab();
      if (fromTab.orgnr) {
        setSourceHost(fromTab.host);
        const url = new URL(window.location.href);
        url.searchParams.set('orgnr', fromTab.orgnr);
        window.history.replaceState(null, '', url.toString());
        await invalidateCache(fromTab.orgnr);
        await loadOrgnr(fromTab.orgnr);
        return;
      }
      // No orgnr on the active tab — fall through to refetch
      // whatever's displayed.
    }
    if (!currentOrgnrArg) return;
    await invalidateCache(currentOrgnrArg);
    await loadOrgnr(currentOrgnrArg);
  } finally {
    refreshBtn.disabled = false;
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
    return { orgnr: await resolveOrgnrAsync({ url, title }), host };
  } catch {
    return {};
  }
}

async function init(): Promise<void> {
  // ?nomatch=<host> means a deliberate trigger (menu, fresh sidebar
  // open) landed on a page with no resolvable orgnr. Skip the active-
  // tab probe — the caller already told us there's nothing to find,
  // and rendering an empty state with the host is more useful than
  // chasing tabs.query for a definitely-empty answer.
  const noMatchHost = getNoMatchHostFromUrl();
  if (noMatchHost !== undefined) {
    showEmptyState(noMatchHost);
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
    // Neither the active tab nor the URL has a company. The sidebar
    // was opened manually (Firefox View > Sidebars) on a page brreg-now
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
  await loadOrgnr(orgnr);
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
// switch with auto-sync on) landed on a page brreg-now can't resolve
// — we clear the sidebar instead of leaving stale company data up.
browser.runtime.onMessage.addListener((msg: unknown) => {
  if (isNoMatchMessage(msg)) {
    // Bump loadRunId so any in-flight loadOrgnr from a previous sync
    // doesn't overwrite the empty state when its fetches land.
    ++loadRunId;
    showEmptyState(msg.host);
    return;
  }
  if (!isSyncMessage(msg)) return;
  if (!isValidOrgnr(msg.orgnr)) return;
  setSourceHost(msg.host);
  const url = new URL(window.location.href);
  url.searchParams.set('orgnr', msg.orgnr);
  window.history.replaceState(null, '', url.toString());
  void loadOrgnr(msg.orgnr);
});

function renderHeader(enhet: Enhet): void {
  nameEl.textContent = enhet.navn;
  renderOrgnrCopy(orgnrEl, enhet.organisasjonsnummer);
  flagsEl.innerHTML = '';
  const negativeStatus =
    enhet.konkurs ||
    enhet.underAvvikling ||
    enhet.underTvangsavviklingEllerTvangsopplosning;
  if (!negativeStatus) flagsEl.appendChild(makeFlag('Aktiv', 'ok'));
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

function unsupportedPlanLabel(code: string): string {
  switch (code.toUpperCase()) {
    case 'BANK':
      return 'bankregnskap (BANK)';
    case 'FORS':
      return 'forsikringsregnskap (FORS)';
    default:
      return `oppstillingsplan ${code}`;
  }
}

function renderNokkeltall(response: RegnskapResponse): void {
  nokkeltallBody.innerHTML = '';
  if (response.unsupportedPlan) {
    // brreg's public regnskap-API only serialises the default
    // oppstillingsplan; BANK / FORS filings exist but come back as
    // 500. Surface that explicitly so we don't look like we missed
    // the data.
    nokkeltallBody.appendChild(
      emptyLine(
        `Filer som ${unsupportedPlanLabel(response.unsupportedPlan)} — ikke tilgjengelig i offentlig API.`,
      ),
    );
    return;
  }

  // brreg's regnskapsregisteret returns the array in arbitrary order;
  // pick the most recent period by `tilDato` rather than trusting
  // index 0.
  const latest = response.items
    .filter((r) => r.regnskapsperiode?.tilDato)
    .sort((a, b) =>
      (b.regnskapsperiode!.tilDato ?? '').localeCompare(
        a.regnskapsperiode!.tilDato ?? '',
      ),
    )[0];
  if (!latest) {
    nokkeltallBody.appendChild(emptyLine('Ingen regnskap registrert.'));
    return;
  }

  const tilDato = latest.regnskapsperiode?.tilDato ?? '';
  const year = tilDato.slice(0, 4);
  const header = document.createElement('p');
  header.className = 'nokkeltall-year';
  header.textContent = year ? `Regnskap ${year}` : 'Siste regnskap';
  nokkeltallBody.appendChild(header);

  const dl = document.createElement('dl');
  dl.className = 'nokkeltall-grid';
  const res = latest.resultatregnskapResultat;
  addRow(
    dl,
    'Driftsinntekter',
    formatNok(res?.driftsresultat?.driftsinntekter?.sumDriftsinntekter),
  );
  addRow(dl, 'Driftsresultat', formatNok(res?.driftsresultat?.driftsresultat));
  addRow(
    dl,
    'Resultat før skatt',
    formatNok(res?.ordinaertResultatFoerSkattekostnad),
  );
  addRow(dl, 'Årsresultat', formatNok(res?.aarsresultat));
  addRow(
    dl,
    'Egenkapital',
    formatNok(latest.egenkapitalGjeld?.egenkapital?.sumEgenkapital),
  );

  if (dl.children.length === 0) {
    nokkeltallBody.appendChild(emptyLine('Regnskap registrert, men uten utdrag.'));
    return;
  }
  nokkeltallBody.appendChild(dl);
}

function renderUnderenheter(items: Underenhet[]): void {
  underenheterSection.hidden = false;
  underenheterBody.innerHTML = '';

  if (items.length === 0) {
    underenheterBody.appendChild(emptyLine('Ingen registrerte underenheter.'));
    return;
  }

  const summary = document.createElement('p');
  summary.className = 'empty';
  summary.style.fontStyle = 'normal';
  summary.style.color = 'var(--muted)';
  summary.textContent = `${items.length} registrert${items.length === 1 ? '' : 'e'}.`;
  underenheterBody.appendChild(summary);

  const table = document.createElement('table');
  table.className = 'underenheter';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Navn</th><th>Org.nr</th><th>Sted</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const u of items) {
    const tr = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.textContent = u.navn;
    tr.appendChild(nameCell);

    const orgnrCell = document.createElement('td');
    orgnrCell.className = 'orgnr-cell';
    orgnrCell.appendChild(buildOrgnrCopyButton(u.organisasjonsnummer));
    tr.appendChild(orgnrCell);

    const placeCell = document.createElement('td');
    placeCell.textContent =
      u.beliggenhetsadresse?.poststed ?? u.beliggenhetsadresse?.kommune ?? '';
    tr.appendChild(placeCell);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  underenheterBody.appendChild(table);
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

void init();
