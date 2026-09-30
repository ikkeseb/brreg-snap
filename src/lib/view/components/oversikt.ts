// The Oversikt tab: Registrering · Ledelse · Kontakt as definition
// lists (dossier-view.ts builds the rows). A row's value is plain
// lines, a link (hjemmeside, e-post) or a drill-in into another
// registered entity (revisor, overordnet enhet).
//   <section class="section"><h3 class="section__head">Registrering</h3>
//     <dl><div class="def-row"><dt>Stiftet</dt><dd>18. sep. 1972</dd></div>

import { COPY } from '../copy.js';
import type { DefRow, DossierView } from '../dossier-view.js';
import { button, el, link, section } from './dom.js';

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
