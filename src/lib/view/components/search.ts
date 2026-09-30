// Search + empty state + recents (P6): the search field, the manual-
// search rows (the debounce, the orgnr shortcut and the error handling
// stay in src/lib/ui/manual-search.ts — this file only paints), and the
// «Nylig sett» list from src/lib/ui/recent.ts.

import { formatOrgnr } from '../../format.js';
import { primaryStatusFlag } from '../../ui/flags.js';
import {
  attachManualSearch,
  type ManualSearchController,
  type SearchPainter,
} from '../../ui/manual-search.js';
import type { RecentEntry } from '../../ui/recent.js';
import type { SearchHit } from '../../../types/brreg.js';
import { COPY } from '../copy.js';
import { button, el, glyph, icon, uniqueId } from './dom.js';

const NBSP = '\u00a0';
const spaced = (digits: string): string => formatOrgnr(digits).replace(/ /g, NBSP);

export interface SearchFieldData {
  value?: string;
  placeholder?: string;
  large?: boolean;
  // A visible <label class="field-label"> above the field («Eller søk
  // selv»); without it the input carries an aria-label.
  label?: string;
}

export interface SearchField {
  // The wrapper (the field-label, when any, plus the box).
  root: DocumentFragment;
  box: HTMLLabelElement;
  input: HTMLInputElement;
}

export function buildSearchField(data: SearchFieldData = {}): SearchField {
  const root = document.createDocumentFragment();
  const box = el('label', data.large ? 'search search--lg' : 'search');
  box.appendChild(icon('i-search'));
  const input = el('input');
  input.type = 'search';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = data.placeholder ?? COPY.searchPlaceholder;
  if (data.value) input.value = data.value;
  if (data.label) {
    input.id = uniqueId('search');
    const label = el('label', 'field-label', data.label);
    label.htmlFor = input.id;
    root.appendChild(label);
    // The box is a <label> too; point it at the input explicitly so the
    // two labels don't nest their accessible names.
    box.htmlFor = input.id;
  } else {
    input.setAttribute('aria-label', data.placeholder ?? COPY.searchPlaceholder);
  }
  box.appendChild(input);
  root.appendChild(box);
  return { root, box, input };
}

// A danger status worth a mark next to a name («Konkurs», «Slettet»).
export function statusMarkFor(hit: SearchHit): string | undefined {
  const flag = primaryStatusFlag(hit);
  return flag.severity === 'danger' ? flag.label : undefined;
}

export function buildStatusMark(label: string): HTMLSpanElement {
  const mark = el('span', 'status-mark');
  mark.appendChild(glyph('danger'));
  mark.append(label);
  return mark;
}

// One row in a result or recents list: name (with an optional status
// mark and sub line) on the left, the org.nr on the right.
export function buildEntryRow(
  entry: { name: string; orgnr: string; sub?: string; status?: string },
  onSelect: () => void,
): HTMLLIElement {
  const li = el('li');
  const btn = button('recent');
  const left = el('span', 'recent__name');
  left.appendChild(el('b', undefined, entry.name));
  if (entry.status) left.appendChild(buildStatusMark(entry.status));
  if (entry.sub) left.appendChild(el('span', 'recent__sub', entry.sub));
  btn.appendChild(left);
  btn.appendChild(el('span', 'recent__on', spaced(entry.orgnr)));
  btn.addEventListener('click', onSelect);
  li.appendChild(btn);
  return li;
}

export const searchPainter: SearchPainter = {
  hit(hit, onSelect, opts) {
    const row = {
      name: opts.avdelingAv ? `${hit.navn}${COPY.avdelingAv(opts.avdelingAv)}` : hit.navn,
      orgnr: hit.organisasjonsnummer,
      ...(hit.naeringskode1?.beskrivelse ? { sub: hit.naeringskode1.beskrivelse } : {}),
    };
    const status = statusMarkFor(hit);
    return buildEntryRow(status ? { ...row, status } : row, onSelect);
  },
  note(text) {
    return el('li', 'results__note', text);
  },
  error(text, retry) {
    const li = el('li', 'results__note');
    li.append(`${text} `);
    const btn = button('text-btn', COPY.retry);
    btn.addEventListener('click', retry);
    li.appendChild(btn);
    return li;
  },
};

export interface ListSection {
  section: HTMLElement;
  list: HTMLUListElement;
}

// <section class="section"><h3 class="section__head">…</h3><ul/></section>
export function buildListSection(head: string): ListSection {
  const section = el('section', 'section');
  section.appendChild(el('h3', 'section__head', head));
  const list = el('ul');
  section.appendChild(list);
  return { section, list };
}

export function renderRecents(
  target: ListSection,
  entries: readonly RecentEntry[],
  onSelect: (entry: RecentEntry) => void,
): void {
  target.list.replaceChildren();
  target.section.hidden = entries.length === 0;
  for (const entry of entries) {
    target.list.appendChild(
      buildEntryRow(
        { name: entry.navn, orgnr: entry.orgnr, ...(entry.status ? { status: entry.status } : {}) },
        () => onSelect(entry),
      ),
    );
  }
}

export interface SearchViewData {
  head: string;
  text?: string;
  // Prefilled query (searched at once).
  query?: string;
  hint?: boolean;
  recents: readonly RecentEntry[];
  // «Glem valget for <site>» under the text.
  forgetSite?: string;
  // «Tilbake …» above the head, when the view was opened over another.
  back?: string;
  // Anything to show between the search block and the lists (the
  // degraded state's error band).
  after?: readonly Node[];
}

export interface SearchViewHandlers {
  onSelect: (orgnr: string) => void;
  announce: (text: string) => void;
  onForget?: () => void;
  onBack?: () => void;
}

export interface SearchView {
  input: HTMLInputElement;
  heading: HTMLHeadingElement;
  back?: HTMLButtonElement;
  results: ListSection;
  recents: ListSection;
  search: ManualSearchController;
}

export function renderSearchView(
  container: HTMLElement,
  data: SearchViewData,
  handlers: SearchViewHandlers,
): SearchView {
  container.replaceChildren();
  let back: HTMLButtonElement | undefined;
  if (data.back) {
    back = button('back');
    back.appendChild(icon('i-back'));
    back.appendChild(el('b', undefined, data.back));
    back.addEventListener('click', () => handlers.onBack?.());
    container.appendChild(back);
  }

  const empty = el('div', 'empty');
  const heading = el('h1', undefined, data.head);
  empty.appendChild(heading);
  if (data.text) empty.appendChild(el('p', undefined, data.text));
  if (data.forgetSite) {
    const p = el('p', 'empty__undo');
    const forget = button('text-btn', COPY.forgetSite(data.forgetSite));
    forget.addEventListener('click', () => handlers.onForget?.());
    p.appendChild(forget);
    empty.appendChild(p);
  }
  const field = buildSearchField({ large: true, ...(data.query ? { value: data.query } : {}) });
  empty.appendChild(field.root);
  if (data.hint) empty.appendChild(el('p', 'hint', COPY.searchHint));
  container.appendChild(empty);

  for (const node of data.after ?? []) container.appendChild(node);

  const results = buildListSection(COPY.results);
  results.section.hidden = true;
  results.list.className = 'results';
  container.appendChild(results.section);

  const recents = buildListSection(COPY.recents);
  renderRecents(recents, data.recents, (entry) => handlers.onSelect(entry.orgnr));
  container.appendChild(recents.section);

  const search = attachManualSearch({
    inputEl: field.input,
    resultsEl: results.list,
    paint: searchPainter,
    announce: handlers.announce,
    onSelect: (hit) => handlers.onSelect(hit.organisasjonsnummer),
    // A query on screen owns the list area: the recents step aside so
    // stale entries never share airspace with results.
    onQueryActive: () => {
      results.section.hidden = false;
      recents.section.hidden = true;
    },
    onQueryCleared: () => {
      results.section.hidden = true;
      recents.section.hidden = data.recents.length === 0;
    },
  });
  if (data.query) search.search(data.query);

  const view: SearchView = { input: field.input, heading, results, recents, search };
  if (back) view.back = back;
  return view;
}
