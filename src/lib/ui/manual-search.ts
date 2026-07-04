// Debounced manual search shared by the popup and the sidebar empty
// states: 250ms debounce, monotonic runId so out-of-order responses
// drop, min 2 chars, capped to 100 before reaching brreg.
//
// searchEnheter THROWS on network/HTTP failure (it does not silently
// return []). Failures render INLINE in the results container with a
// "Prøv igjen" retry — never a full panel error state, which would
// rip the input away from under the user mid-typing.
//
// Result rows are real <button>s (keyboard-operable for free), and the
// result count is announced through a visually-hidden aria-live region
// so screen-reader users hear "5 treff" instead of silence.

import { searchEnheter } from '../brreg.js';
import type { SearchHit } from '../../types/brreg.js';
import { appendHitSummary } from './hit-row.js';

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const RESULT_SIZE = 10;

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
      const results = await searchEnheter(query, RESULT_SIZE);
      if (myRunId !== runId) return;
      opts.resultsEl.replaceChildren();
      if (results.length === 0) {
        const li = document.createElement('li');
        li.className = 'empty-result';
        li.textContent = 'Ingen treff.';
        opts.resultsEl.appendChild(li);
        announce('Ingen treff.');
        return;
      }
      for (const hit of results) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'manual-hit';
        appendHitSummary(btn, hit);
        btn.addEventListener('click', () => opts.onSelect(hit));
        li.appendChild(btn);
        opts.resultsEl.appendChild(li);
      }
      announce(results.length === 1 ? '1 treff.' : `${results.length} treff.`);
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
