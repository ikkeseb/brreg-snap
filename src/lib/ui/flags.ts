// Status-flag pill ("Aktiv", "Konkurs", "MVA-registrert", …) shared by
// the popup result view (src/popup/popup.ts) and the sidebar header
// (src/details/render/header.ts) — one definition so the two surfaces
// can't drift on flag markup.

export function makeFlag(
  label: string,
  severity?: 'ok' | 'warn' | 'danger',
): HTMLElement {
  const el = document.createElement('span');
  el.className = 'flag';
  if (severity) el.dataset.severity = severity;
  el.textContent = label;
  return el;
}
