// Plain-text copies of what the trust view shows: «Kopier sammendrag»
// (a due-diligence snippet for an e-mail or a ticket) and the orgnr in
// the forms people paste it in. Pure: the surfaces call these inside
// their click handler and hand the string to writeClipboard
// (copy-orgnr.ts), which needs the click's gesture, not a permission.
//
// Same house rules as the view (types.ts): the registry's facts in its
// words, and what couldn't be fetched is left out, never written as
// «Ingen». Plain text has no colour, so the tone travels as words
// (TONE_PREFIX: «Advarsel: », «Obs: »).

import { formatOrgnr, postalLine } from '../format.js';
import { findDagligLeder, findRoleHolder } from '../roller.js';
import type { Adresse, Enhet, RollerResponse } from '../../types/brreg.js';
import { TONE_PREFIX, type Answer, type Kobling, type Signal } from './types.js';

export const BRREG_ENHET_URL = 'https://virksomhet.brreg.no/nb/oppslag/enheter/';

export interface SummaryInput {
  enhet: Enhet;
  answer: Answer;
  // The fact rows under the headline, in display order. A 'kobling'
  // row here is skipped: the kobling gets its own line.
  signals: readonly Signal[];
  // Present only when the company was reached from a site.
  kobling?: Kobling;
  // undefined = the roller fetch failed: no role line at all.
  roller?: RollerResponse;
  // When the data was fetched from brreg (ms since epoch) — not when
  // it's copied: a cached copy can be up to a day old.
  fetchedAt: number;
}

// «Status: Aktiv», «Alder: 54 år (stiftet 1972)».
function signalText(signal: Signal): string {
  const detail = signal.detail ? ` (${signal.detail})` : '';
  return `${signal.label}: ${signal.value}${detail}`;
}

const pad = (n: number): string => String(n).padStart(2, '0');

// «24.09.2026 kl. 14.05», local time.
export function formatFetchedAt(ms: number): string {
  const d = new Date(ms);
  return (
    `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}` +
    ` kl. ${pad(d.getHours())}.${pad(d.getMinutes())}`
  );
}

export function brregUrl(orgnr: string): string {
  return `${BRREG_ENHET_URL}${orgnr}`;
}

// The snippet, one fact per line:
//
//   EQUINOR ASA (org.nr 923 609 016)
//   Ingen varsler i registeret
//   Status: Aktiv · Alder: 54 år (stiftet 1972) · Ansatte: 21 272 · Regnskap: 2025 levert
//   Daglig leder: Kari Nordmann · Styreleder: Ola Nordmann
//   Kobling (equinor.com): …
//   Kilde: Brønnøysundregistrene (NLOD 2.0), hentet 24.09.2026 kl. 14.05
//   https://virksomhet.brreg.no/nb/oppslag/enheter/923609016
//
// With more than one finding the headline only counts them («2 ting å
// merke seg»), so each finding follows on its own «– » line.
export function buildSummary(input: SummaryInput): string {
  const { enhet, answer, signals, kobling, roller, fetchedAt } = input;
  const lines: string[] = [
    `${enhet.navn} (org.nr ${formatOrgnr(enhet.organisasjonsnummer)})`,
    `${TONE_PREFIX[answer.tone]}${answer.headline}`,
  ];
  if (answer.supporting) lines.push(answer.supporting);
  if (answer.findings.length > 1) {
    for (const f of answer.findings) {
      lines.push(`– ${TONE_PREFIX[f.tone]}${f.text}`);
    }
  }

  const facts = signals.filter((s) => s.key !== 'kobling').map(signalText);
  if (facts.length > 0) lines.push(facts.join(' · '));

  if (roller) {
    const roles = [
      ['Daglig leder', findDagligLeder(roller)],
      ['Styreleder', findRoleHolder(roller, 'LEDE')],
    ]
      .filter((r): r is [string, string] => r[1] !== undefined)
      .map(([label, name]) => `${label}: ${name}`);
    if (roles.length > 0) lines.push(roles.join(' · '));
  }

  if (kobling) {
    const detail = kobling.detail ? ` (${kobling.detail})` : '';
    lines.push(`${kobling.label} (${kobling.host}): ${kobling.value}${detail}`);
  }

  lines.push(
    `Kilde: Brønnøysundregistrene (NLOD 2.0), hentet ${formatFetchedAt(fetchedAt)}`,
    brregUrl(enhet.organisasjonsnummer),
  );
  return lines.join('\n');
}

export interface OrgnrFormats {
  // «923609016»
  digits: string;
  // «923 609 016»
  spaced: string;
  // «NO 923 609 016 MVA» — only when the company is in
  // Merverdiavgiftsregisteret; that suffix claims VAT registration.
  mva?: string;
  // Name, org.nr and forretningsadresse, one per line, for an invoice
  // or a supplier form.
  invoiceBlock: string;
}

// Street lines as registered, then «postnummer Poststed» (the place
// title-cased, as on screen), then the country when it isn't Norway. A foreign address (NUF) carries no
// postnummer; its poststed already holds the postcode («DE-92711
// Parkstein»).
function addressLines(addr: Adresse | undefined): string[] {
  if (!addr) return [];
  const lines = (addr.adresse ?? []).map((l) => l.trim()).filter(Boolean);
  const postal = postalLine(addr);
  if (postal) lines.push(postal);
  const foreign = addr.landkode !== undefined && addr.landkode !== 'NO';
  const land = addr.land?.trim() || addr.landkode;
  if (foreign && land) lines.push(land);
  return lines;
}

export function orgnrFormats(enhet: Enhet): OrgnrFormats {
  const digits = enhet.organisasjonsnummer;
  const spaced = formatOrgnr(digits);
  const formats: OrgnrFormats = {
    digits,
    spaced,
    invoiceBlock: [
      enhet.navn,
      `Org.nr. ${spaced}`,
      ...addressLines(enhet.forretningsadresse),
    ].join('\n'),
  };
  if (enhet.registrertIMvaregisteret === true) {
    formats.mva = `NO ${spaced} MVA`;
  }
  return formats;
}
