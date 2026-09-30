// Debounced manual search shared by the popup and the sidebar empty
// states: 250ms debounce, monotonic runId so out-of-order responses
// drop, min 2 chars, capped to 100 before reaching brreg.
//
// The placeholder promises «Bedriftsnavn eller 9-sifret orgnr», and
// brreg's name search can't keep the second half: navn=923609016 has
// no hits, and "923 609 016" fuzzy-matches unrelated names. So an
// orgnr-shaped query is looked up directly instead (lookupOrgnr), which
// also finds an underenhet and shows it with its parent.
//
// The lookups THROW on network/HTTP failure (they do not silently
// return []). Failures render INLINE in the results container with a
// "Prøv igjen" retry — never a full panel error state, which would
// rip the input away from under the user mid-typing.
//
// Result rows are real <button>s (keyboard-operable for free), and the
// result count is announced through a visually-hidden aria-live region
// so screen-reader users hear "5 treff" instead of silence.

import { searchEnheter } from '../brreg.js';
import {
  DeletedAvdelingError,
  isNotFoundError,
  lookupOrgnr,
} from '../company-load.js';
import { isValidOrgnr } from '../mod11.js';
import type { SearchHit } from '../../types/brreg.js';
import { appendHitSummary } from './hit-row.js';

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const RESULT_SIZE = 10;

export type OrgnrQuery =
  | { kind: 'orgnr'; orgnr: string }
  // Nine digits that fail the check digit: a typo, not a name.
  | { kind: 'invalid'; digits: string };

// An orgnr the way people paste it: "923609016", "923 609 016",
// "923.609.016", with non-breaking spaces from a rendered footer, the
// MVA form "NO 923 609 016 MVA", or behind the label a site footer
// prints ("Org.nr. 923 609 016", "Org nr: …", "Orgnr …", any case).
// Undefined for anything else, which is searched as a name.
export function parseOrgnrQuery(query: string): OrgnrQuery | undefined {
  const m = /^(?:org\.?\s*nr\.?:?)?\s*(?:NO)?([\d\s.]+?)(?:MVA)?$/i.exec(
    query.trim(),
  );
  if (!m) return undefined;
  const digits = m[1]!.replace(/[\s.]/g, '');
  if (!/^\d{9}$/.test(digits)) return undefined;
  return isValidOrgnr(digits)
    ? { kind: 'orgnr', orgnr: digits }
    : { kind: 'invalid', digits };
}

// What one search paints: selectable hits, or a single line of text.
type SearchRows =
  | { kind: 'hits'; hits: Array<{ hit: SearchHit; avdelingAv?: string }> }
  | { kind: 'note'; text: string };

async function findByOrgnr(orgnr: string): Promise<SearchRows> {
  try {
    const { enhet, avdeling } = await lookupOrgnr(orgnr);
    if (!avdeling) return { kind: 'hits', hits: [{ hit: enhet }] };
    // Selecting the branch loads its own orgnr: the load falls back to
    // the parent the same way and notes which branch it came from.
    const hit: SearchHit = {
      organisasjonsnummer: avdeling.organisasjonsnummer,
      navn: avdeling.navn,
      naeringskode1: avdeling.naeringskode1,
    };
    return { kind: 'hits', hits: [{ hit, avdelingAv: enhet.navn }] };
  } catch (err) {
    if (err instanceof DeletedAvdelingError) {
      return {
        kind: 'note',
        text: `${orgnr} er underenheten ${err.avdeling.navn}, som er slettet.`,
      };
    }
    if (isNotFoundError(err)) {
      return {
        kind: 'note',
        text: `Fant ingen enhet med organisasjonsnummer ${orgnr}.`,
      };
    }
    throw err;
  }
}

async function find(query: string): Promise<SearchRows> {
  const parsed = parseOrgnrQuery(query);
  if (parsed?.kind === 'invalid') {
    return {
      kind: 'note',
      text: `${parsed.digits} er ikke et gyldig organisasjonsnummer.`,
    };
  }
  if (parsed) return findByOrgnr(parsed.orgnr);
  const results = await searchEnheter(query, RESULT_SIZE);
  if (results.length === 0) return { kind: 'note', text: 'Ingen treff.' };
  return { kind: 'hits', hits: results.map((hit) => ({ hit })) };
}

// How one search's rows are painted. The default paints the 1.3
// markup (li > button.manual-hit); the 1.4 components pass their own
// (src/lib/view/components/search.ts). Each method returns the <li>.
export interface SearchPainter {
  hit(hit: SearchHit, onSelect: () => void, opts: { avdelingAv?: string }): HTMLElement;
  note(text: string): HTMLElement;
  error(text: string, retry: () => void): HTMLElement;
}

export const defaultPainter: SearchPainter = {
  hit(hit, onSelect, opts) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'manual-hit';
    appendHitSummary(btn, hit, opts);
    btn.addEventListener('click', onSelect);
    li.appendChild(btn);
    return li;
  },
  note(text) {
    const li = document.createElement('li');
    li.className = 'empty-result';
    li.textContent = text;
    return li;
  },
  error(text, retry) {
    const li = document.createElement('li');
    li.className = 'search-error';
    const msg = document.createElement('span');
    msg.textContent = text;
    li.appendChild(msg);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'retry-button';
    btn.textContent = 'Prøv igjen';
    btn.addEventListener('click', retry);
    li.appendChild(btn);
    return li;
  },
};

export interface ManualSearchOptions {
  inputEl: HTMLInputElement;
  resultsEl: HTMLUListElement;
  onSelect: (hit: SearchHit) => void;
  // Row markup; the default is the 1.3 markup above.
  paint?: SearchPainter;
  // Where result counts are announced. Given: the surface's one live
  // region (src/lib/view/components/live.ts). Omitted: a region of its
  // own is inserted after the results list.
  announce?: (text: string) => void;
  // Query dropped below the minimum length and the results were
  // cleared — the popup uses this to restore its recents list.
  onQueryCleared?: () => void;
  // Query is long enough to search — the popup hides its recents so
  // search results don't share airspace with stale entries.
  onQueryActive?: () => void;
}

export interface ManualSearchController {
  // Clear input + results, cancel any pending debounce, and bump the
  // runId so an in-flight response can't paint into a fresh state.
  reset(): void;
  // Put `query` in the input and search for it now, no debounce — the
  // panel's selection lookup («Slå opp «…» i brreg-snap»). Same rules
  // as typing: min length, capped, newer input wins.
  search(query: string): void;
}

function ownLiveRegion(after: HTMLElement): (text: string) => void {
  const liveRegion = document.createElement('div');
  liveRegion.className = 'visually-hidden';
  liveRegion.setAttribute('aria-live', 'polite');
  after.insertAdjacentElement('afterend', liveRegion);
  return (text: string) => {
    liveRegion.textContent = text;
  };
}

export function attachManualSearch(
  opts: ManualSearchOptions,
): ManualSearchController {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let runId = 0;
  const paint = opts.paint ?? defaultPainter;

  // aria-live region for result-count announcements, unless the
  // surface routes them through its own.
  const announce: (text: string) => void = opts.announce ?? ownLiveRegion(opts.resultsEl);

  function schedule(delayMs: number): void {
    if (timer) clearTimeout(timer);
    timer = undefined;
    runId += 1;
    const value = opts.inputEl.value.trim();
    if (value.length < MIN_QUERY_LENGTH) {
      opts.resultsEl.replaceChildren();
      announce('');
      opts.onQueryCleared?.();
      return;
    }
    opts.onQueryActive?.();
    const capped = value.slice(0, MAX_QUERY_LENGTH);
    if (delayMs === 0) {
      void run(capped);
      return;
    }
    timer = setTimeout(() => {
      void run(capped);
    }, delayMs);
  }

  opts.inputEl.addEventListener('input', () => {
    schedule(DEBOUNCE_MS);
  });

  async function run(query: string): Promise<void> {
    const myRunId = ++runId;
    try {
      const rows = await find(query);
      if (myRunId !== runId) return;
      opts.resultsEl.replaceChildren();
      if (rows.kind === 'note') {
        opts.resultsEl.appendChild(paint.note(rows.text));
        announce(rows.text);
        return;
      }
      for (const { hit, avdelingAv } of rows.hits) {
        opts.resultsEl.appendChild(
          paint.hit(hit, () => opts.onSelect(hit), avdelingAv ? { avdelingAv } : {}),
        );
      }
      const n = rows.hits.length;
      announce(n === 1 ? '1 treff.' : `${n} treff.`);
    } catch {
      if (myRunId !== runId) return;
      renderSearchError(query);
    }
  }

  function renderSearchError(query: string): void {
    opts.resultsEl.replaceChildren();
    opts.resultsEl.appendChild(
      paint.error('Søket feilet.', () => {
        void run(query);
      }),
    );
    announce('Søket feilet.');
  }

  return {
    reset(): void {
      opts.inputEl.value = '';
      opts.resultsEl.replaceChildren();
      announce('');
      runId += 1;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    search(query: string): void {
      opts.inputEl.value = query;
      schedule(0);
    },
  };
}
