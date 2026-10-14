// The Økonomi trend: driftsinntekter and årsresultat over the company's
// own filed years (oldest first, at most TREND_YEARS), as a table with
// one magnitude word per row, and one sentence per row that says how
// the figure moved. DOM-free; components/okonomi.ts paints it.
//
// The sentence rules (docs/notes/ui.md § okonomi-trend):
// - It reads the heading's period: both end years must hold the figure,
//   else the row gets no sentence (the table still shows what is held).
// - A loss is never hidden. Årsresultat with a loss year reads, in
//   order: a loss every year («i underskudd alle år, større sist»); one
//   clean change of sign («snudde fra underskudd til overskudd i
//   2025»); profits at both ends with a loss between («opp 12 %, men
//   underskudd i 2024»); anything else lists the loss years
//   («Årsresultat: underskudd i 2023 og 2025.»).
// - Otherwise first to last: «uendret» when equal, a percentage when
//   the first year is above zero (under 1 % is «omtrent uendret»), the
//   bare direction when it isn't. A middle year outside the ends' range
//   by more than a tenth of the larger end is named («høyest i 2024»).

import { formatAmountsIn, formatPercent } from '../format.js';
import type { KeyFigures } from '../regnskap.js';
import { COPY } from './copy.js';

// Three columns fit the 320 px panel without wrapping; brreg serves
// three years today.
export const TREND_YEARS = 3;

export interface TrendCell {
  amount: string;
  negative?: boolean;
}

export interface TrendView {
  title: string;
  years: string[];
  // «Beløp i USD», only when no figures head above names the currency.
  currency?: string;
  // One magnitude word per row («mill»), so the cells hold numbers
  // only; a cell is undefined when that year lacks the figure.
  rows: Array<{ label: string; unit: string; cells: Array<TrendCell | undefined> }>;
  read: string[];
}

interface Point {
  year: string;
  value: number;
}

const isNum = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

// A middle year that leaves the ends' range by more than this share of
// the larger end is named in the sentence.
const MIDDLE_NAMED = 0.1;

function middleAside(first: Point, last: Point, middle: Point[], loss: boolean): string | undefined {
  if (middle.length === 0) return undefined;
  const hi = Math.max(first.value, last.value);
  const lo = Math.min(first.value, last.value);
  const bar = MIDDLE_NAMED * Math.max(Math.abs(first.value), Math.abs(last.value));
  const peak = middle.reduce((a, b) => (b.value > a.value ? b : a));
  const dip = middle.reduce((a, b) => (b.value < a.value ? b : a));
  const above = peak.value - hi;
  const below = lo - dip.value;
  if (above > bar && above >= below) return loss ? COPY.trendLossLeast(peak.year) : COPY.trendHighest(peak.year);
  if (below > bar) return loss ? COPY.trendLossMost(dip.year) : COPY.trendLowest(dip.year);
  return undefined;
}

function moved(first: number, last: number): string {
  if (first === last) return COPY.trendSame;
  const up = last > first;
  if (first <= 0 || last < 0) return up ? COPY.trendUp() : COPY.trendDown();
  const pct = ((last - first) / first) * 100;
  if (Math.abs(pct) < 1) return COPY.trendFlat;
  const text = formatPercent(Math.abs(pct));
  return up ? COPY.trendUp(text) : COPY.trendDown(text);
}

// The one year where a clean change of sign lands: every year before it
// on one side of zero and every year from it on the other, no zeros.
function cleanTurn(points: Point[]): Point | undefined {
  if (points.some((p) => p.value === 0)) return undefined;
  const at = points.findIndex((p) => p.value < 0 !== points[0]!.value < 0);
  if (at < 1) return undefined;
  const after = points.slice(at);
  return after.every((p) => p.value < 0 === after[0]!.value < 0) ? after[0] : undefined;
}

// The sentence for one row; undefined when an end year lacks the figure.
export function trendRead(
  label: string,
  cells: Array<Point | undefined>,
  signed: boolean,
): string | undefined {
  const first = cells[0];
  const last = cells.at(-1);
  if (!first || !last || cells.length < 2) return undefined;
  const middle = cells.slice(1, -1).filter((p): p is Point => p !== undefined);
  const points = [first, ...middle, last];
  const losses = signed ? points.filter((p) => p.value < 0) : [];

  if (losses.length === 0) {
    return COPY.trendSentence(label, moved(first.value, last.value), middleAside(first, last, middle, false));
  }
  if (losses.length === points.length) {
    if (points.length < cells.length) return COPY.trendLossYears(label, COPY.yearList(losses.map((p) => p.year)));
    const a = Math.abs(first.value);
    const b = Math.abs(last.value);
    const aside =
      middleAside(first, last, middle, true) ??
      (a === b
        ? COPY.trendLossSame
        : Math.abs(b - a) / a < 0.01
          ? COPY.trendLossAbout
          : b > a
            ? COPY.trendLossLarger
            : COPY.trendLossSmaller);
    return COPY.trendSentence(label, COPY.trendLossEvery(points.length === 2), aside);
  }
  const turn = cleanTurn(points);
  if (turn) return COPY.trendSentence(label, COPY.trendTurned(turn.value < 0, turn.year));
  if (first.value >= 0 && last.value >= 0) {
    return COPY.trendSentence(
      label,
      moved(first.value, last.value),
      COPY.trendLossBetween(COPY.yearList(losses.map((p) => p.year))),
    );
  }
  return COPY.trendLossYears(label, COPY.yearList(losses.map((p) => p.year)));
}

const SERIES: Array<{ label: string; pick: (k: KeyFigures) => number | undefined; signed: boolean }> = [
  { label: COPY.driftsinntekter, pick: (k) => k.driftsinntekter, signed: false },
  { label: COPY.aarsresultat, pick: (k) => k.aarsresultat, signed: true },
];

const currencyOf = (k: KeyFigures): string => (k.valuta ?? 'NOK').toUpperCase();

// `years` is the company's own filings, oldest first (one per year).
// The trend stands on its own: a latest filing without figures does not
// hide the years before it. Only years filed in the currency of the
// newest year that holds a trend figure share the table. `headValuta`
// is the currency the figures head above already names, if any.
export function trendOf(years: KeyFigures[], headValuta?: string): TrendView | undefined {
  const withFigures = years.filter((k) => SERIES.some((s) => isNum(s.pick(k))));
  const newest = withFigures.at(-1);
  if (!newest) return undefined;
  const valuta = currencyOf(newest);
  const same = withFigures.filter((k) => currencyOf(k) === valuta);
  const series = SERIES.filter((s) => same.filter((k) => isNum(s.pick(k))).length >= 2);
  const cols = same.filter((k) => series.some((s) => isNum(s.pick(k)))).slice(-TREND_YEARS);
  if (cols.length < 2) return undefined;

  const rows: TrendView['rows'] = [];
  const read: string[] = [];
  for (const s of series) {
    const values = cols.map(s.pick);
    if (!values.some(isNum)) continue;
    const { unit, amounts } = formatAmountsIn(values);
    rows.push({
      label: s.label,
      unit,
      cells: amounts.map((amount, i) => {
        if (amount === undefined) return undefined;
        return values[i]! < 0 ? { amount, negative: true } : { amount };
      }),
    });
    const sentence = trendRead(
      s.label,
      values.map((v, i) => (isNum(v) ? { year: cols[i]!.year, value: v } : undefined)),
      s.signed,
    );
    if (sentence) read.push(sentence);
  }
  if (rows.length === 0) return undefined;
  const trend: TrendView = {
    title: COPY.trendTitle(cols[0]!.year, cols.at(-1)!.year),
    years: cols.map((k) => k.year),
    rows,
    read,
  };
  if (!headValuta || headValuta.toUpperCase() !== valuta) trend.currency = COPY.amountsIn(valuta);
  return trend;
}
