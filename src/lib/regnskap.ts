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

// The company's own most recent filing. brreg returns several years
// and, for a parent, the group's consolidated accounts (KONSERN) beside
// the company's own under the same orgnr, in no guaranteed order.
// Consolidated rows are never the answer: their figures belong to the
// whole group, not to the company the view names. Filings without an
// ISO tilDato can't be placed on the timeline and are skipped (the
// rows are unvalidated JSON).
// docs/notes/brreg-api.md § regnskap-years-and-types.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

function isKonsern(type: unknown): boolean {
  return typeof type === 'string' && type.trim().toUpperCase() === 'KONSERN';
}

export function latestRegnskap(items: Regnskap[]): Regnskap | undefined {
  let latest: Regnskap | undefined;
  let latestDato = '';
  for (const r of items) {
    const tilDato: unknown = r.regnskapsperiode?.tilDato;
    if (typeof tilDato !== 'string' || !ISO_DATE.test(tilDato)) continue;
    if (isKonsern(r.regnskapstype)) continue;
    if (tilDato > latestDato) {
      latest = r;
      latestDato = tilDato;
    }
  }
  return latest;
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
