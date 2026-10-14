// The Økonomi tab: the latest filing's figures with their currency,
// the equity share as a proportion bar (width through the CSSOM, never
// a style attribute), the trend (driftsinntekter and årsresultat over
// the years brreg served, as a plain table read in a sentence; no
// chart), the honest years note, then Dokumenter: the annual-report
// PDF years and the kunngjøringer link.

import { COPY } from '../copy.js';
import type { FigCell, FigRow, OkonomiView, TrendView } from '../dossier-view.js';
import { button, el, glyph, link, section, uniqueId } from './dom.js';

const YEARS_SHOWN = 5;

function buildFigRow(row: FigRow): HTMLDivElement {
  const div = el('div', row.total ? 'fig-row fig-row--total' : 'fig-row');
  if (row.tone) div.dataset.tone = row.tone;
  div.appendChild(el('dt', undefined, row.label));
  const dd = el('dd', row.negative ? 'num--neg' : undefined, row.amount);
  if (row.unit) dd.appendChild(el('span', 'fig-row__unit', row.unit));
  div.appendChild(dd);
  return div;
}

function buildCell(cell: FigCell | undefined): HTMLTableCellElement {
  const td = el('td', cell?.negative ? 'num--neg' : undefined, cell ? cell.amount : COPY.trendMissing);
  if (cell?.unit) td.appendChild(el('span', 'fig-row__unit', cell.unit));
  return td;
}

// Years across, the two figures down, the latest year in the weight
// the rows above use; a sentence per row says the direction so no one
// has to subtract. The table is the data, the sentence the reading.
function buildTrend(trend: TrendView): HTMLElement {
  const wrap = el('div', 'trend');
  const head = el('h3', 'fig-group cap', trend.title);
  head.id = uniqueId('trend');
  wrap.appendChild(head);
  const table = el('table', 'trend__table');
  table.setAttribute('aria-labelledby', head.id);
  const thead = el('thead');
  const hr = el('tr');
  hr.appendChild(el('td'));
  for (const year of trend.years) {
    const th = el('th', undefined, year);
    th.scope = 'col';
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el('tbody');
  for (const row of trend.rows) {
    const tr = el('tr');
    const th = el('th', undefined, row.label);
    th.scope = 'row';
    tr.appendChild(th);
    for (const cell of row.cells) tr.appendChild(buildCell(cell));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  for (const line of trend.read) wrap.appendChild(el('p', 'trend__read', line));
  return wrap;
}

function buildFigures(view: OkonomiView): HTMLElement {
  const { figures } = view;
  if (figures.kind !== 'figures') {
    const sec = section(COPY.regnskap);
    const lines = figures.kind === 'failed' ? [figures.text] : figures.lines;
    for (const line of lines) sec.appendChild(el('p', 'section__text', line));
    return sec;
  }
  const sec = el('section', 'section');
  sec.dataset.tone = figures.status.tone;
  const head = el('div', 'fig-head');
  head.appendChild(el('h2', undefined, figures.title));
  head.appendChild(el('span', 'cap', figures.currency));
  sec.appendChild(head);
  const status = el('p', 'fig-status');
  status.appendChild(glyph(figures.status.tone));
  status.append(figures.status.text);
  sec.appendChild(status);

  const figs = el('div', 'figs');
  for (const group of figures.groups) {
    figs.appendChild(el('h3', 'fig-group cap', group.title));
    const dl = el('dl');
    for (const row of group.rows) dl.appendChild(buildFigRow(row));
    figs.appendChild(dl);
  }
  sec.appendChild(figs);

  if (figures.equity) {
    const equity = el('div', 'equity');
    // The bar is decoration; the legend is the only place Gjeld is said.
    const track = el('div', 'equity__track');
    track.setAttribute('aria-hidden', 'true');
    const fill = el('div', 'equity__fill');
    // CSSOM, not a style attribute: allowed under style-src 'self'.
    fill.style.setProperty('--share', `${figures.equity.share}%`);
    track.appendChild(fill);
    equity.appendChild(track);
    const legend = el('div', 'equity__legend');
    legend.appendChild(el('span', undefined, figures.equity.left));
    legend.appendChild(el('span', undefined, figures.equity.right));
    equity.appendChild(legend);
    sec.appendChild(equity);
  }

  if (figures.trend) sec.appendChild(buildTrend(figures.trend));

  if (view.honest) {
    const honest = el('p', 'honest');
    honest.dataset.tone = 'neutral';
    honest.appendChild(glyph('neutral'));
    honest.appendChild(el('span', undefined, view.honest));
    sec.appendChild(honest);
  }
  return sec;
}

function buildYears(years: OkonomiView['pdf']): HTMLElement {
  const row = el('div', 'doc-row');
  row.appendChild(el('span', 'doc-row__label', COPY.pdfLabel));
  if (!years) {
    row.appendChild(el('span', 'section__text', COPY.pdfFailed));
    return row;
  }
  if (years.years.length === 0) {
    row.appendChild(el('span', 'section__text', COPY.pdfNone));
    return row;
  }
  const list = el('div', 'years');
  const older: HTMLAnchorElement[] = [];
  years.years.forEach((y, i) => {
    const a = link(y.year, y.href, { className: '', title: COPY.pdfTitle });
    if (i >= YEARS_SHOWN) {
      a.hidden = true;
      older.push(a);
    }
    list.appendChild(a);
  });
  if (older.length > 0) {
    const more = button('years__more', COPY.pdfOlder);
    more.addEventListener('click', () => {
      for (const a of older) a.hidden = false;
      more.remove();
    });
    list.appendChild(more);
  }
  row.appendChild(list);
  return row;
}

export function buildOkonomi(view: OkonomiView): HTMLElement[] {
  const docs = section(COPY.dokumenter);
  docs.appendChild(buildYears(view.pdf));
  const ext = el('div', 'ext-row');
  ext.appendChild(link(COPY.kunngjoringer, view.kunngjoringer, { className: '', external: true }));
  ext.appendChild(el('span', undefined, COPY.atBrreg));
  docs.appendChild(ext);
  return [buildFigures(view), docs];
}
