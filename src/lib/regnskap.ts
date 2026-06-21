// Pure extraction + derivation over the regnskapsregisteret response.
// Kept DOM-free so it is unit-testable; src/details/render/nokkeltall.ts
// is the thin renderer on top.

import type { Regnskap } from '../types/brreg.js';

export interface KeyFigures {
  // YYYY of the period end, or '' when brreg omitted tilDato.
  year: string;
  tilDato: string;
  driftsinntekter?: number;
  driftsresultat?: number;
  resultatFoerSkatt?: number;
  aarsresultat?: number;
  egenkapital?: number;
  // sumEgenkapitalGjeld − sumEgenkapital (total liabilities). Undefined
  // unless both inputs are present.
  gjeld?: number;
  // egenkapital / sumEgenkapitalGjeld * 100. Undefined when the balance
  // total is missing or zero (no div-by-zero). Negative when equity is
  // negative (insolvent), which the UI flags in red.
  egenkapitalandel?: number;
}

// brreg's regnskapsregisteret returns filings in arbitrary order. Sort
// by period end (tilDato) descending so index 0 is the most recent.
// Filings without a tilDato can't be placed on the timeline and are
// dropped — the UI has nothing to label them with anyway.
export function sortRegnskapDesc(items: Regnskap[]): Regnskap[] {
  return items
    .filter((r) => r.regnskapsperiode?.tilDato)
    .sort((a, b) =>
      (b.regnskapsperiode!.tilDato ?? '').localeCompare(
        a.regnskapsperiode!.tilDato ?? '',
      ),
    );
}

export type YoyDirection = 'up' | 'down' | 'flat';

export interface YoyDelta {
  // Signed percent change of current vs prior ((cur − prior) / prior * 100).
  pct: number;
  // Derived from the raw difference, so it stays meaningful at the edges.
  direction: YoyDirection;
}

// Year-over-year change of `current` vs `prior`. Returns undefined when an
// honest percentage can't be produced:
//  - either figure missing
//  - prior ≤ 0: a % change off a zero or negative base is misleading
//    (−100k → −50k reads as "+50 %" while the company is still in the red),
//    so we decline rather than print a number that lies.
// Used for the latest-year trend deltas in the Nøkkeltall table.
export function yoyDelta(
  current: number | undefined,
  prior: number | undefined,
): YoyDelta | undefined {
  if (typeof current !== 'number' || typeof prior !== 'number') return undefined;
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return undefined;
  if (prior <= 0) return undefined;
  const pct = ((current - prior) / prior) * 100;
  const direction: YoyDirection =
    current > prior ? 'up' : current < prior ? 'down' : 'flat';
  return { pct, direction };
}

// True only when `prior` is the regnskap year immediately before `latest`
// (a one-year gap), so a "year-over-year" delta between the two filings is
// honest. brreg can return non-adjacent filings (a dormant year, a fiscal-
// year change, or two filings ending in the same calendar year); in those
// cases the caller should omit the YoY delta rather than label a multi-year
// jump as year-over-year. Both years must be present 4-digit values.
export function isConsecutiveYear(
  latest: KeyFigures,
  prior: KeyFigures,
): boolean {
  if (!latest.year || !prior.year) return false;
  const a = Number(latest.year);
  const b = Number(prior.year);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a - b === 1;
}

// A non-negative egenkapitalandel below this (percent) is a thin-equity
// caution, flagged amber. Negative equity is already shown red via the
// sign path — this only adds the "low but positive" warning band, not a
// full green/amber/red rubric.
export const EGENKAPITALANDEL_WARN_BELOW = 15;

// Tone for the egenkapitalandel row: 'warn' (amber) when equity is thin
// but non-negative; undefined otherwise (negative is handled by sign).
export function egenkapitalandelTone(
  pct: number | undefined,
): 'warn' | undefined {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return undefined;
  return pct >= 0 && pct < EGENKAPITALANDEL_WARN_BELOW ? 'warn' : undefined;
}

export function keyFigures(r: Regnskap): KeyFigures {
  const res = r.resultatregnskapResultat;
  const eg = r.egenkapitalGjeld;
  const egenkapital = eg?.egenkapital?.sumEgenkapital;
  const sumEKG = eg?.sumEgenkapitalGjeld;

  let gjeld: number | undefined;
  if (typeof sumEKG === 'number' && typeof egenkapital === 'number') {
    gjeld = sumEKG - egenkapital;
  }

  let egenkapitalandel: number | undefined;
  if (
    typeof sumEKG === 'number' &&
    sumEKG !== 0 &&
    typeof egenkapital === 'number'
  ) {
    egenkapitalandel = (egenkapital / sumEKG) * 100;
  }

  const tilDato = r.regnskapsperiode?.tilDato ?? '';
  return {
    year: tilDato.slice(0, 4),
    tilDato,
    driftsinntekter: res?.driftsresultat?.driftsinntekter?.sumDriftsinntekter,
    driftsresultat: res?.driftsresultat?.driftsresultat,
    resultatFoerSkatt: res?.ordinaertResultatFoerSkattekostnad,
    aarsresultat: res?.aarsresultat,
    egenkapital,
    gjeld,
    egenkapitalandel,
  };
}
