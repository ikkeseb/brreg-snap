import { renderOrgnrCopy } from '../../lib/copy-orgnr.js';
import { makeFlag } from '../../lib/ui/flags.js';
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
    flagsEl.appendChild(makeFlag('MVA-registrert', undefined, 'registry'));
  if (enhet.registrertIForetaksregisteret)
    flagsEl.appendChild(makeFlag('Foretaksregistret', undefined, 'registry'));
  if (enhet.registrertIStiftelsesregisteret)
    flagsEl.appendChild(makeFlag('Stiftelsesregistret', undefined, 'registry'));
  if (enhet.registrertIFrivillighetsregisteret)
    flagsEl.appendChild(makeFlag('Frivillighetsregistret', undefined, 'registry'));
}
