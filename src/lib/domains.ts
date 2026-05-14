// Hand-curated domain → orgnr table. Start small; grow as common
// lookups surface. Always store the *publishing entity* — the legal
// owner of the domain — not a parent or subsidiary unless the site is
// unambiguously that of the parent.
//
// Every value MUST be verified against data.brreg.no/enhetsregisteret/api
// — mod-11 alone does not catch entries pointing at the wrong entity.
// The module-load invariant below catches checksum typos; semantic
// correctness is on the curator.

import { isValidOrgnr } from './mod11.js';

const TABLE: Readonly<Record<string, string>> = {
  'dnb.no': '984851006',          // DNB BANK ASA
  'equinor.com': '923609016',     // EQUINOR ASA
  'nrk.no': '976390512',          // NORSK RIKSKRINGKASTING AS
  'orkla.no': '910747711',        // ORKLA ASA
  'posten.no': '984661185',       // POSTEN BRING AS
  'sparebank1.no': '975966372',   // SPAREBANK 1 GRUPPEN AS
  'telenor.no': '982463718',      // TELENOR ASA
  'tine.no': '947942638',         // TINE SA
  'vy.no': '984661177',           // VYGRUPPEN AS
};

for (const [domain, orgnr] of Object.entries(TABLE)) {
  if (!isValidOrgnr(orgnr)) {
    throw new Error(`domains.ts: ${domain} → ${orgnr} fails mod-11`);
  }
}

export function domainToOrgnr(hostname: string): string | undefined {
  const normalized = hostname.replace(/^www\./, '').toLowerCase();
  if (TABLE[normalized]) return TABLE[normalized];

  // Try parent domain (e.g. shop.telenor.no → telenor.no).
  const parts = normalized.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.');
    if (TABLE[parent]) return TABLE[parent];
  }
  return undefined;
}

export function knownDomainCount(): number {
  return Object.keys(TABLE).length;
}
