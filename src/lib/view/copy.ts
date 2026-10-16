// Every user-facing string the popup and the panel share, in one place
// (Norwegian bokmål; an English UI would start here). The
// trust derivations in src/lib/trust/ keep their own wording (the
// answer headline, signal values): those are the registry's facts, and
// their tests pin them. This file holds the chrome around them.

export const COPY = {
  brand: 'brreg-snap',
  searchLabel: 'Søk etter selskap',
  // Every search field, popup and panel alike.
  searchPlaceholder: 'Navn eller org.nr',
  searchHint: 'Org.nr kan limes inn med eller uten mellomrom.',
  // Masthead when the tab has no address to look up (the no-site empty
  // state shows the mark alone: its heading says it).
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
  eyebrowUrl: 'Org.nr funnet i nettadressen',
  eyebrowTitle: 'Org.nr funnet i sidetittelen',
  // A sole proprietorship's owner: the register's primary person (INNH).
  innehaver: 'Innehaver',
  dagligLeder: 'Daglig leder',
  styreleder: 'Styreleder',
  dagligLederOgStyreleder: 'Daglig leder og styreleder',
  // «Avdeling: DNB BANK ASA AVD ALTA (973 160 834)», the parent's
  // prefix muted (identity.ts).
  avdelingLabel: 'Avdeling: ',
  avdelingOrgnr: (spaced: string) => ` (${spaced})`,
  copySummary: 'Kopier sammendrag',
  summaryCopied: 'Sammendrag kopiert',

  // answer band
  rejectInBand: 'Feil bedrift? Velg en annen',
  searchRightCompany: 'Søk etter riktig selskap',
  gotoSite: (domain: string) => `Gå til ${domain}`,
  merknadCount: (n: number) => (n === 1 ? '1 merknad i registeret' : `${n} merknader i registeret`),
  // Parts of the lookup that failed, named under the answer (popup):
  // a failed fetch is never shown as an empty registry.
  couldNotFetch: (parts: string) => `Noe kunne ikke hentes: ${parts}`,
  partName: { roller: 'roller', regnskap: 'regnskapstall', konsern: 'konsern', endringer: 'endringer' },

  // the danger verdict's kicker, the same word the ledger's sr-only text uses
  verdictKicker: 'Alvorlig',

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
  // The ledger's row labels, as the trust derivations write them
  // (src/lib/trust/ keeps its own wording): the skeleton shows these.
  ledgerLabels: {
    kobling: 'Kobling',
    status: 'Status',
    alder: 'Alder',
    ansatte: 'Ansatte',
    regnskap: 'Regnskap',
  },
  // A late filing names the year that is missing, not just the last one.
  regnskapLate: (expected: string) => `${expected} ikke levert`,
  regnskapLateLast: (year: string) => `· siste er ${year}`,
  // A filed year whose figures the open API doesn't carry.
  figuresNotOpen: 'tall ikke i åpne data',
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
  // Oversikt: the definition rows (dossier-view.ts)
  organisasjonsform: 'Organisasjonsform',
  stiftet: 'Stiftet',
  registrert: 'Registrert',
  aktivitet: 'Aktivitet',
  formaal: 'Formål',
  tidligereNavn: 'Tidligere navn',
  until: (date: string) => `til ${date}`,
  overordnetEnhet: 'Overordnet enhet',
  orgnrRef: (spaced: string) => `Org.nr ${spaced}`,
  // A status flag's date row («Konkurs åpnet 26. aug. 2026»), keyed by
  // the flag's label; any other flag is its own label.
  statusDateLabel: {
    Konkurs: 'Konkurs åpnet',
    'Under avvikling': 'Avvikling fra',
    Rekonstruksjon: 'Rekonstruksjon fra',
  } as Record<string, string>,
  revisor: 'Revisor',
  regnskapsforer: 'Regnskapsfører',
  bostyrer: 'Bostyrer',
  forretningsadresse: 'Forretningsadresse',
  postadresse: 'Postadresse',
  telefon: 'Telefon',
  mobil: 'Mobil',
  epost: 'E-post',
  hjemmeside: 'Hjemmeside',
  // Personer: what follows a name
  born: (year: string) => `f. ${year}`,
  dead: 'død',
  deleted: 'slettet',
  merknadHead: (n: number) => (n === 1 ? 'Merknad i registeret' : 'Merknader i registeret'),
  innfort: 'Innført ',
  endretNylig: 'Endret nylig',
  endringerFailed: 'Endringer kunne ikke hentes.',
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
  driftsinntekter: 'Driftsinntekter',
  driftsresultat: 'Driftsresultat',
  resultatFoerSkatt: 'Resultat før skatt',
  aarsresultat: 'Årsresultat',
  sumEiendeler: 'Sum eiendeler',
  egenkapital: 'Egenkapital',
  egenkapitalandel: 'Egenkapitalandel',
  egenkapitalLegend: (amount: string) => `Egenkapital ${amount}`,
  gjeldLegend: (amount: string) => `Gjeld ${amount}`,
  honestSingleYear: 'Viser bare siste års tall.',
  honestYears: (from: string, to: string) => `Åpne data dekker ${from}–${to}.`,
  honestPdf: ' Eldre år finnes som PDF.',
  // The trend: the company's own figures over the years brreg served.
  trendTitle: (from: string, to: string) => `Utvikling ${from}–${to}`,
  trendMissing: '–',
  // The row header's accessible name: the unit beside the label is
  // only «mrd» on screen. «Driftsinntekter, milliarder NOK».
  trendRowName: (label: string, unit: string, valuta: string) => {
    const words: Record<string, string> = { mrd: 'milliarder', mill: 'millioner', tusen: 'tusen' };
    const unitWord = words[unit];
    return `${label}, ${unitWord ? `${unitWord} ` : ''}${valuta}`;
  },
  // One sentence per row: «<label> <reading>[, <aside>].» The rules
  // that pick the pieces are in src/lib/view/trend.ts.
  trendSentence: (label: string, reading: string, aside?: string) =>
    `${label} ${reading}${aside ? `, ${aside}` : ''}.`,
  trendUp: (pct?: string) => (pct ? `opp ${pct}` : 'opp'),
  trendDown: (pct?: string) => (pct ? `ned ${pct}` : 'ned'),
  trendSame: 'uendret',
  trendFlat: 'omtrent uendret',
  trendHighest: (year: string) => `høyest i ${year}`,
  trendLowest: (year: string) => `lavest i ${year}`,
  // The year only when the years around the turn are both held and
  // back to back; otherwise the turn is somewhere in the period.
  trendTurned: (toLoss: boolean, year?: string) =>
    `snudde ${toLoss ? 'fra overskudd til underskudd' : 'fra underskudd til overskudd'}${year ? ` i ${year}` : ''}`,
  trendLossBetween: (years: string) => `men underskudd i ${years}`,
  trendLossEvery: (two: boolean) => (two ? 'i underskudd begge år' : 'i underskudd alle år'),
  trendLossLarger: 'større sist',
  trendLossSmaller: 'mindre sist',
  trendLossSame: 'like stort',
  trendLossAbout: 'omtrent like stort',
  trendLossMost: (year: string) => `størst i ${year}`,
  trendLossLeast: (year: string) => `minst i ${year}`,
  trendLossYears: (label: string, years: string) => `${label}: underskudd i ${years}.`,
  // «2023», «2023 og 2025», «2022, 2023 og 2025».
  yearList: (years: string[]) =>
    years.length < 2 ? (years[0] ?? '') : `${years.slice(0, -1).join(', ')} og ${years.at(-1)!}`,
  // The Enhet names a newer filed year than the figures the API gave.
  filedNewer: (year: string) => `${year} er levert. Tallene er ikke i åpne data ennå.`,
  honestShowingYear: (year: string) => `Viser tallene for ${year}.`,
  honestOtherPdf: ' Andre år finnes som PDF.',
  regnskapFailed: 'Kunne ikke hente regnskapstallene. Prøv igjen senere.',
  // The data.brreg.no host permission is withheld (about:addons, Chrome's
  // site access): asking again can't help, granting it does.
  regnskapNoAccess: 'brreg-snap har ikke tilgang til data.brreg.no, så regnskapstallene kan ikke hentes.',
  // The popup's line under the answer: one line with «Gi tilgang», the
  // longer one breaks the 600 px cap (ui.md § popup-budget).
  regnskapNoAccessShort: 'Mangler tilgang til regnskapstallene.',
  grantAccess: 'Gi tilgang',
  regnskapNone: 'Ingen årsregnskap er registrert.',
  regnskapNoFigures: 'Regnskap registrert, men uten utdrag.',
  specialAccounts:
    'Banker og forsikringsselskaper leverer særskilte årsregnskap som ikke finnes i Brønnøysundregistrenes åpne data.',
  apiError: 'Brønnøysundregistrene ga feil for dette regnskapet.',
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
  konsernFailed: 'Konsernet kunne ikke hentes. Trykk «Oppdater» for å prøve igjen.',
  // The konsern count covers the whole group; this list is one level.
  directChildren: (n: number) => (n === 1 ? '1 direkte datterselskap' : `${n} direkte datterselskaper`),
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
  // The head says what the rows are (pickerHead in components/picker.ts):
  // no row has the site registered, the one row has it, several have it,
  // or one has it among name matches.
  pickHead: (site: string) => `Mulige selskaper bak ${site}`,
  pickHeadNone: (site: string) => `Fant ikke selskapet bak ${site}`,
  pickHeadOne: (site: string) => `Står dette selskapet bak ${site}?`,
  pickSubNone: (site: string) =>
    `Ingen har ${site} som registrert hjemmeside. Dette er de nærmeste treffene.`,
  pickSubOne: (site: string) => `Det har ${site} som registrert hjemmeside.`,
  pickSubSeveral: (site: string) =>
    `Flere selskaper har ${site} som registrert hjemmeside. Velg den som stemmer.`,
  pickSubStrong: 'Velg den som stemmer.',
  evidenceStrong: 'hjemmeside',
  evidenceStrongTitle: (site: string) => `Har ${site} som registrert hjemmeside`,
  evidencePage: 'underside',
  evidencePageTitle: (site: string) => `Registrert hjemmeside er en underside på ${site}`,
  evidenceWeak: 'navnetreff',
  evidenceWeakTitle: (site: string) => `Navnet ligner. ${site} er ikke selskapets registrerte hjemmeside`,
  none: 'Ingen av disse',
  searchYourself: 'Eller søk selv',
  pickAnsatte: (n: string) => `${n} ansatte`,

  // empty / search
  emptyNoSite: 'Ingen nettside å slå opp',
  emptyNoSiteText: 'Denne fanen har ingen adresse. Søk etter et selskap i stedet.',
  emptyPanelText: 'Søk etter et selskap i feltet over, eller åpne et du har sett.',
  emptyNoMatch: (site: string) => `Fant ikke selskapet bak ${site}`,
  // The hostname search failed: the error band leads («couldn't check»,
  // never «no match»), this line under it.
  emptyDegradedText: 'Søk etter et selskap i stedet.',
  emptyNoMatchText: 'Søk etter riktig selskap, eller åpne et du har sett.',
  emptyNone: (site: string) => `Du valgte «Ingen av disse» for ${site}`,
  emptyNoneText: 'Søk etter riktig selskap.',
  searchHead: 'Søk i Brønnøysundregistrene',
  recents: 'Nylig sett',
  results: 'Treff',
  noHits: 'Ingen treff.',
  searchFailed: 'Søket feilet.',
  hitCount: (n: number) => (n === 1 ? '1 treff.' : `${n} treff.`),
  invalidOrgnr: (digits: string) => `${digits} er ikke et gyldig org.nr.`,
  avdelingAv: (parent: string) => ` — avdeling av ${parent}`,
  forgetSite: (site: string) => `Glem valget for ${site}`,
  backToSite: (site: string) => `Tilbake til treffet for ${site}`,
  degradedSupport: (site: string) =>
    `${site} kunne ikke sjekkes. Det sier ingenting om nettstedet.`,

  // error (lib/ui/error-message.ts maps the failure; the manual search
  // says the not-found and deleted-branch sentences too)
  noAnswerHead: 'Fikk ikke svar fra Brønnøysundregistrene',
  noAnswerSupport: (what: string) => `${what} Det sier ingenting om selskapet.`,
  notFoundHead: 'Fant ikke noe selskap med dette org.nr',
  notFound: (orgnr: string) => `Fant ikke noe selskap med org.nr ${orgnr}.`,
  deletedAvdelingHead: 'Underenheten er slettet',
  deletedAvdeling: (orgnr: string, navn: string, when?: string) =>
    `${orgnr} er underenheten ${navn}, som er slettet${when ? ` ${when}` : ''}.`,
  tooManyHead: 'For mange oppslag på kort tid',
  tooMany: 'For mange oppslag på kort tid. Vent litt og prøv igjen.',
  timedOut: 'Brønnøysundregistrene svarte ikke i tide. Prøv igjen.',
  offline: 'Fikk ikke kontakt med Brønnøysundregistrene. Sjekk nettverkstilkoblingen og prøv igjen.',
  checkNetwork: 'Sjekk nettverkstilkoblingen og prøv igjen.',
  brregDown: 'Brønnøysundregistrene har tekniske problemer akkurat nå. Prøv igjen om litt.',
  badResponse: 'Brønnøysundregistrene ga et uventet svar. Prøv igjen om litt.',
  genericFailure: 'Noe gikk galt under oppslaget. Prøv igjen.',
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
  // Both engines, and both ways a request ends without the grant: the
  // user declined the prompt, or the browser refused to show it.
  autoSyncDenied: 'Tilgang til fanene ble ikke gitt. Slå på igjen for å prøve på nytt.',

  // panel: the compact head, sections with a sentence for a body
  regnskap: 'Regnskap',
  registered: (n: string) => `${n} registrert`,

  // welcome page (opened once, on install)
  welcome: {
    title: 'Velkommen til brreg-snap',
    head: 'Slå opp bedriften med ett klikk.',
    lead: 'brreg-snap finner bedriften bak nettsiden du er på og henter det viktigste fra Brønnøysundregistrene: org.nr, status, ledelse, regnskap, konsern og eventuelle varsler.',
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
      'Oppslagene går bare til Brønnøysundregistrene (data.brreg.no), med domenet til siden og navn utledet av det, et organisasjonsnummer eller tekst du selv søker på eller velger å slå opp. Ingenting går til utvikleren. Ingen konto, ingen sporing.',
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
