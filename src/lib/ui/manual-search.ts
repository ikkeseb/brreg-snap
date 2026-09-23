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

export interface ManualSearchOptions {
  inputEl: HTMLInputElement;
  resultsEl: HTMLUListElement;
  onSelect: (hit: SearchHit) => void;
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
}

export function attachManualSearch(
  opts: ManualSearchOptions,
): ManualSearchController {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let runId = 0;

  // aria-live region for result-count announcements. Created here
  // (not in the HTML) so every surface using the component gets it.
  const liveRegion = document.createElement('div');
  liveRegion.className = 'visually-hidden';
  liveRegion.setAttribute('aria-live', 'polite');
  opts.resultsEl.insertAdjacentElement('afterend', liveRegion);

  function announce(text: string): void {
    liveRegion.textContent = text;
  }

  opts.inputEl.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
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
    timer = setTimeout(() => {
      void run(capped);
    }, DEBOUNCE_MS);
  });

  async function run(query: string): Promise<void> {
    const myRunId = ++runId;
    try {
      const rows = await find(query);
      if (myRunId !== runId) return;
      opts.resultsEl.replaceChildren();
      if (rows.kind === 'note') {
        const li = document.createElement('li');
        li.className = 'empty-result';
        li.textContent = rows.text;
        opts.resultsEl.appendChild(li);
        announce(rows.text);
        return;
      }
      for (const { hit, avdelingAv } of rows.hits) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'manual-hit';
        appendHitSummary(btn, hit, { avdelingAv });
        btn.addEventListener('click', () => opts.onSelect(hit));
        li.appendChild(btn);
        opts.resultsEl.appendChild(li);
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
    const li = document.createElement('li');
    li.className = 'search-error';
    const msg = document.createElement('span');
    msg.textContent = 'Søket feilet.';
    li.appendChild(msg);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'retry-button';
    retry.textContent = 'Prøv igjen';
    retry.addEventListener('click', () => {
      void run(query);
    });
    li.appendChild(retry);
    opts.resultsEl.appendChild(li);
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
  };
}
