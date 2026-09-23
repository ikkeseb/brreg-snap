// One-line texts the surfaces derive from a loaded company. Pure, so
// the wording and the "when is there nothing to say" rules are tested
// without a DOM.

import { formatMoney } from '../format.js';
import { keyFigures, sortRegnskapDesc } from '../regnskap.js';
import type { RegnskapResponse, Underenhet } from '../../types/brreg.js';

// Above the verdict when the orgnr asked for was a branch and the view
// shows its parent — so the user sees why the name differs from what
// they looked up.
export function avdelingNote(avdeling: Underenhet): string {
  return `Avdeling: ${avdeling.navn} (${avdeling.organisasjonsnummer})`;
}

// The popup's «Omsetning» value: the latest filing's driftsinntekter in
// the filing's own currency, with its year — "68,0 mrd USD (2025)".
// Undefined when there is no figure to show: the fetch failed, the open
// API can't serve this company's accounts, nothing is filed, or the
// filing has no driftsinntekter.
export function revenueLine(regnskap: RegnskapResponse | undefined): string | undefined {
  if (!regnskap || regnskap.unavailable) return undefined;
  const latest = sortRegnskapDesc(regnskap.items)[0];
  if (!latest) return undefined;
  const figures = keyFigures(latest);
  const money = formatMoney(figures.driftsinntekter, figures.valuta);
  if (!money) return undefined;
  return figures.year ? `${money} (${figures.year})` : money;
}
