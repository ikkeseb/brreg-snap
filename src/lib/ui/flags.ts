// Status-flag pill ("Aktiv", "Konkurs", "MVA-registrert", …) shared
// by the popup result view. src/details/render/header.ts currently
// carries its own private copy — it can't import this module-free
// (header.ts runs top-level $() lookups against details.html ids), so
// migrating it means exporting from here and deleting the local copy
// in a render/-scoped change.

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
