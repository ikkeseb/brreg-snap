// The loading skeleton: the loaded layout's geometry with shimmering
// values, so nothing jumps when data lands. Labels are real text. The
// caller marks the surface busy (aria-busy) and inert, and announces
// «Henter …» through the live region.

import type { Surface } from '../trust-view.js';
import { buildAnswerLoading } from './answer.js';
import { el } from './dom.js';

const LEDGER_LABELS: Array<[label: string, value: string, detail?: string]> = [
  ['Kobling', 'sk--l', 'sk--xs'],
  ['Status', 'sk--s'],
  ['Alder', 'sk--s'],
  ['Ansatte', 'sk--xs'],
  ['Regnskap', 'sk--s', 'sk--l'],
];

export function buildSkeleton(surface: Surface): DocumentFragment {
  const frag = document.createDocumentFragment();

  const ident = el('div', 'ident');
  const over = el('p', 'ident__over');
  over.appendChild(el('span', 'sk sk--cap'));
  ident.appendChild(over);
  ident.appendChild(el('span', 'sk sk--name'));
  const line = el('p', 'ident__line');
  line.appendChild(el('span', 'sk sk--orgnr'));
  ident.appendChild(line);
  if (surface === 'popup') {
    const leaders = el('p', 'ident__leaders');
    leaders.appendChild(el('span', 'sk sk--m'));
    ident.appendChild(leaders);
  } else {
    const flags = el('p', 'ident__flags');
    flags.appendChild(el('span', 'sk sk--cap'));
    ident.appendChild(flags);
  }
  frag.appendChild(ident);

  frag.appendChild(buildAnswerLoading());

  const dl = el('dl', 'ledger');
  dl.setAttribute('aria-hidden', 'true');
  for (const [label, value, detail] of LEDGER_LABELS) {
    const row = el('div', 'ledger-row');
    const dt = el('dt');
    dt.appendChild(el('span', 'sk sk--glyph'));
    dt.append(label);
    row.appendChild(dt);
    const dd = el('dd');
    dd.appendChild(el('span', `sk ${value}`));
    if (detail) {
      const d = el('span', 'ledger-row__detail');
      d.appendChild(el('span', `sk ${detail}`));
      dd.appendChild(d);
    }
    row.appendChild(dd);
    dl.appendChild(row);
  }
  frag.appendChild(dl);
  return frag;
}

export function renderSkeleton(container: HTMLElement, surface: Surface): void {
  container.replaceChildren(buildSkeleton(surface));
}
