// The current panel markup and render modules behind the PanelPainter
// seam (view.ts). Everything here is what the redesign replaces: the
// element ids of details.html, the render/* writers, the shared lib/ui
// components (picker, manual search, recents, source label) and the
// checkbox «Auto-oppdater» control. No module-scope lookups: the
// factory reads its elements from the document it is given.

import { formatRelativeTime } from '../lib/format.js';
import { isHostDerived, type ResolutionMethod } from '../lib/resolution-method.js';
import { describeLoadError } from '../lib/ui/error-message.js';
import { attachManualSearch } from '../lib/ui/manual-search.js';
import { createPicker } from '../lib/ui/picker.js';
import { renderRecentSection } from '../lib/ui/recent.js';
import { createSourceLabel } from '../lib/ui/source-label.js';
import { avdelingNote } from '../lib/ui/summary-lines.js';
import type { AutoSyncUi } from './auto-sync-ui.js';
import { renderHeader } from './render/header.js';
import { renderNokkeltall } from './render/nokkeltall.js';
import { renderContact, renderOverview } from './render/overview.js';
import { renderParent } from './render/parent.js';
import { renderRoles } from './render/roles.js';
import { renderUnderenheter } from './render/underenheter.js';
import { setupTabs } from './tabs.js';
import type { PanelIntents, PanelPainter } from './view.js';

const BRREG_LINK_FALLBACK = 'https://virksomhet.brreg.no/nb/oppslag/enheter';

type PanelState = 'loading' | 'result' | 'error' | 'picker' | 'empty';

function byId<T extends HTMLElement = HTMLElement>(doc: Document, id: string): T {
  const el = doc.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

export interface LegacyPainterOptions {
  // The ?tab= to restore on load (history.tabFromUrl()).
  initialTab?: string;
}

export function createLegacyPainter(
  doc: Document,
  intents: PanelIntents,
  opts: LegacyPainterOptions = {},
): PanelPainter {
  const app = byId(doc, 'app');
  const statusEl = byId(doc, 'status');
  const errorActionsEl = byId(doc, 'error-actions');
  const retryLoadBtn = byId<HTMLButtonElement>(doc, 'retry-load');
  const skeletonEl = byId(doc, 'skeleton');
  const resultEl = byId(doc, 'result');
  const nameEl = byId(doc, 'name');
  const avdelingNoteEl = byId(doc, 'avdeling-note');
  const brregLink = byId<HTMLAnchorElement>(doc, 'brreg-link');
  const footerUpdated = byId(doc, 'footer-updated');
  const updatedTime = byId<HTMLTimeElement>(doc, 'updated-time');
  const refreshBtn = byId<HTMLButtonElement>(doc, 'refresh-data');
  const pickerEl = byId(doc, 'picker');
  const emptyStateEl = byId(doc, 'empty-state');
  const emptyMessageEl = byId(doc, 'empty-message');
  const manualQueryEl = byId<HTMLInputElement>(doc, 'manual-query');
  const recentSectionEl = byId(doc, 'recent-section');
  const recentListEl = byId<HTMLUListElement>(doc, 'recent-list');
  const resolutionActionsEl = byId(doc, 'resolution-actions');
  const rejectChoiceBtn = byId<HTMLButtonElement>(doc, 'reject-choice');
  const backBtn = byId<HTMLButtonElement>(doc, 'back-link');

  // When the data on screen was fetched from brreg, not when it was
  // painted: a cache hit can be up to a day old.
  let fetchedAt: number | undefined;
  let updatedTimerId: ReturnType<typeof setInterval> | undefined;

  const sourceLabel = createSourceLabel(byId(doc, 'footer-source'), byId(doc, 'source-host'));

  const picker = createPicker({
    appEl: app,
    listEl: byId<HTMLUListElement>(doc, 'picker-list'),
    noneBtn: byId<HTMLButtonElement>(doc, 'picker-none'),
    onChoose: (host, orgnr) => intents.pick(host, orgnr),
    onNone: (host) => intents.none(host),
  });

  const manualSearch = attachManualSearch({
    inputEl: manualQueryEl,
    resultsEl: byId<HTMLUListElement>(doc, 'manual-results'),
    onSelect: (hit) => intents.manual(hit.organisasjonsnummer),
  });

  const tablistEl = resultEl.querySelector<HTMLElement>('[role="tablist"]');
  if (!tablistEl) throw new Error('Missing tablist in #result');
  const tabs = setupTabs(tablistEl, {
    initial: opts.initialTab,
    onSelect: (key) => intents.selectTab(key),
  });

  // Disabled while the reject flow runs, so a second click can't
  // start it twice.
  rejectChoiceBtn.addEventListener('click', () => {
    if (rejectChoiceBtn.disabled) return;
    rejectChoiceBtn.disabled = true;
    void intents.reject().finally(() => {
      rejectChoiceBtn.disabled = false;
    });
  });
  retryLoadBtn.addEventListener('click', () => intents.retry());
  refreshBtn.addEventListener('click', () => intents.refresh());
  backBtn.addEventListener('click', () => intents.back());

  function setState(state: PanelState): void {
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
    // error() unhides this when a retry target exists.
    errorActionsEl.hidden = true;
    resultEl.hidden = state !== 'result';
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

  function setBrregLink(orgnr?: string): void {
    brregLink.href = orgnr
      ? `https://virksomhet.brreg.no/nb/oppslag/enheter/${orgnr}`
      : BRREG_LINK_FALLBACK;
  }

  // «Feil bedrift?» only for a company derived from the site on screen.
  function setProvenance(method: ResolutionMethod | undefined, host: string | undefined): void {
    sourceLabel.set(host);
    resolutionActionsEl.hidden = !(isHostDerived(method) && host);
  }

  function markFetched(at: number): void {
    fetchedAt = at;
    footerUpdated.hidden = false;
    paintFetchedLabel();
    // Repaint the relative label every 30s so "akkurat nå" → "for 1 min
    // siden" transitions don't look stuck.
    if (updatedTimerId !== undefined) clearInterval(updatedTimerId);
    updatedTimerId = setInterval(paintFetchedLabel, 30_000);
  }

  function paintFetchedLabel(): void {
    if (fetchedAt === undefined) return;
    updatedTime.dateTime = new Date(fetchedAt).toISOString();
    updatedTime.textContent = formatRelativeTime(fetchedAt);
  }

  return {
    loading(orgnr): void {
      setBrregLink(orgnr);
      setState('loading');
      statusEl.textContent = `Henter ${orgnr}…`;
    },

    result({ company, method, host, isStale, fetchedAt: at, focus }): void {
      const { enhet, avdeling, roller, underenheter, regnskap } = company;
      // For an underenhet that is the parent — the company on screen.
      setBrregLink(enhet.organisasjonsnummer);
      renderHeader(enhet, regnskap);
      avdelingNoteEl.hidden = !avdeling;
      avdelingNoteEl.textContent = avdeling ? avdelingNote(avdeling) : '';
      renderOverview(enhet, roller);
      renderContact(enhet);
      renderRoles(roller, intents.drill);
      // renderParent fetches after painting; isStale guards its late write.
      void renderParent(enhet.overordnetEnhet, intents.drill, isStale);
      renderUnderenheter(underenheter);
      renderNokkeltall(regnskap, enhet);
      setState('result');
      setProvenance(method, host);
      markFetched(at);
      if (focus === 'heading') nameEl.focus();
      else if (focus === 'refresh') refreshBtn.focus();
    },

    provenance({ method, host }): void {
      setProvenance(method, host);
    },

    picker(host, candidates): void {
      setState('picker');
      sourceLabel.set(host);
      setBrregLink();
      picker.render(host, candidates);
    },

    empty({ host, degraded, query, focus }): void {
      setState('empty');
      setBrregLink();
      sourceLabel.set(host);
      emptyMessageEl.textContent = degraded
        ? `Fikk ikke svar fra Brønnøysundregistrene, så ${host ?? 'siden'} kunne ikke sjekkes. Prøv igjen om litt.`
        : query !== undefined
          ? 'Søk i Brønnøysundregistrene etter teksten du markerte:'
          : host
            ? `Ingen bedrift identifisert på ${host}. Søk for å finne riktig bedrift.`
            : 'Sidepanelet ble åpnet uten en bedrift å vise. Søk i Brønnøysundregistrene under.';
      manualSearch.reset();
      if (query !== undefined) manualSearch.search(query);
      void renderRecentSection(recentSectionEl, recentListEl, (entry) => {
        intents.recent(entry.orgnr);
      });
      if (focus) manualQueryEl.focus();
    },

    error(err, { retry }): void {
      setState('error');
      statusEl.textContent = describeLoadError(err);
      errorActionsEl.hidden = !retry;
    },

    setBack(visible): void {
      backBtn.hidden = !visible;
    },

    selectTab(key): void {
      tabs.activateByKey(key);
    },
  };
}

// The checkbox «Auto-oppdater» control, its consent box and status
// line, as the AutoSyncUi the toggle logic binds to.
export function createCheckboxAutoSyncUi(doc: Document): AutoSyncUi {
  const toggle = byId<HTMLInputElement>(doc, 'auto-sync-toggle');
  const consentEl = byId(doc, 'auto-sync-consent');
  const acceptBtn = byId<HTMLButtonElement>(doc, 'auto-sync-consent-accept');
  const cancelBtn = byId<HTMLButtonElement>(doc, 'auto-sync-consent-cancel');
  const statusEl = byId(doc, 'auto-sync-status');
  return {
    get checked() {
      return toggle.checked;
    },
    set checked(value: boolean) {
      toggle.checked = value;
    },
    get disabled() {
      return toggle.disabled;
    },
    set disabled(value: boolean) {
      toggle.disabled = value;
    },
    focus: () => toggle.focus(),
    onChange: (fn) => toggle.addEventListener('change', fn),
    showConsent(show): void {
      consentEl.hidden = !show;
      if (show) acceptBtn.focus();
    },
    onConsentAccept: (fn) => acceptBtn.addEventListener('click', fn),
    onConsentCancel(fn): void {
      cancelBtn.addEventListener('click', fn);
      consentEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') fn();
      });
    },
    showStatus(message): void {
      if (!message) {
        statusEl.hidden = true;
        statusEl.textContent = '';
        return;
      }
      statusEl.hidden = false;
      statusEl.textContent = message;
    },
  };
}
