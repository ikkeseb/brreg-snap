import { formatNok, formatNokCompact, formatPercent } from '../../lib/format.js';
import {
  egenkapitalandelTone,
  isConsecutiveYear,
  keyFigures,
  sortRegnskapDesc,
  yoyDelta,
} from '../../lib/regnskap.js';
import type { KeyFigures, YoyDelta, YoyDirection } from '../../lib/regnskap.js';
import type { RegnskapResponse } from '../../types/brreg.js';
import { $, addRow, emptyLine, emptyState } from './dom.js';

const nokkeltallBody = $('nokkeltall-body');

// How many years the trend table shows at most.
const TREND_YEARS = 3;

export function renderNokkeltall(
  response: RegnskapResponse | undefined,
): void {
  nokkeltallBody.replaceChildren();
  if (!response) {
    // The regnskap fetch failed (network/5xx). Say so — an empty-state
    // "Ingen regnskap registrert" here would be a false claim about
    // the registry.
    nokkeltallBody.appendChild(
      emptyLine('Kunne ikke hente regnskapsdata. Prøv igjen senere.'),
    );
    return;
  }
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
    nokkeltallBody.appendChild(emptyState('Ingen regnskap registrert.'));
    return;
  }

  const figures = sorted.slice(0, TREND_YEARS).map(keyFigures);
  const latest = figures[0]!;

  if (figures.length >= 2) {
    // Multi-year company: lead with a compact P&L trend, then a
    // latest-year balance/ratio snapshot below it. NOTE: brreg's open
    // regnskap endpoint currently returns only the latest year per
    // orgnr, so this branch is effectively unreachable in production —
    // see docs/notes/brreg-api.md § regnskap-single-year-only. Kept
    // as-is so it lights up if brreg restores multi-year responses.
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
      tone: egenkapitalandelTone(latest.egenkapitalandel),
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
    tone: egenkapitalandelTone(latest.egenkapitalandel),
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
  figures.forEach((f, idx) => {
    const prior = figures[idx + 1];
    const tr = document.createElement('tr');
    const yearCell = document.createElement('th');
    yearCell.scope = 'row';
    yearCell.textContent = f.year || '—';
    tr.appendChild(yearCell);
    for (const col of TREND_COLS) {
      const value = col.pick(f);
      const td = document.createElement('td');
      const figure = document.createElement('span');
      figure.className = 'trend-figure';
      figure.textContent = formatNokCompact(value) ?? '—';
      td.appendChild(figure);
      if (col.signed && typeof value === 'number' && value < 0) {
        td.dataset.sign = 'neg';
      }
      // Latest row only: a small YoY delta so the user reads "is it
      // growing?" without doing the subtraction. Shown only when the prior
      // filing is the immediately preceding year (else it'd mislabel a
      // multi-year jump); yoyDelta further declines a zero/negative base.
      if (idx === 0 && prior && isConsecutiveYear(f, prior)) {
        const delta = yoyDelta(value, col.pick(prior));
        if (delta) td.appendChild(renderYoy(delta));
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  // Scope horizontal overflow to the table: a wide large-cap filing's nowrap
  // figures would otherwise force a scrollbar onto the entire side panel.
  const scroll = document.createElement('div');
  scroll.className = 'trend-scroll';
  scroll.appendChild(table);
  return scroll;
}

const YOY_ARROW: Record<YoyDirection, string> = {
  up: '▲', // ▲
  down: '▼', // ▼
  flat: '→', // →
};

// Compact "▲ 12 %" delta shown under the latest figure. Kept muted (not
// green/red) on purpose: the arrow carries the direction, and a coloured
// delta would fight the red loss-flagging already in the table. The % uses
// the shared formatPercent so it matches the balance block's minus glyph.
// The triangle is decorative (aria-hidden); the direction is worded for
// screen readers, and a huge small-base swing is clamped to ">999 %" so a
// nowrap cell can't overflow the panel.
const YOY_LABEL: Record<YoyDirection, string> = {
  up: 'opp',
  down: 'ned',
  flat: 'uendret',
};

const YOY_MAX_PCT = 999;

function renderYoy(delta: YoyDelta): HTMLElement {
  const span = document.createElement('span');
  span.className = 'yoy';
  const absPct = Math.abs(delta.pct);
  // A change that rounds to 0 % reads as flat, so don't pair "0 %" with an
  // up/down arrow.
  const direction: YoyDirection =
    Math.round(absPct) === 0 ? 'flat' : delta.direction;
  span.dataset.dir = direction;
  const magnitude =
    absPct > YOY_MAX_PCT ? `>${YOY_MAX_PCT}\u00a0%` : formatPercent(absPct) ?? '';

  // The triangle is decorative; the direction is worded for screen readers.
  const sr = document.createElement('span');
  sr.className = 'visually-hidden';
  sr.textContent = `${YOY_LABEL[direction]} `;
  const arrow = document.createElement('span');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = YOY_ARROW[direction];
  span.append(sr, arrow, `\u00a0${magnitude}`);
  return span;
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
