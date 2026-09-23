// Registry annotations (påtegninger) as merknader: the registry's own
// words, quoted verbatim, newest first. See docs/notes/trust.md
// § merknader.

import { parseIsoDate } from '../format.js';
import type { Enhet } from '../../types/brreg.js';
import type { Merknad } from './types.js';

export function deriveMerknader(enhet: Enhet): Merknad[] {
  const merknader: Merknad[] = [];
  for (const p of enhet.paategninger ?? []) {
    const text = typeof p.tekst === 'string' ? p.tekst.trim() : '';
    if (!text) continue;
    const merknad: Merknad = { text };
    if (p.innfoertDato && parseIsoDate(p.innfoertDato)) merknad.since = p.innfoertDato;
    const infotype = p.infotype?.trim();
    if (infotype) merknad.infotype = infotype;
    merknader.push(merknad);
  }
  // Newest first; an undated one sorts last. Stable, so equal dates keep
  // the registry's order.
  return merknader.sort((a, b) => (b.since ?? '').localeCompare(a.since ?? ''));
}

// The first sentence of a merknad, for a one-line finding: «Foretaks-
// registeret har grunn til å anta at forretningsadressen er feil.» A
// sentence ends at . ! or ? followed by whitespace and a capital letter,
// so «pga. manglende …» doesn't cut it short. No end found → the whole
// text.
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const m = /^(.+?[.!?])\s+(?=[A-ZÆØÅ])/su.exec(trimmed);
  return m?.[1] ?? trimmed;
}
