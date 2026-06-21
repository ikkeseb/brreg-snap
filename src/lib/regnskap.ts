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
