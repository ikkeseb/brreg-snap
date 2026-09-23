// One-line texts the surfaces derive from a loaded company. Pure, so
// the wording and the "when is there nothing to say" rules are tested
// without a DOM.

import type { Underenhet } from '../../types/brreg.js';

// Above the verdict when the orgnr asked for was a branch and the view
// shows its parent — so the user sees why the name differs from what
// they looked up.
export function avdelingNote(avdeling: Underenhet): string {
  return `Avdeling: ${avdeling.navn} (${avdeling.organisasjonsnummer})`;
}

