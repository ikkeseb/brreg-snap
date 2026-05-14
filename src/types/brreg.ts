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
