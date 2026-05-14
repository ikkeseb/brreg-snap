// Hand-curated domain → orgnr table. Start small; grow as common
// lookups surface. Always store the *publishing entity* — the legal
// owner of the domain — not a parent or subsidiary unless the site is
// unambiguously that of the parent. Keep alphabetised by domain.

const TABLE: Readonly<Record<string, string>> = {
  'dnb.no': '984851006',
  'equinor.com': '923609016',
  'finn.no': '928291131',
  'nrk.no': '976390512',
  'orkla.no': '910747711',
  'posten.no': '984661185',
  'sparebank1.no': '975966453',
  'telenor.no': '982463718',
  'tine.no': '948158022',
  'vy.no': '914218289',
};

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
