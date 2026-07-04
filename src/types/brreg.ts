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

export interface Enhet {
  organisasjonsnummer: string;
  navn: string;
  organisasjonsform?: Kode;
  registreringsdatoEnhetsregisteret?: string;
  registrertIMvaregisteret?: boolean;
  registrertIForetaksregisteret?: boolean;
  registrertIStiftelsesregisteret?: boolean;
  registrertIFrivillighetsregisteret?: boolean;
  naeringskode1?: Kode;
  antallAnsatte?: number;
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
  underAvvikling?: boolean;
  underTvangsavviklingEllerTvangsopplosning?: boolean;
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

export interface Rolle {
  type: Kode;
  person?: Person;
  enhet?: RolleEnhet;
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
  id?: { orgnr: string };
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

// The regnskapsregisteret endpoint returns an array of filed regnskap,
// but order is not guaranteed — callers must sort by tilDato.
// `unsupportedPlan` is populated when brreg refuses to serialise the
// filing because it uses a specialised oppstillingsplan (e.g. 'BANK'
// or 'FORS' — banks/insurance). items[] is empty in that case, and
// the UI should explain the gap rather than imply nothing is filed.
export interface RegnskapResponse {
  items: Regnskap[];
  unsupportedPlan?: string;
}
