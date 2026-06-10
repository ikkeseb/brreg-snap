// Shared search-hit summary markup (name / næring / orgnr meta) used
// by the picker candidates and the manual-search results in both the
// popup and the sidebar. textContent only — never innerHTML — because
// every field is API-derived.

import type { SearchHit } from '../../types/brreg.js';

export interface HitSummaryOptions {
  // Picker rows append ", N ansatte" to the orgnr meta line as an
  // extra disambiguation signal; manual-search rows keep it short.
  includeAnsatte?: boolean;
}

export function appendHitSummary(
  container: HTMLElement,
  hit: SearchHit,
  opts: HitSummaryOptions = {},
): void {
  const name = document.createElement('span');
  name.className = 'picker-item-name';
  name.textContent = hit.navn;
  container.appendChild(name);

  // Næring disambiguates rows that share a name root — "VG CONSULT",
  // "VG BYGG", "VGTV" all start with VG but the industry tells the
  // user which is the media house. Optional field, skip silently when
  // brreg has no NACE on record.
  const naering = hit.naeringskode1?.beskrivelse;
  if (naering) {
    const naeringEl = document.createElement('span');
    naeringEl.className = 'picker-item-naering';
    naeringEl.textContent = naering;
    container.appendChild(naeringEl);
  }

  const meta = document.createElement('span');
  meta.className = 'picker-item-meta';
  let metaText = hit.organisasjonsnummer;
  if (opts.includeAnsatte) {
    const ansatte = hit.antallAnsatte;
    if (typeof ansatte === 'number' && ansatte > 0) {
      metaText += `, ${ansatte} ansatte`;
    }
  }
  meta.textContent = metaText;
  container.appendChild(meta);
}
