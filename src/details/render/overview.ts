import { formatAddress } from '../../lib/format.js';
import { findDagligLeder } from '../../lib/roller.js';
import type { Enhet, RollerResponse } from '../../types/brreg.js';
import { $, addLink, addRow } from './dom.js';

const overviewList = $('overview-list') as HTMLDListElement;
const contactList = $('contact-list') as HTMLDListElement;

export function renderOverview(enhet: Enhet, roller: RollerResponse): void {
  overviewList.innerHTML = '';
  addRow(overviewList, 'Organisasjonsform', enhet.organisasjonsform?.beskrivelse);
  addRow(
    overviewList,
    'Registrert',
    enhet.registreringsdatoEnhetsregisteret,
  );
  addRow(overviewList, 'Næring', enhet.naeringskode1?.beskrivelse);
  addRow(overviewList, 'Antall ansatte', enhet.antallAnsatte?.toString());
  addRow(overviewList, 'Daglig leder', findDagligLeder(roller));
}

export function renderContact(enhet: Enhet): void {
  contactList.innerHTML = '';
  const businessAddr = formatAddress(enhet.forretningsadresse);
  const postalAddr = formatAddress(enhet.postadresse);
  addRow(contactList, 'Forretningsadresse', businessAddr);
  if (postalAddr && postalAddr !== businessAddr) {
    addRow(contactList, 'Postadresse', postalAddr);
  }
  addRow(contactList, 'Telefon', enhet.telefon);
  addRow(contactList, 'Mobil', enhet.mobil);
  if (enhet.epostadresse) {
    addLink(
      contactList,
      'E-post',
      `mailto:${enhet.epostadresse}`,
      enhet.epostadresse,
    );
  }
  if (enhet.hjemmeside) {
    const href = enhet.hjemmeside.startsWith('http')
      ? enhet.hjemmeside
      : `https://${enhet.hjemmeside}`;
    addLink(contactList, 'Hjemmeside', href, enhet.hjemmeside, true);
  }
}
