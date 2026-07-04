import type { Enhet } from '../../types/brreg.js';

// Flag pill ("Aktiv", "Konkurs", "MVA-registrert", …) shared by the
// popup result view (src/popup/popup.ts) and the sidebar header
// (src/details/render/header.ts) — one definition so the two surfaces
// can't drift on flag markup.
//
// `kind` drives visual hierarchy: status pills (the live/konkurs/
// avvikling signal — the thing a user actually scans for) stay filled
// and coloured, while 'registry' membership facts (MVA, Foretaks-,
// Stiftelses-, Frivillighetsregistret) render as quiet outlines so they
// recede behind the status.
export interface FlagSpec {
  label: string;
  severity?: 'ok' | 'warn' | 'danger';
}

// Status-pill derivation shared by both surfaces. Slettet is checked
// first: a deleted entity comes back as a minimal SlettetEnhet body
// where the konkurs/avvikling booleans are absent, so any derivation
// that only looks at those would fall through to "Aktiv".
export function deriveStatusFlags(enhet: Enhet): FlagSpec[] {
  const slettet = Boolean(enhet.slettedato);
  const negativeStatus =
    slettet ||
    enhet.konkurs ||
    enhet.underAvvikling ||
    enhet.underTvangsavviklingEllerTvangsopplosning;
  const flags: FlagSpec[] = [];
  if (!negativeStatus) flags.push({ label: 'Aktiv', severity: 'ok' });
  if (slettet) flags.push({ label: 'Slettet', severity: 'danger' });
  if (enhet.konkurs) flags.push({ label: 'Konkurs', severity: 'danger' });
  if (enhet.underAvvikling)
    flags.push({ label: 'Under avvikling', severity: 'warn' });
  if (enhet.underTvangsavviklingEllerTvangsopplosning)
    flags.push({ label: 'Tvangsavvikling', severity: 'danger' });
  return flags;
}

export function makeFlag(
  label: string,
  severity?: 'ok' | 'warn' | 'danger',
  kind: 'status' | 'registry' = 'status',
): HTMLElement {
  const el = document.createElement('span');
  el.className = 'flag';
  if (severity) el.dataset.severity = severity;
  if (kind === 'registry') el.dataset.kind = 'registry';
  el.textContent = label;
  return el;
}
