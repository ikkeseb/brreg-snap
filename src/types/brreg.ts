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
// business address. Typed for completeness; not rendered.
export interface Paategning {
  infotype?: string;
  tekst?: string;
  innfoertDato?: string;
}

export interface Enhet {
  organisasjonsnummer: string;
  navn: string;
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
  antallAnsatte?: number;
  // Present on every live Enhet (false = no employees registered);
  // absent on a SlettetEnhet, which carries no employee data at all.
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

// The bankruptcy trustee on a BOBE role. Unlike person/enhet it is a
// flat name string (usually "Adv. <navn>") plus the trustee's postal
// address — the contact a creditor of a bankrupt company needs.
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
  overordnetEnhet?: string;
  organisasjonsform?: Kode;
  naeringskode1?: Kode;
  antallAnsatte?: number;
  beliggenhetsadresse?: Adresse;
  oppstartsdato?: string;
  nedleggelsesdato?: string;
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
