import { formatNok, formatPercent } from '../../lib/format.js';
import { keyFigures, sortRegnskapDesc } from '../../lib/regnskap.js';
import type { KeyFigures } from '../../lib/regnskap.js';
import type { RegnskapResponse } from '../../types/brreg.js';
import { $, addRow, emptyLine } from './dom.js';

const nokkeltallBody = $('nokkeltall-body');

// How many years the trend table shows at most.
const TREND_YEARS = 3;

export function renderNokkeltall(response: RegnskapResponse): void {
  nokkeltallBody.innerHTML = '';
  if (response.unsupportedPlan) {
    // brreg's public regnskap-API only serialises the default
    // oppstillingsplan; BANK / FORS filings exist but come back as
    // 500. Surface that explicitly so we don't look like we missed
    // the data.
    nokkeltallBody.appendChild(
      emptyLine(
        `Filer som ${unsupportedPlanLabel(response.unsupportedPlan)} — ikke tilgjengelig i offentlig API.`,
      ),
    );
    return;
  }

  const sorted = sortRegnskapDesc(response.items);
  if (sorted.length === 0) {
    nokkeltallBody.appendChild(emptyLine('Ingen regnskap registrert.'));
    return;
  }

  const figures = sorted.slice(0, TREND_YEARS).map(keyFigures);
  const latest = figures[0]!;

  if (figures.length >= 2) {
    // Multi-year company: lead with a compact P&L trend, then a
    // latest-year balance/ratio snapshot below it.
    nokkeltallBody.appendChild(renderTrendTable(figures));
    nokkeltallBody.appendChild(renderBalance(latest));
  } else {
    // Single filing: one detailed column, like before but with the new
    // gjeld + egenkapitalandel rows folded in.
    const header = document.createElement('p');
    header.className = 'nokkeltall-year';
    header.textContent = latest.year
      ? `Regnskap ${latest.year}`
      : 'Siste regnskap';
    nokkeltallBody.appendChild(header);

    const dl = makeGrid();
    addRow(dl, 'Driftsinntekter', formatNok(latest.driftsinntekter));
    addRow(dl, 'Driftsresultat', formatNok(latest.driftsresultat), {
      sign: latest.driftsresultat,
    });
    addRow(dl, 'Resultat før skatt', formatNok(latest.resultatFoerSkatt), {
      sign: latest.resultatFoerSkatt,
    });
    addRow(dl, 'Årsresultat', formatNok(latest.aarsresultat), {
      sign: latest.aarsresultat,
    });
    addRow(dl, 'Egenkapital', formatNok(latest.egenkapital), {
      sign: latest.egenkapital,
    });
    addRow(dl, 'Gjeld', formatNok(latest.gjeld));
    addRow(dl, 'Egenkapitalandel', formatPercent(latest.egenkapitalandel), {
      sign: latest.egenkapitalandel,
    });

    if (dl.children.length === 0) {
      nokkeltallBody.appendChild(
        emptyLine('Regnskap registrert, men uten utdrag.'),
      );
      return;
    }
    nokkeltallBody.appendChild(dl);
  }
}

function renderBalance(latest: KeyFigures): HTMLElement {
  const wrap = document.createElement('div');
  const header = document.createElement('p');
  header.className = 'nokkeltall-year';
  header.textContent = latest.year ? `Balanse ${latest.year}` : 'Siste balanse';
  wrap.appendChild(header);

  const dl = makeGrid();
  addRow(dl, 'Resultat før skatt', formatNok(latest.resultatFoerSkatt), {
    sign: latest.resultatFoerSkatt,
  });
  addRow(dl, 'Egenkapital', formatNok(latest.egenkapital), {
    sign: latest.egenkapital,
  });
  addRow(dl, 'Gjeld', formatNok(latest.gjeld));
  addRow(dl, 'Egenkapitalandel', formatPercent(latest.egenkapitalandel), {
    sign: latest.egenkapitalandel,
  });
  wrap.appendChild(dl);
  return wrap;
}

interface TrendCol {
  label: string;
  pick: (f: KeyFigures) => number | undefined;
  signed: boolean;
}

const TREND_COLS: TrendCol[] = [
  { label: 'Inntekter', pick: (f) => f.driftsinntekter, signed: false },
  { label: 'Driftsres.', pick: (f) => f.driftsresultat, signed: true },
  { label: 'Årsres.', pick: (f) => f.aarsresultat, signed: true },
];

function renderTrendTable(figures: KeyFigures[]): HTMLElement {
  const table = document.createElement('table');
  table.className = 'nokkeltall-trend';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(th('År'));
  for (const col of TREND_COLS) headRow.appendChild(th(col.label));
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const f of figures) {
    const tr = document.createElement('tr');
    const yearCell = document.createElement('th');
    yearCell.scope = 'row';
    yearCell.textContent = f.year || '—';
    tr.appendChild(yearCell);
    for (const col of TREND_COLS) {
      const value = col.pick(f);
      const td = document.createElement('td');
      td.textContent = formatNok(value) ?? '—';
      if (col.signed && typeof value === 'number' && value < 0) {
        td.dataset.sign = 'neg';
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function th(text: string): HTMLTableCellElement {
  const el = document.createElement('th');
  el.scope = 'col';
  el.textContent = text;
  return el;
}

function makeGrid(): HTMLDListElement {
  const dl = document.createElement('dl');
  dl.className = 'nokkeltall-grid';
  return dl;
}

function unsupportedPlanLabel(code: string): string {
  switch (code.toUpperCase()) {
    case 'BANK':
      return 'bankregnskap (BANK)';
    case 'FORS':
      return 'forsikringsregnskap (FORS)';
    default:
      return `oppstillingsplan ${code}`;
  }
}
