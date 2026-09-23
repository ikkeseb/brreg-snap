// Shared picker UI ("Vi fant flere mulige treff…") for the popup and
// the sidebar: candidate list rendering, the "Ingen av disse" button,
// the digit-shortcut keydown handler, and the "Feil bedrift?" reject
// flow. Surface-specific side effects (URL params, load tokens, panel
// messages) stay in the callers via callbacks.

import {
  addRejectedChoice,
  MAX_PICKER_CANDIDATES,
  searchByHostnameDetailed,
  setPickerChoice,
} from '../hostname-search.js';
import type { SearchHit } from '../../types/brreg.js';
import { appendHitSummary } from './hit-row.js';

export interface PickerOptions {
  // Root element whose data-state gates the digit shortcuts — the
  // keydown handler bails unless data-state === 'picker'.
  appEl: HTMLElement;
  listEl: HTMLUListElement;
  noneBtn: HTMLButtonElement;
  // Called after the positive choice has been persisted via
  // setPickerChoice — the caller loads the orgnr.
  onChoose: (host: string, orgnr: string) => void;
  // Called after the negative choice ("Ingen av disse") has been
  // persisted — the caller shows its empty state.
  onNone: (host: string) => void;
}

export interface PickerController {
  render(host: string, candidates: SearchHit[]): void;
  // Drop candidate state so a stray keydown can't fire onChoose on a
  // previous host's list. Call when leaving the picker state.
  clear(): void;
}

export function createPicker(opts: PickerOptions): PickerController {
  // Picker state held at controller scope so the document-level
  // keydown handler can look up which candidate maps to keys 1-4
  // without re-reading the DOM.
  let currentHost: string | undefined;
  let currentCandidates: SearchHit[] = [];

  async function choose(host: string, orgnr: string): Promise<void> {
    await setPickerChoice(host, orgnr);
    opts.onChoose(host, orgnr);
  }

  async function none(host: string): Promise<void> {
    await setPickerChoice(host, null);
    opts.onNone(host);
  }

  opts.noneBtn.addEventListener('click', () => {
    if (!currentHost) return;
    void none(currentHost);
  });

  // Keyboard shortcuts when the picker is active: digits 1-4 pick the
  // corresponding row, 0 triggers "Ingen av disse". Bail when the
  // picker isn't visible or when the user is typing into a form control
  // (no inputs in picker state today, but defensive against future
  // additions). Modifier keys also bail so OS shortcuts (cmd+w, ctrl+a)
  // keep working.
  //
  // Escape is deliberately NOT a shortcut. "Ingen av disse" is stored
  // for the host (24h, no undo in the UI), and Escape is the reflex key
  // for getting out of a popup, not a considered answer. It is left to
  // the browser, and nothing is persisted.
  document.addEventListener('keydown', (ev) => {
    if (opts.appEl.dataset.state !== 'picker') return;
    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const target = ev.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    const host = currentHost;
    if (!host) return;
    if (ev.key === '0') {
      ev.preventDefault();
      void none(host);
      return;
    }
    const idx = '1234'.indexOf(ev.key);
    if (idx === -1) return;
    const cand = currentCandidates[idx];
    if (!cand) return;
    ev.preventDefault();
    void choose(host, cand.organisasjonsnummer);
  });

  return {
    render(host: string, candidates: SearchHit[]): void {
      currentHost = host;
      currentCandidates = candidates.slice(0, MAX_PICKER_CANDIDATES);
      opts.listEl.replaceChildren();
      currentCandidates.forEach((cand, idx) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'picker-item';
        btn.addEventListener('click', () => {
          void choose(host, cand.organisasjonsnummer);
        });
        appendHitSummary(btn, cand, { includeAnsatte: true });
        // Surface the existing 1-4 digit shortcuts: a small <kbd>
        // badge on the row (decorative — the shortcut itself is
        // exposed via aria-keyshortcuts).
        if (idx < 4) {
          const key = String(idx + 1);
          btn.setAttribute('aria-keyshortcuts', key);
          const badge = document.createElement('kbd');
          badge.className = 'picker-key';
          badge.setAttribute('aria-hidden', 'true');
          badge.textContent = key;
          btn.appendChild(badge);
        }
        li.appendChild(btn);
        opts.listEl.appendChild(li);
      });
    },
    clear(): void {
      currentHost = undefined;
      currentCandidates = [];
    },
  };
}

export interface RejectChoiceOptions {
  buttonEl: HTMLButtonElement;
  // Current host + orgnr at click time. Either missing → no-op.
  getContext: () => { host?: string; orgnr?: string };
  // The panel's load token (panel-follow.ts), claimed on the click. A
  // tab event or sync that starts during the write and the search then
  // wins over this flow's late picker. The popup has nothing else that
  // paints meanwhile and passes none.
  claim?: () => { isStale(): boolean };
  showPicker: (host: string, candidates: SearchHit[]) => void;
  showEmptyState: (host: string) => void;
}

// "Feil bedrift? Vis alternativer" — records the rejection, re-runs
// the host resolution, and re-opens the picker (or falls through to
// the empty state when nothing plausible is left).
export function setupRejectChoice(opts: RejectChoiceOptions): void {
  const { buttonEl } = opts;

  async function handle(): Promise<void> {
    const { host, orgnr } = opts.getContext();
    if (!host || !orgnr) return;
    const run = opts.claim?.();
    buttonEl.disabled = true;
    try {
      // The rejection is stored either way; only the paint is dropped.
      await addRejectedChoice(host, orgnr);
      if (run?.isStale()) return;
      const detailed = await searchByHostnameDetailed(host);
      if (run?.isStale()) return;
      if (detailed && detailed.candidates.length > 0) {
        // Always show picker (even if a single candidate now wins
        // band='auto') — the user just expressed doubt; let them confirm.
        opts.showPicker(host, detailed.candidates);
        return;
      }
      opts.showEmptyState(host);
    } finally {
      buttonEl.disabled = false;
    }
  }

  buttonEl.addEventListener('click', () => {
    if (buttonEl.disabled) return;
    void handle();
  });
}
