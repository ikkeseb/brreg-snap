import {
  formatAddress,
  formatCount,
  formatDateNo,
  formatNaering,
} from '../../lib/format.js';
import { findRoleHolder } from '../../lib/roller.js';
import { deriveStatusFlags } from '../../lib/ui/flags.js';
import type { Enhet, RollerResponse } from '../../types/brreg.js';
import { $, addLink, addRow } from './dom.js';

const overviewList = $('overview-list') as HTMLDListElement;
const contactCard = $('contact');
const contactList = $('contact-list') as HTMLDListElement;

export function renderOverview(
  enhet: Enhet,
  // undefined = the roller fetch failed.
  roller: RollerResponse | undefined,
): void {
  overviewList.replaceChildren();
  addRow(overviewList, 'Organisasjonsform', enhet.organisasjonsform?.beskrivelse);
  // When (and for a forced dissolution, why) each negative status took
  // effect. The verdict cell has room for only one of the two.
  for (const flag of deriveStatusFlags(enhet)) {
    const date = formatDateNo(flag.since);
    if (!date) continue;
    addRow(overviewList, flag.label, flag.reason ? `${date} (${flag.reason})` : date);
  }
  addRow(overviewList, 'Stiftet', formatDateNo(enhet.stiftelsesdato));
  addRow(
    overviewList,
    'Registrert',
    formatDateNo(enhet.registreringsdatoEnhetsregisteret),
  );
  addRow(overviewList, 'Næring', formatNaering(enhet.naeringskode1));
  addRow(overviewList, 'Antall ansatte', formatCount(enhet.antallAnsatte));
  // Who runs it / who vouches for the books — all from the same roller
  // response already fetched for daglig leder. addRow skips any that are
  // absent (a firm may have no registered styreleder, revisor, or
  // regnskapsfører), so these rows appear only when there's a holder —
  // which is why a failed fetch needs its own row: silently dropping
  // them would read as "none registered".
  if (!roller) {
    addRow(overviewList, 'Roller', 'Kunne ikke hentes');
    return;
  }
  addRow(overviewList, 'Daglig leder', findRoleHolder(roller, 'DAGL'));
  addRow(overviewList, 'Styreleder', findRoleHolder(roller, 'LEDE'));
  addRow(overviewList, 'Revisor', findRoleHolder(roller, 'REVI'));
  addRow(overviewList, 'Regnskapsfører', findRoleHolder(roller, 'REGN'));
  // Only registered for a company in konkurs — the one contact a
  // creditor needs, so it's worth a row, not just the Personer tab.
  addRow(overviewList, 'Bostyrer', findRoleHolder(roller, 'BOBE'));
}

export function renderContact(enhet: Enhet): void {
  contactList.replaceChildren();
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
  // Deleted entities often carry no contact info at all — an empty
  // "Kontakt" card reads as a rendering bug, so hide it entirely.
  contactCard.hidden = contactList.childElementCount === 0;
}
