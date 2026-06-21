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
