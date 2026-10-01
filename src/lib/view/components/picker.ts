// The picker (P5): «Mulige selskaper bak <site>», up to four candidate
// rows with a digit shortcut each, «Ingen av disse» (0), and a
// prefilled «Eller søk selv» field. Digit keys are scoped to the picker:
// one document listener per document, replaced by the next picker
// rendered there, that bails while this picker's list is not in the
// document — detached, not gone: the panel's search view keeps the
// picker aside as live DOM and puts it back on Escape, and the keys
// must work again then. Persisting the choice (setPickerChoice) is the
// controller's job, through the handlers.

import { formatCount } from '../../format.js';
import type { Candidate } from '../../hostname-search.js';
import { MAX_PICKER_CANDIDATES } from '../../hostname-search.js';
import type { ManualSearchController } from '../../ui/manual-search.js';
import { COPY } from '../copy.js';
import { button, el } from './dom.js';
import { buildSearchField, buildStatusMark, statusMarkFor, buildListSection, searchPainter } from './search.js';
import { attachManualSearch } from '../../ui/manual-search.js';

// The digit-key listener of the picker last rendered in each document.
const pickerKeys = new WeakMap<Document, (ev: KeyboardEvent) => void>();

export interface PickerData {
  // The site's display name («nrk.no»).
  site: string;
  candidates: readonly Candidate[];
  // What the search field is prefilled with (the hostname label).
  query: string;
}

export interface PickerHandlers {
  onPick: (orgnr: string) => void;
  onNone: () => void;
  // The «Eller søk selv» field.
  onSearchSelect: (orgnr: string) => void;
  announce: (text: string) => void;
}

export interface Picker {
  heading: HTMLHeadingElement;
  firstRow: HTMLButtonElement;
  input: HTMLInputElement;
  search: ManualSearchController;
}

function buildRow(
  cand: Candidate,
  key: string,
  site: string,
  onPick: () => void,
): HTMLLIElement {
  const li = el('li');
  const btn = button('pick');
  btn.setAttribute('aria-keyshortcuts', key);
  btn.appendChild(el('span', 'kbd', key));
  const text = el('span');
  text.appendChild(el('span', 'pick__name', cand.navn));
  const naering = cand.naeringskode1?.beskrivelse;
  if (naering) text.appendChild(el('span', 'pick__sub', naering));
  btn.appendChild(text);
  const right = el('span', 'pick__right');
  const status = statusMarkFor(cand);
  if (status) {
    right.appendChild(buildStatusMark(status));
  } else if (typeof cand.antallAnsatte === 'number' && cand.antallAnsatte > 0) {
    right.append(COPY.pickAnsatte(formatCount(cand.antallAnsatte)!.replace(/ /g, '\u00a0')));
  }
  // Only the site itself is strong evidence; a page or subdomain on it
  // (an artist page on nrk.no) reads as weak as a name match.
  const strong = cand.evidence === 'hjemmeside';
  const tag = el(
    'span',
    strong ? 'evidence evidence--strong' : 'evidence evidence--weak',
    strong
      ? COPY.evidenceStrong
      : cand.evidence === 'side'
        ? COPY.evidencePage
        : COPY.evidenceWeak,
  );
  if (cand.evidence === 'side') tag.title = COPY.evidencePageTitle(site);
  right.appendChild(tag);
  btn.appendChild(right);
  btn.addEventListener('click', onPick);
  li.appendChild(btn);
  return li;
}

export function renderPicker(
  container: HTMLElement,
  data: PickerData,
  handlers: PickerHandlers,
): Picker {
  container.replaceChildren();
  const candidates = data.candidates.slice(0, MAX_PICKER_CANDIDATES);

  const head = el('div', 'pick-head');
  const heading = el('h1', undefined, COPY.pickHead(data.site));
  head.appendChild(heading);
  // «Ingen har <site> som registrert hjemmeside» is only true when no
  // row has the site itself registered.
  const anyExact = candidates.some((c) => c.evidence === 'hjemmeside');
  head.appendChild(el('p', undefined, anyExact ? COPY.pickSubStrong : COPY.pickSub(data.site)));
  container.appendChild(head);

  const list = el('ol', 'picker');
  candidates.forEach((cand, i) => {
    list.appendChild(
      buildRow(cand, String(i + 1), data.site, () => handlers.onPick(cand.organisasjonsnummer)),
    );
  });
  const noneLi = el('li');
  const none = button('pick pick--none');
  none.setAttribute('aria-keyshortcuts', '0');
  none.appendChild(el('span', 'kbd', '0'));
  none.appendChild(el('span', 'pick__label', COPY.none));
  none.appendChild(el('span'));
  none.addEventListener('click', () => handlers.onNone());
  noneLi.appendChild(none);
  list.appendChild(noneLi);
  container.appendChild(list);

  const searchWrap = el('div', 'pick-search');
  const field = buildSearchField({ large: true, value: data.query, label: COPY.searchYourself });
  searchWrap.appendChild(field.root);
  container.appendChild(searchWrap);
  const results = buildListSection(COPY.results);
  results.section.hidden = true;
  results.list.className = 'results';
  container.appendChild(results.section);
  const search = attachManualSearch({
    inputEl: field.input,
    resultsEl: results.list,
    paint: searchPainter,
    announce: handlers.announce,
    onSelect: (hit) => handlers.onSearchSelect(hit.organisasjonsnummer),
    onQueryActive: () => {
      results.section.hidden = false;
    },
    onQueryCleared: () => {
      results.section.hidden = true;
    },
  });

  // Digit shortcuts: 1–4 pick a row, 0 is «Ingen av disse». Off while
  // typing in a field and with any modifier (OS shortcuts keep
  // working). Escape is left to the browser on purpose: «Ingen av
  // disse» is remembered for the site, and Escape is the reflex key
  // for leaving a popup, not a considered answer.
  const onKey = (ev: KeyboardEvent): void => {
    if (!list.isConnected) return;
    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const target = ev.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    if (ev.key === '0') {
      ev.preventDefault();
      handlers.onNone();
      return;
    }
    const idx = '1234'.indexOf(ev.key);
    if (idx === -1) return;
    const cand = candidates[idx];
    if (!cand) return;
    ev.preventDefault();
    handlers.onPick(cand.organisasjonsnummer);
  };
  const doc = container.ownerDocument;
  const previous = pickerKeys.get(doc);
  if (previous) doc.removeEventListener('keydown', previous);
  doc.addEventListener('keydown', onKey);
  pickerKeys.set(doc, onKey);

  const firstRow = list.querySelector<HTMLButtonElement>('button.pick')!;
  return { heading, firstRow, input: field.input, search };
}
