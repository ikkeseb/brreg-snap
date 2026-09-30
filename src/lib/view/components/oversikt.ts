// The Oversikt tab: Registrering · Ledelse · Kontakt as definition
// lists (dossier-view.ts builds the rows). A row's value is plain
// lines, a link (hjemmeside, e-post) or a drill-in into another
// registered entity (revisor, overordnet enhet).
//   <section class="section"><h3 class="section__head">Registrering</h3>
//     <dl><div class="def-row"><dt>Stiftet</dt><dd>18. sep. 1972</dd></div>

import { COPY } from '../copy.js';
import type { DefRow, DossierView } from '../dossier-view.js';
import { button, el, link, section, uniqueId } from './dom.js';

export interface DrillHandlers {
  onDrill: (orgnr: string) => void;
}

export function buildDefRow(row: DefRow, handlers: DrillHandlers): HTMLDivElement {
  const div = el('div', 'def-row');
  div.appendChild(el('dt', undefined, row.label));
  const dd = el('dd');
  if (row.drill) {
    const btn = button('ent', row.drill.text);
    const { orgnr } = row.drill;
    btn.addEventListener('click', () => handlers.onDrill(orgnr));
    dd.appendChild(btn);
  } else if (row.link) {
    dd.appendChild(link(row.link.text, row.link.href, { className: 'ent', external: row.link.external }));
  } else if (row.clamp) {
    dd.appendChild(buildClamp(row.lines ?? []));
  } else {
    (row.lines ?? []).forEach((line, i) => {
      if (i > 0) dd.appendChild(el('br'));
      dd.append(line);
    });
  }
  if (row.sub) {
    dd.append(' ');
    dd.appendChild(el('span', 'def-row__sub', row.sub));
  }
  div.appendChild(dd);
  return div;
}

// A long value clamped to CLAMP_LINES (CSS line-clamp on .clamp) with a
// «Vis mer» / «Vis mindre» text button that owns the state
// (aria-expanded, aria-controls). The button appears only when the
// text actually runs past the clamp: that is measured, not guessed,
// once the element has a layout — a ResizeObserver fires when it is
// first laid out (a tab panel can be hidden at build time) and on
// every width change. Without ResizeObserver (tests) the button stays
// hidden and the clamp is CSS alone.
//   <div class="clamp-wrap"><p class="clamp" id="clamp-3">…</p>
//   <button class="text-btn clamp__btn" aria-expanded="false" aria-controls="clamp-3" hidden>Vis mer
export function buildClamp(lines: readonly string[]): HTMLDivElement {
  const wrap = el('div', 'clamp-wrap');
  const text = el('p', 'clamp');
  text.id = uniqueId('clamp');
  lines.forEach((line, i) => {
    if (i > 0) text.appendChild(el('br'));
    text.append(line);
  });
  const btn = button('text-btn clamp__btn', COPY.showMore);
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', text.id);
  btn.hidden = true;
  btn.addEventListener('click', () => {
    const open = !text.classList.contains('is-open');
    text.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? COPY.showLess : COPY.showMore;
  });
  wrap.append(text, btn);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (text.classList.contains('is-open')) return;
      btn.hidden = text.scrollHeight <= text.clientHeight;
    }).observe(text);
  }
  return wrap;
}

export function buildDefs(rows: readonly DefRow[], handlers: DrillHandlers): HTMLDListElement {
  const dl = el('dl');
  for (const row of rows) dl.appendChild(buildDefRow(row, handlers));
  return dl;
}

function defSection(head: string, rows: readonly DefRow[], handlers: DrillHandlers): HTMLElement | undefined {
  if (rows.length === 0) return undefined;
  const sec = section(head);
  sec.appendChild(buildDefs(rows, handlers));
  return sec;
}

export function buildOversikt(dossier: DossierView, handlers: DrillHandlers): HTMLElement[] {
  return [
    defSection(COPY.registrering, dossier.registrering, handlers),
    defSection(COPY.ledelse, dossier.ledelse, handlers),
    defSection(COPY.kontakt, dossier.kontakt, handlers),
  ].filter((s): s is HTMLElement => s !== undefined);
}
