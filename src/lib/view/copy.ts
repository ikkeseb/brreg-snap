// Every user-facing string the popup and the panel share, in one place
// (Norwegian bokmål; the English-UI bet in the plan starts here). The
// trust derivations in src/lib/trust/ keep their own wording (the
// answer headline, signal values): those are the registry's facts, and
// their tests pin them. This file holds the chrome around them.

export const COPY = {
  brand: 'brreg-snap',
  searchLabel: 'Søk etter selskap',
  searchPlaceholderPanel: 'Navn eller org.nr',
  searchPlaceholder: 'Bedriftsnavn eller org.nr',
  searchHint: 'Org.nr kan limes inn med eller uten mellomrom.',
  // Masthead when the tab has no address to look up.
  noSite: 'Ingen nettside',

  // identity
  orgnrLabel: 'Org.nr',
  orgnrAria: (spaced: string) => `Kopier org.nr ${spaced}`,
  orgnrCopied: 'Org.nr kopiert',
  orgnrTitle: 'Klikk for å kopiere',
  copied: 'Kopiert',
  copyFailed: 'Kunne ikke kopiere',
  copyFailedLive: 'Kunne ikke kopiere til utklippstavlen',
  brregLink: 'brreg.no',
  eyebrowUrl: 'Org.nr funnet i adressen',
  eyebrowTitle: 'Org.nr funnet i sidetittelen',
  dagligLeder: 'Daglig leder',
  styreleder: 'Styreleder',
  avdeling: (navn: string, spaced: string) => `Avdeling: ${navn} (${spaced})`,
  copySummary: 'Kopier sammendrag',
  summaryCopied: 'Sammendrag kopiert',

  // answer band
  rejectInBand: 'Feil bedrift? Velg en annen',
  searchRightCompany: 'Søk etter riktig selskap',
  gotoSite: (domain: string) => `Gå til ${domain}`,
  merknadCount: (n: number) => (n === 1 ? '1 merknad i registeret' : `${n} merknader i registeret`),

  // ledger
  toneSr: { ok: ', ok', warn: ', advarsel', danger: ', alvorlig', neutral: '' },
  reject: 'Feil bedrift?',
  forget: 'Glem valget',
  report: 'Rapporter feil treff',
  kunngjoringer: 'Kunngjøringer',
  registeredShort: 'Registrert hjemmeside',
  notSite: (domain: string) => `Ikke ${domain}`,
  guessedFrom: (label: string) => `Gjettet fra navnet «${label}»`,
  foundViaName: 'Funnet via navnet',
  notRegisteredFor: (site: string) => `${site} er ikke registrert`,
  naering: 'Næring',
  omsetning: 'omsetning ',
  resultat: 'resultat ',
  aboutCompany: 'Om selskapet',
  aboutCompanyNote: '— sier ingenting om dette nettstedet',

  // popup actions
  openPanel: 'Åpne i sidepanel',

  // footer
  fetched: (relative: string) => `Hentet ${relative}`,
  refresh: 'Oppdater',
  refreshTitle: 'Hent dataene på nytt fra Brønnøysundregistrene',
  attributionPre: 'Data fra Brønnøysundregistrene (',
  attributionLink: 'NLOD 2.0',
  attributionPost: ')',
  attributionTitle: 'Norsk lisens for offentlige data',
  nlodUrl: 'https://data.norge.no/nlod/no/2.0',
  loadingFoot: 'Henter …',

  // loading / live region
  loading: 'Henter fra Brønnøysundregistrene …',
  loadingOrgnr: (spaced: string) => `Henter ${spaced} fra Brønnøysundregistrene …`,

  // panel tabs + sections
  tabsLabel: 'Detaljer',
  tabs: { oversikt: 'Oversikt', personer: 'Personer', okonomi: 'Økonomi', enheter: 'Enheter' },
  registrering: 'Registrering',
  ledelse: 'Ledelse',
  kontakt: 'Kontakt',
  merknadHead: (n: number) => (n === 1 ? 'Merknad i registeret' : 'Merknader i registeret'),
  innfort: 'Innført ',
  endretNylig: 'Endret nylig',
  rollerFailed: 'Kunne ikke hente roller. Prøv igjen senere.',
  rollerNone: 'Ingen registrerte roller.',
  avregistrert: 'Avregistrert',
  entityOpen: (spaced: string) => `Org.nr ${spaced} · åpne`,
  // A clamped free-text value (Aktivitet, Formål).
  showMore: 'Vis mer',
  showLess: 'Vis mindre',
  back: (name: string) => `Tilbake til ${name}`,
  backPlain: 'Tilbake',

  // økonomi
  aarsregnskap: (year: string) => (year ? `Årsregnskap ${year}` : 'Siste årsregnskap'),
  amountsIn: (valuta: string) => `Beløp i ${valuta}`,
  filedOk: 'Levert til Regnskapsregisteret',
  filedLatest: 'Siste innsendte årsregnskap',
  resultatGroup: 'Resultat',
  balanseGroup: 'Balanse',
  egenkapitalLegend: (amount: string) => `Egenkapital ${amount}`,
  gjeldLegend: (amount: string) => `Gjeld ${amount}`,
  honestSingleYear: 'Registeret deler bare siste års tall som åpne data.',
  honestPdf: ' Eldre år finnes som PDF.',
  regnskapFailed: 'Kunne ikke hente regnskapstallene. Prøv igjen senere.',
  regnskapNone: 'Ingen årsregnskap er registrert.',
  regnskapNoFigures: 'Regnskap registrert, men uten utdrag.',
  specialAccounts:
    'Banker og forsikringsselskaper leverer særskilte årsregnskap som brreg sitt åpne API ikke viser.',
  apiError: 'Brreg sitt åpne API ga feil for dette regnskapet.',
  lastFiled: (year: string) => `Siste innsendte årsregnskap: ${year}.`,
  dokumenter: 'Dokumenter',
  pdfLabel: 'Årsregnskap (PDF)',
  pdfTitle: 'PDF, lastes ned — kan ta litt tid',
  pdfOlder: 'eldre…',
  pdfFailed: 'Kunne ikke hente listen over årsregnskap.',
  pdfNone: 'Ingen årsregnskap som PDF.',
  atBrreg: 'hos brreg.no',

  // enheter
  konsern: 'Konsern',
  datterselskaper: 'Datterselskaper',
  topCompany: 'Toppselskap',
  ownerStake: (stake: string) => `eier ${stake}`,
  childCount: (n: number) => (n === 1 ? '1 datterselskap' : `${n} datterselskaper`),
  showAll: (n: number) => `Vis alle ${n}`,
  thisCompany: 'Dette selskapet',
  underenheter: 'Underenheter',
  underenheterFailed: 'Kunne ikke hente underenheter. Prøv igjen senere.',
  underenheterNone: 'Ingen registrerte underenheter.',
  showing: (shown: string, total: string) => `Viser ${shown} av ${total}`,
  seeAllAtBrreg: 'Se alle på brreg.no',
  ansatte: (n: string) => `${n} ansatte`,
  nedlagt: (date: string) => `Nedlagt ${date}`,
  slettet: (date: string) => `Slettet ${date}`,

  // picker
  pickHead: (site: string) => `Mulige selskaper bak ${site}`,
  pickSub: (site: string) => `Ingen har ${site} som registrert hjemmeside. Velg den som stemmer.`,
  pickSubStrong: 'Velg den som stemmer.',
  evidenceStrong: 'hjemmeside',
  evidencePage: 'underside',
  evidencePageTitle: (site: string) => `Registrert hjemmeside er en underside på ${site}`,
  evidenceWeak: 'navnetreff',
  none: 'Ingen av disse',
  searchYourself: 'Eller søk selv',
  pickAnsatte: (n: string) => `${n} ansatte`,

  // empty / search
  emptyNoSite: 'Ingen nettside å slå opp',
  emptyNoSiteText: 'Denne fanen har ingen adresse. Søk etter et selskap i stedet.',
  emptyPanelText: 'Søk etter et selskap i feltet over, eller åpne et du har sett.',
  emptyNoMatch: (site: string) => `Fant ikke selskapet bak ${site}`,
  // The hostname search failed: «couldn't check», never «no match».
  emptyDegraded: (site: string) => `Fikk ikke sjekket ${site}`,
  emptyNoMatchText: 'Søk etter riktig selskap, eller åpne et du har sett.',
  emptyNone: (site: string) => `Du valgte «Ingen av disse» for ${site}`,
  emptyNoneText: 'Søk etter riktig selskap.',
  searchHead: 'Søk i Brønnøysundregistrene',
  searchSelection: 'Søk etter teksten du markerte:',
  searchText: 'Navn eller org.nr.',
  recents: 'Nylig sett',
  results: 'Treff',
  noHits: 'Ingen treff.',
  searchFailed: 'Søket feilet.',
  hitCount: (n: number) => (n === 1 ? '1 treff.' : `${n} treff.`),
  avdelingAv: (parent: string) => ` — avdeling av ${parent}`,
  forgetSite: (site: string) => `Glem valget for ${site}`,
  backToSite: (site: string) => `Tilbake til treffet for ${site}`,
  searchFailedSupport: (q: string) => `Søket på «${q}» ble ikke fullført.`,
  degradedSupport: (site: string) =>
    `${site} kunne ikke sjekkes. Det sier ingenting om nettstedet.`,

  // error
  noAnswerHead: 'Fikk ikke svar fra Brønnøysundregistrene',
  retry: 'Prøv igjen',
  contextFor: 'Oppslag for ',
  contextOrgnr: 'Oppslag på org.nr ',

  // auto-sync (panel)
  autoSync: 'Auto-oppdater',
  autoSyncTitle: 'Oppdaterer automatisk når du bytter fane eller åpner en ny side',
  // The consent disclosure, shown before the runtime `tabs` request.
  // Word for word what the store review saw; change it only with the
  // privacy text (PRIVACY.md, docs/notes/permissions-model.md).
  autoSyncConsent:
    'Auto-oppdater slår opp siden du ser på hver gang du bytter fane eller åpner en ny side, ' +
    'så lenge et brreg-snap-panel er åpent: domenet sendes til Brønnøysundregistrene (data.brreg.no). ' +
    'Ingenting sendes til utvikleren. Nettleseren spør deretter om tilgang til fanene.',
  autoSyncAccept: 'Slå på',
  autoSyncCancel: 'Avbryt',

  // panel: the compact head, sections with a sentence for a body
  regnskap: 'Regnskap',
  konsernPath: 'Eierkjede',
  registered: (n: string) => `${n} registrert`,
  registeredPlural: (n: string) => `${n} registrerte`,

  // welcome page (opened once, on install)
  welcome: {
    title: 'Velkommen til brreg-snap',
    head: 'Hvem står bak nettsiden?',
    lead: 'brreg-snap slår opp selskapet bak siden du ser på i Brønnøysundregistrene, og sier fra når noe er galt.',
    // The two fictional examples; the tag says so on the card itself.
    exampleTag: 'Oppdiktet eksempel',
    calm: 'Rolig når alt er i orden',
    loud: 'Tydelig når det ikke er det',
    waysHead: 'Tre måter å slå opp',
    toolbarHead: 'Knappen i verktøylinjen',
    toolbarChrome: 'Fest den først: klikk puslespillbrikken øverst til høyre og trykk nålen ved brreg-snap.',
    toolbarFirefox: 'Den ligger allerede i verktøylinjen. Klikk den på en nettside du lurer på.',
    keysHead: 'Tastatur',
    keysPopup: 'Slå opp siden',
    keysPanel: 'Åpne sidepanelet',
    keysUnset: 'ikke satt',
    keysEditChrome: 'Endre snarveier',
    keysEditFirefox: 'Endre i Tillegg → Behandle snarveier.',
    menuHead: 'Høyreklikk',
    menuText: 'Marker et navn eller org.nr på en side, høyreklikk og velg «Slå opp «…» i brreg-snap».',
    privacy:
      'Bare domenet til siden du er på sendes til Brønnøysundregistrene (data.brreg.no). Ingenting går til utvikleren. Ingen konto, ingen sporing.',
    source: 'Kildekode på GitHub',
    sourceUrl: 'https://github.com/ikkeseb/brreg-snap',
  },
} as const;

// «Rapporter feil treff»: a mailto link the user clicks, prefilled with
// what a wrong match needs to be reproduced. Only the site's hostname —
// never the page title or the URL path, which can carry personal data.
export const SUPPORT_EMAIL = 'sebastian@nuez.no';

export interface ReportInput {
  host?: string;
  orgnr?: string;
  method?: string;
  version: string;
  browser: string;
}

export function reportHref({ host, orgnr, method, version, browser }: ReportInput): string {
  const subject = host ? `Feil treff i brreg-snap: ${host}` : 'Feil treff i brreg-snap';
  const body = [
    'Hva er feil, og hvilket selskap burde det vært?',
    '',
    '',
    '---',
    `Nettsted: ${host ?? '(ingen)'}`,
    `Org.nr vist: ${orgnr ?? '(ingen)'}`,
    `Funnet via: ${method ?? '(ukjent)'}`,
    `brreg-snap ${version} · ${browser}`,
  ].join('\n');
  const q = new URLSearchParams({ subject, body }).toString().replace(/\+/g, '%20');
  return `mailto:${SUPPORT_EMAIL}?${q}`;
}
