export interface Adresse {
  adresse?: string[];
  postnummer?: string;
  poststed?: string;
  kommunenummer?: string;
  kommune?: string;
  landkode?: string;
  land?: string;
}

export interface Kode {
  kode: string;
  beskrivelse?: string;
}

// A registry annotation (påtegning) on the entity, e.g. on its name or
// business address: «Foretaksregisteret har grunn til å anta at
// forretningsadressen er feil. …». Quoted by src/lib/trust/merknader.ts.
export interface Paategning {
  infotype?: string;
  tekst?: string;
  innfoertDato?: string;
}

// A former name. Both dates are local date-times with a space, not ISO
// dates: "2026-09-01 12:29:08". Added by brreg 2026-06-16.
export interface HistoriskNavn {
  navn?: string;
  fraDato?: string;
  tilDato?: string;
}

// Share capital, as registered (brreg 2025-11-13).
export interface Kapital {
  belop?: number;
  antallAksjer?: number;
  // «Aksjekapital», …
  type?: string;
  bundet?: number;
  valuta?: string;
  innbetalt?: number;
  fulltInnbetalt?: boolean;
  innfortDato?: string;
}

export interface Enhet {
  organisasjonsnummer: string;
  navn: string;
  // Former names, oldest first as brreg lists them (not guaranteed:
  // read by date).
  historiskeNavn?: HistoriskNavn[];
  organisasjonsform?: Kode;
  // 'Enhet', or 'SlettetEnhet' for the minimal body of a deleted entity.
  respons_klasse?: string;
  // Founding date (ISO). Enhetsregisteret itself only starts in 1995, so
  // for older companies this is the only honest age basis.
  stiftelsesdato?: string;
  registreringsdatoEnhetsregisteret?: string;
  registreringsdatoForetaksregisteret?: string;
  registrertIMvaregisteret?: boolean;
  registrertIForetaksregisteret?: boolean;
  registrertIStiftelsesregisteret?: boolean;
  registrertIFrivillighetsregisteret?: boolean;
  naeringskode1?: Kode;
  // Left out below five employees (brreg API docs), so a missing count
  // is not zero: read it with harRegistrertAntallAnsatte.
  antallAnsatte?: number;
  // Present on every live Enhet: false = no employees registered, true
  // with no antallAnsatte = 1–4. Absent on a SlettetEnhet, which
  // carries no employee data at all.
  harRegistrertAntallAnsatte?: boolean;
  forretningsadresse?: Adresse;
  postadresse?: Adresse;
  hjemmeside?: string;
  epostadresse?: string;
  telefon?: string;
  mobil?: string;
  overordnetEnhet?: string;
  // Set (ISO date) when the entity is deleted from Enhetsregisteret.
  // The API then returns a minimal SlettetEnhet body where konkurs/
  // avvikling fields are absent — status derivation must check this
  // first or a dissolved entity renders as active.
  slettedato?: string;
  konkurs?: boolean;
  konkursdato?: string;
  underAvvikling?: boolean;
  underAvviklingDato?: string;
  underTvangsavviklingEllerTvangsopplosning?: boolean;
  // Set (ISO date) while the company is under rekonstruksjonsforhandling.
  // A date only: brreg has no boolean for this status.
  underRekonstruksjonsforhandlingDato?: string;
  // Forced dissolution: brreg sets one ISO date per reason, so which
  // field is present says WHY (missing accounts, missing daglig leder…).
  tvangsopplostPgaManglendeRegnskapDato?: string;
  tvangsopplostPgaManglendeDagligLederDato?: string;
  tvangsopplostPgaManglendeRevisorDato?: string;
  tvangsopplostPgaMangelfulltStyreDato?: string;
  tvangsavvikletPgaManglendeSlettingDato?: string;
  // Free-text purpose and activity lines, as registered. Not rendered.
  vedtektsfestetFormaal?: string[];
  aktivitet?: string[];
  paategninger?: Paategning[];
  // Date of the articles of association in force.
  vedtektsdato?: string;
  kapital?: Kapital;
  // Part of a konsern (group) per the register.
  erIKonsern?: boolean;
  // The country whose law governs a foreign entity. Present on UTLA
  // entities; live NUF samples (2026-09-24) carry none, so a NUF's
  // country comes from its forretningsadresse.
  underlagtLovgivningLandKode?: string;
  underlagtLovgivningLand?: string;
  // Year (YYYY string) of the latest annual accounts filed with
  // Regnskapsregisteret. Present even when the regnskap endpoint itself
  // can't serve the filing (banks, insurers).
  sisteInnsendteAarsregnskap?: string;
}

export type SearchHit = Pick<Enhet, 'organisasjonsnummer' | 'navn'> &
  Partial<Enhet>;

export interface Navn {
  fornavn?: string;
  mellomnavn?: string;
  etternavn?: string;
}

export interface Person {
  navn?: Navn;
  fodselsdato?: string;
  erDoed?: boolean;
}

export interface RolleEnhet {
  organisasjonsnummer?: string;
  navn?: string[];
  erSlettet?: boolean;
}

// The estate administrator on a BOBE role (konkurs, and forced
// dissolution). Unlike person/enhet it is a flat name string (usually
// "Adv. <navn>") plus a postal address — the contact a creditor needs.
export interface Bostyrer {
  navn?: string;
  postadresse?: Adresse;
  erDoed?: boolean;
}

export interface Rolle {
  type: Kode;
  person?: Person;
  enhet?: RolleEnhet;
  bostyrer?: Bostyrer;
  // true once the holder has left the role. Added by brreg 2026-01-04;
  // it replaced `fratraadt`, which brreg removed on 2026-06-16. Read
  // both through isResigned() in src/lib/roller.ts.
  avregistrert?: boolean;
  fratraadt?: boolean;
  rekkefolge?: number;
}

export interface RolleGruppe {
  type: Kode;
  sistEndret?: string;
  roller?: Rolle[];
}

export interface RollerResponse {
  rollegrupper?: RolleGruppe[];
}

export interface Underenhet {
  organisasjonsnummer: string;
  navn: string;
  // 'Underenhet', or 'SlettetUnderEnhet' for a deleted one — whose
  // minimal body has a slettedato and NO overordnetEnhet.
  respons_klasse?: string;
  overordnetEnhet?: string;
  organisasjonsform?: Kode;
  naeringskode1?: Kode;
  antallAnsatte?: number;
  beliggenhetsadresse?: Adresse;
  oppstartsdato?: string;
  nedleggelsesdato?: string;
  slettedato?: string;
}

// The first page of a parent's underenheter. `total` is brreg's
// page.totalElements, so a capped page can say "Viser 100 av 133"
// instead of passing 100 off as the full count.
export interface UnderenheterPage {
  items: Underenhet[];
  total: number;
}


export interface Regnskap {
  id?: number;
  journalnr?: string;
  regnskapsperiode?: { fraDato?: string; tilDato?: string };
  regnkapsprinsipper?: { smaaForetak?: boolean; regnskapsregler?: string };
  valuta?: string;
  resultatregnskapResultat?: {
    driftsresultat?: {
      driftsresultat?: number;
      driftsinntekter?: { sumDriftsinntekter?: number };
      driftskostnad?: { sumDriftskostnad?: number };
    };
    ordinaertResultatFoerSkattekostnad?: number;
    aarsresultat?: number;
  };
  egenkapitalGjeld?: {
    sumEgenkapitalGjeld?: number;
    egenkapital?: { sumEgenkapital?: number };
  };
}

// What brreg answered for an orgnr's regnskap (see fetchRegnskap):
//   2xx → items: the filings (order not guaranteed — sort by tilDato)
//   404 → items: [] — nothing filed
//   500 → items: [], unavailable: true — the open API can't serve this
//         filing. Banks and insurers hit this every time (specialised
//         oppstillingsplaner), so it is an outcome, not an outage; the
//         UI explains the gap instead of implying nothing was filed.
// A network failure or any other status rejects instead, which callers
// map to `undefined` ("couldn't ask").
export interface RegnskapResponse {
  items: Regnskap[];
  unavailable?: boolean;
  // The plan code ('BANK', 'FORS', …) when the 500 body names it.
  unsupportedPlan?: string;
}

// One JSON-Patch operation from the change feed. The fetcher keeps only
// op and path: the values (addresses, purposes, …) aren't needed to say
// WHAT changed, and leaving them out keeps the cache small.
export interface JsonPatchOp {
  op: string;
  // "/forretningsadresse/postnummer", "/navn", "/antallAnsatte", …
  path: string;
}

// One event from /oppdateringer/enheter?includeChanges=true.
export interface EnhetOppdatering {
  oppdateringsid?: number;
  // When the change was published in the API (ISO timestamp, UTC).
  dato: string;
  // "Endring", "Ny", "Sletting", "Fjernet", "Ukjent". Only Endring
  // events carry `endringer`.
  endringstype?: string;
  endringer?: JsonPatchOp[];
}
