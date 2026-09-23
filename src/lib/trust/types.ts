// The shared vocabulary of the trust view: everything the popup and the
// panel say about a company, on one tone scale. The derivations live
// next to this file (one module per concern); the surfaces only render
// what they return.
//
// House rules every derivation follows:
//   - Facts, not accusations. Wording states what the registry says.
//   - A signal whose data couldn't be fetched is omitted, never shown
//     as «Ingen» / «not filed».
//   - Tone is never carried by colour alone: every tone has a glyph
//     (TONE_GLYPH) and the surfaces render it next to the text.

export type Tone = 'ok' | 'warn' | 'danger' | 'neutral';

// ✓ ok · ! warn · ✕ danger · · neutral — rendered aria-hidden next to
// the text; screen readers get TONE_PREFIX instead.
export const TONE_GLYPH: Record<Tone, string> = {
  ok: '✓',
  warn: '!',
  danger: '✕',
  neutral: '·',
};

// Visually hidden prefix so a screen reader hears the tone, too.
export const TONE_PREFIX: Record<Tone, string> = {
  ok: '',
  warn: 'Obs: ',
  danger: 'Advarsel: ',
  neutral: '',
};

export type SignalKey = 'kobling' | 'status' | 'alder' | 'ansatte' | 'regnskap';

// One fact row under the answer headline.
export interface Signal {
  key: SignalKey;
  // «Status», «Alder», …
  label: string;
  // «Aktiv», «54 år», «2025 levert»
  value: string;
  // «stiftet 1972», «omsetning 68,0 mrd USD · resultat 8,8 mrd USD»
  detail?: string;
  tone: Tone;
}

// How the site on screen relates to the company shown — the one signal
// no other lookup tool gives. Derived in kobling.ts from how the orgnr
// was found (ResolutionMethod) and the company's registered hjemmeside.
export type KoblingKind =
  // The site's registrable domain is the company's registered hjemmeside.
  | 'registered'
  // The orgnr came from the site's own URL or title and the company has
  // no hjemmeside to compare with: the site's claim, unverified.
  | 'site-claims'
  // The orgnr came from the site's own URL or title, but the company's
  // registered hjemmeside is another domain. Anyone can paste an orgnr
  // into a page: this is the spoofing signature.
  | 'mismatch'
  // The hostname search matched on the company name only; the company
  // has no registered hjemmeside.
  | 'name-guess'
  // The hostname search matched, but the registered hjemmeside is
  // another domain (komplett.no → komplettgroup.com).
  | 'other-site'
  // The user picked this company for this site (picker).
  | 'chosen'
  // The site is a company directory (brreg.no, proff.no, …) showing
  // someone else's orgnr — not a claim to be that company.
  | 'directory';

export interface Kobling extends Signal {
  key: 'kobling';
  kind: KoblingKind;
  // The site on screen (hostname as the tab reported it).
  host: string;
  // The company's registered hjemmeside, as a registrable domain, when
  // it has one.
  registeredDomain?: string;
}

// A registry annotation (påtegning), quoted verbatim — the registry's
// words, not ours.
export interface Merknad {
  text: string;
  // ISO date the annotation was entered.
  since?: string;
  // brreg's infotype code (FADR, DAGL, …), when present.
  infotype?: string;
}

export type EndringKind = 'navn' | 'adresse' | 'daglig-leder' | 'styre';

// A recent change worth knowing about (name/address in the last 6
// months, daglig leder / board in the last 90 days).
export interface Endring {
  kind: EndringKind;
  // ISO date of the change.
  date: string;
  // «Nytt navn 12. juni 2026 (tidligere LUNDE FASADE AS)»
  text: string;
}

export type FindingSource =
  | 'status'
  | 'kobling'
  | 'merknad'
  | 'alder'
  | 'regnskap';

// One thing worth the user's attention (warn or danger), in priority
// order. The answer headline summarises these; the surfaces may list
// them under it.
export interface Finding {
  tone: 'warn' | 'danger';
  source: FindingSource;
  // «Under avvikling siden 3. mars 2026», «Usikker kobling til
  // bbc.co.uk», the quoted påtegning, …
  text: string;
}

// The one-line answer at the top of both surfaces, in the tone of the
// most severe finding. `neutral` never heads the view: with nothing to
// report the answer is ok («Ingen varsler i registeret»).
export interface Answer {
  tone: Exclude<Tone, 'neutral'>;
  // «Konkurs siden 26. aug. 2026», «Usikker kobling til bbc.co.uk»,
  // «2 ting å merke seg», «Ingen varsler i registeret»
  headline: string;
  // One supporting line: bostyrer, the mismatch explanation, …
  supporting?: string;
  // Every warn/danger finding, most severe first. Empty when ok.
  findings: Finding[];
}
