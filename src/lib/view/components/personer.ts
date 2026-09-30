// The Personer tab (S3): one section per role group. A person is a row
// (name · role, «Avregistrert» struck and muted); an entity holding a
// role (revisor, regnskapsfører, a board member that is a company) is
// a drill-in row into its own dossier.
//   <section class="section"><h3 class="section__head">Styre<span class="tab__count">4</span></h3>
//     <div class="person person--gone"><b>Leif Bakke</b><span class="person__role">Avregistrert</span></div>
//     <button class="entity-row"><b>FJELL &amp; PARTNERE AS</b><small>Org.nr … · åpne</small><svg class="icon"/></button>

import { COPY } from '../copy.js';
import type { PersonGroup, PersonItem } from '../dossier-view.js';
import { button, el, icon, section } from './dom.js';
import type { DrillHandlers } from './oversikt.js';

export function buildEntityRow(
  name: string,
  note: string,
  onOpen: () => void,
  opts: { nameNode?: (b: HTMLElement) => void } = {},
): HTMLButtonElement {
  const btn = button('entity-row');
  const b = el('b');
  if (opts.nameNode) opts.nameNode(b);
  else b.textContent = name;
  btn.appendChild(b);
  if (note) btn.appendChild(el('small', undefined, note));
  btn.appendChild(icon('i-chev'));
  btn.addEventListener('click', onOpen);
  return btn;
}

function buildItem(item: PersonItem, handlers: DrillHandlers): HTMLElement {
  if (item.kind === 'entity') {
    const { orgnr } = item;
    return buildEntityRow(item.name, item.role, () => handlers.onDrill(orgnr));
  }
  const row = el('div', item.gone ? 'person person--gone' : 'person');
  row.appendChild(el('b', undefined, item.name));
  if (item.role) row.appendChild(el('span', 'person__role', item.role));
  return row;
}

export function buildPersoner(groups: PersonGroup[] | 'failed', handlers: DrillHandlers): HTMLElement[] {
  if (groups === 'failed' || groups.length === 0) {
    const sec = section(COPY.tabs.personer);
    sec.appendChild(el('p', 'section__text', groups === 'failed' ? COPY.rollerFailed : COPY.rollerNone));
    return [sec];
  }
  return groups.map((group) => {
    const sec = section(group.title, group.items.length > 1 ? group.count : undefined);
    for (const item of group.items) sec.appendChild(buildItem(item, handlers));
    return sec;
  });
}
