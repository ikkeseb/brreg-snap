// The Enheter tab (S6 + the Konsern section): first the group — the
// path from the top parent down to the company, then its direct
// children (capped, «Vis alle N»), every row a drill-in — then the
// underenheter: name · address · employees · copyable org.nr, a deleted
// one struck with «Slettet <dato>». A list capped by brreg says so
// («Viser 100 av 133 · Se alle på brreg.no ↗»).

import { formatCount } from '../../format.js';
import { COPY } from '../copy.js';
import type { EnheterView, KonsernSection, UnitView } from '../dossier-view.js';
import type { CopyHandlers } from './copy-feedback.js';
import { appendName, button, el, link, section } from './dom.js';
import { buildOrgnrButton } from './identity.js';
import type { DrillHandlers } from './oversikt.js';
import { buildEntityRow } from './personer.js';

export const KONSERN_CHILDREN_SHOWN = 20;

export interface EnheterHandlers extends DrillHandlers, CopyHandlers {}

function buildKonsern(k: KonsernSection, parentName: string, handlers: EnheterHandlers): HTMLElement {
  const sec = section(COPY.konsern, formatCount(k.size));
  const path = el('ul', 'konsern-path');
  k.path.forEach((ref, depth) => {
    const li = el('li');
    li.style.setProperty('--depth', String(Math.min(depth, 4)));
    if (ref.self) {
      const row = el('div', 'entity-row entity-row--self');
      row.appendChild(el('b', undefined, ref.navn));
      row.appendChild(el('small', undefined, ref.note));
      li.appendChild(row);
    } else {
      const { orgnr } = ref;
      li.appendChild(buildEntityRow(ref.navn, ref.note, () => handlers.onDrill(orgnr)));
    }
    path.appendChild(li);
  });
  sec.appendChild(path);

  if (k.children.length > 0) {
    const sub = el('p', 'konsern-sub cap', COPY.datterselskaper);
    sub.appendChild(el('span', 'tab__count', String(k.children.length)));
    sec.appendChild(sub);
    const list = el('ul');
    const hidden: HTMLLIElement[] = [];
    k.children.forEach((child, i) => {
      const li = el('li');
      const { orgnr } = child;
      li.appendChild(
        buildEntityRow(child.navn, child.note, () => handlers.onDrill(orgnr), {
          nameNode: (b) => appendName(b, child.navn, parentName),
        }),
      );
      if (i >= KONSERN_CHILDREN_SHOWN) {
        li.hidden = true;
        hidden.push(li);
      }
      list.appendChild(li);
    });
    sec.appendChild(list);
    if (hidden.length > 0) {
      const wrap = el('p', 'show-all');
      const more = button('text-btn', COPY.showAll(k.children.length));
      more.addEventListener('click', () => {
        for (const li of hidden) li.hidden = false;
        wrap.remove();
      });
      wrap.appendChild(more);
      sec.appendChild(wrap);
    }
  }
  return sec;
}

function buildUnit(unit: UnitView, parentName: string, handlers: CopyHandlers): HTMLLIElement {
  const li = el('li', unit.gone ? 'unit unit--gone' : 'unit');
  const text = el('span');
  const name = el('span', 'unit__name');
  appendName(name, unit.name, parentName);
  text.appendChild(name);
  if (unit.meta) text.appendChild(el('span', 'unit__meta', unit.meta));
  li.appendChild(text);
  li.appendChild(buildOrgnrButton({ digits: unit.orgnr, spaced: unit.spaced }, handlers, { small: true }));
  return li;
}

function buildUnderenheter(view: EnheterView['underenheter'], parentName: string, handlers: CopyHandlers): HTMLElement {
  if (view.kind === 'failed') {
    const sec = section(COPY.underenheter);
    sec.appendChild(el('p', 'section__text', COPY.underenheterFailed));
    return sec;
  }
  const sec = section(COPY.underenheter, formatCount(view.total));
  if (view.items.length === 0) {
    sec.appendChild(el('p', 'section__text', COPY.underenheterNone));
    return sec;
  }
  if (view.total > view.shown) {
    const count = el('p', 'units-count');
    count.append(`${COPY.showing(formatCount(view.shown)!, formatCount(view.total)!)} · `);
    count.appendChild(link(COPY.seeAllAtBrreg, view.allHref, { external: true }));
    sec.appendChild(count);
  }
  const list = el('ul');
  for (const unit of view.items) list.appendChild(buildUnit(unit, parentName, handlers));
  sec.appendChild(list);
  return sec;
}

function buildKonsernFailed(): HTMLElement {
  const sec = section(COPY.konsern);
  sec.appendChild(el('p', 'section__text', COPY.konsernFailed));
  return sec;
}

export function buildEnheter(view: EnheterView, parentName: string, handlers: EnheterHandlers): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (view.konsern) out.push(buildKonsern(view.konsern, parentName, handlers));
  else if (view.konsernFailed) out.push(buildKonsernFailed());
  out.push(buildUnderenheter(view.underenheter, parentName, handlers));
  return out;
}
