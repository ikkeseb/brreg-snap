import { formatNok } from '../../lib/format.js';
import type { RegnskapResponse } from '../../types/brreg.js';
import { $, addRow, emptyLine } from './dom.js';

const nokkeltallBody = $('nokkeltall-body');

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

  // brreg's regnskapsregisteret returns the array in arbitrary order;
  // pick the most recent period by `tilDato` rather than trusting
  // index 0.
  const latest = response.items
    .filter((r) => r.regnskapsperiode?.tilDato)
    .sort((a, b) =>
      (b.regnskapsperiode!.tilDato ?? '').localeCompare(
        a.regnskapsperiode!.tilDato ?? '',
      ),
    )[0];
  if (!latest) {
    nokkeltallBody.appendChild(emptyLine('Ingen regnskap registrert.'));
    return;
  }

  const tilDato = latest.regnskapsperiode?.tilDato ?? '';
  const year = tilDato.slice(0, 4);
  const header = document.createElement('p');
  header.className = 'nokkeltall-year';
  header.textContent = year ? `Regnskap ${year}` : 'Siste regnskap';
  nokkeltallBody.appendChild(header);

  const dl = document.createElement('dl');
  dl.className = 'nokkeltall-grid';
  const res = latest.resultatregnskapResultat;
  addRow(
    dl,
    'Driftsinntekter',
    formatNok(res?.driftsresultat?.driftsinntekter?.sumDriftsinntekter),
  );
  addRow(dl, 'Driftsresultat', formatNok(res?.driftsresultat?.driftsresultat));
  addRow(
    dl,
    'Resultat før skatt',
    formatNok(res?.ordinaertResultatFoerSkattekostnad),
  );
  addRow(dl, 'Årsresultat', formatNok(res?.aarsresultat));
  addRow(
    dl,
    'Egenkapital',
    formatNok(latest.egenkapitalGjeld?.egenkapital?.sumEgenkapital),
  );

  if (dl.children.length === 0) {
    nokkeltallBody.appendChild(emptyLine('Regnskap registrert, men uten utdrag.'));
    return;
  }
  nokkeltallBody.appendChild(dl);
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
