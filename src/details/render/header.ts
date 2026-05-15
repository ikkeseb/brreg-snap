import { renderOrgnrCopy } from '../../lib/copy-orgnr.js';
import type { Enhet } from '../../types/brreg.js';
import { $ } from './dom.js';

const nameEl = $('name');
const orgnrEl = $('orgnr');
const flagsEl = $('flags');

export function renderHeader(enhet: Enhet): void {
  nameEl.textContent = enhet.navn;
  renderOrgnrCopy(orgnrEl, enhet.organisasjonsnummer);
  flagsEl.innerHTML = '';
  const negativeStatus =
    enhet.konkurs ||
    enhet.underAvvikling ||
    enhet.underTvangsavviklingEllerTvangsopplosning;
  if (!negativeStatus) flagsEl.appendChild(makeFlag('Aktiv', 'ok'));
  if (enhet.konkurs) flagsEl.appendChild(makeFlag('Konkurs', 'danger'));
  if (enhet.underAvvikling)
    flagsEl.appendChild(makeFlag('Under avvikling', 'warn'));
  if (enhet.underTvangsavviklingEllerTvangsopplosning)
    flagsEl.appendChild(makeFlag('Tvangsavvikling', 'danger'));
  if (enhet.registrertIMvaregisteret)
    flagsEl.appendChild(makeFlag('MVA-registrert'));
  if (enhet.registrertIForetaksregisteret)
    flagsEl.appendChild(makeFlag('Foretaksregistret'));
  if (enhet.registrertIStiftelsesregisteret)
    flagsEl.appendChild(makeFlag('Stiftelsesregistret'));
  if (enhet.registrertIFrivillighetsregisteret)
    flagsEl.appendChild(makeFlag('Frivillighetsregistret'));
}

function makeFlag(
  label: string,
  severity?: 'ok' | 'warn' | 'danger',
): HTMLElement {
  const el = document.createElement('span');
  el.className = 'flag';
  if (severity) el.dataset.severity = severity;
  el.textContent = label;
  return el;
}
