// Pure extraction + derivation over the regnskapsregisteret response.
// Kept DOM-free so it is unit-testable; src/lib/view/dossier-view.ts
// is the thin renderer on top.

import type { Regnskap } from '../types/brreg.js';

export interface KeyFigures {
  // YYYY of the period end, or '' when brreg omitted tilDato.
  year: string;
  tilDato: string;
  // ISO currency of every money figure below. Mostly NOK, but filers
  // reporting in a functional currency use USD/EUR (Equinor, Mowi).
  // Undefined when brreg omits it; format as NOK then.
  valuta?: string;
  driftsinntekter?: number;
  driftsresultat?: number;
  resultatFoerSkatt?: number;
  aarsresultat?: number;
  egenkapital?: number;
  // Total assets: sumEgenkapitalGjeld (the balance sheet balances).
  sumEiendeler?: number;
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

// Why the open API has no figures for a company whose regnskap call
// answered 500. Banks (NACE 64.1x) and insurers/pension funds (65.x)
// file under their own oppstillingsplaner, which the endpoint can't
// serve — a known gap. For anyone else the honest statement is only
// that brreg's API failed; we don't know more.
export type RegnskapGap = 'special-accounts' | 'api-error';

export function regnskapGap(
  naeringskode: string | undefined,
  unsupportedPlan?: string,
): RegnskapGap {
  if (unsupportedPlan) return 'special-accounts';
  const kode = naeringskode?.trim() ?? '';
  return /^64\.1/.test(kode) || /^65\./.test(kode)
    ? 'special-accounts'
    : 'api-error';
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
    valuta: r.valuta,
    driftsinntekter: res?.driftsresultat?.driftsinntekter?.sumDriftsinntekter,
    driftsresultat: res?.driftsresultat?.driftsresultat,
    resultatFoerSkatt: res?.ordinaertResultatFoerSkattekostnad,
    aarsresultat: res?.aarsresultat,
    egenkapital,
    sumEiendeler: sumEKG,
    gjeld,
    egenkapitalandel,
  };
}
