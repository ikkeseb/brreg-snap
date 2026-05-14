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
  konkurs?: boolean;
  underAvvikling?: boolean;
  underTvangsavviklingEllerTvangsopplosning?: boolean;
}

export type SearchHit = Pick<Enhet, 'organisasjonsnummer' | 'navn'> &
  Partial<Enhet>;
