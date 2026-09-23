// Everything one company view needs from brreg, and the one place that
// decides what a failed fetch means. Shared by the popup and the panel.
//
// - The Enhet is the hard dependency: if it fails, the view fails.
// - roller / underenheter / regnskap are soft: a failure maps to
//   undefined ("couldn't ask"), which each renderer states as such.
//   That is distinct from an empty registry answer ("none registered").
//   The opt-in parts konsern and aarsregnskapYears follow the same
//   rule; the panel asks for them, the popup doesn't.
// - An orgnr that is not an enhet may be an underenhet: a branch or
//   department, the number on a store receipt or a branch page. brreg
//   has no enhet for it, so the view shows its parent and carries the
//   branch along as `avdeling`.

import { fetchAarsregnskapYears } from './aarsregnskap.js';
import {
  fetchEnhet,
  fetchRegnskap,
  fetchRoller,
  fetchUnderenhet,
  fetchUnderenheter,
  getFetchedAt,
} from './brreg.js';
import { deriveKonsern, fetchKonsernstruktur, type Konsern } from './konsern.js';
import type {
  Enhet,
  RegnskapResponse,
  RollerResponse,
  Underenhet,
  UnderenheterPage,
} from '../types/brreg.js';

// fetchEnhet's 404. Matched on its message, like describeLoadError does
// (same repo, pinned by tests/brreg.test.ts).
export function isNotFoundError(err: unknown): boolean {
  return err instanceof Error && /^No entity found for orgnr /.test(err.message);
}

// The orgnr is an underenhet, but a deleted one: brreg's minimal
// SlettetUnderEnhet body names no parent, so there is nothing to show.
export class DeletedAvdelingError extends Error {
  constructor(readonly avdeling: Underenhet) {
    super(`Underenhet ${avdeling.organisasjonsnummer} is deleted.`);
    this.name = 'DeletedAvdelingError';
  }
}

// A failure that asking again can't fix: the registry has answered.
// The UI offers no «Prøv igjen» for these.
export function isPermanentLoadError(err: unknown): boolean {
  return isNotFoundError(err) || err instanceof DeletedAvdelingError;
}

export interface OrgnrMatch {
  // The enhet to show: the orgnr itself, or an underenhet's parent.
  enhet: Enhet;
  // Set when the orgnr was an underenhet.
  avdeling?: Underenhet;
}

// orgnr → the enhet to show. Rejects with fetchEnhet's not-found error
// when the orgnr is neither an enhet nor an underenhet, with
// DeletedAvdelingError for a deleted underenhet, and with the network
// error when brreg can't be asked.
export async function lookupOrgnr(orgnr: string): Promise<OrgnrMatch> {
  try {
    return { enhet: await fetchEnhet(orgnr) };
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
    const avdeling = await fetchUnderenhet(orgnr);
    if (!avdeling) throw err;
    if (!avdeling.overordnetEnhet) throw new DeletedAvdelingError(avdeling);
    return { enhet: await fetchEnhet(avdeling.overordnetEnhet), avdeling };
  }
}

interface SoftParts {
  roller: RollerResponse | undefined;
  regnskap: RegnskapResponse | undefined;
  underenheter: UnderenheterPage | undefined;
  // Years with an annual-report copy, newest first; [] = none. Only
  // fetched with `aarsregnskapYears: true`.
  aarsregnskapYears: string[] | undefined;
}

export interface LoadOptions {
  // The popup doesn't list underenheter, so it doesn't fetch them.
  underenheter?: boolean;
  // Where the company sits in its group. Fetched only when the Enhet
  // says erIKonsern.
  konsern?: boolean;
  // The annual-report year list (for the PDF links).
  aarsregnskapYears?: boolean;
}

function fetchSoftParts(orgnr: string, opts: LoadOptions): Promise<SoftParts> {
  return Promise.all([
    fetchRoller(orgnr).catch((): RollerResponse | undefined => undefined),
    fetchRegnskap(orgnr).catch((): RegnskapResponse | undefined => undefined),
    opts.underenheter
      ? fetchUnderenheter(orgnr).catch((): UnderenheterPage | undefined => undefined)
      : undefined,
    opts.aarsregnskapYears
      ? fetchAarsregnskapYears(orgnr).catch((): string[] | undefined => undefined)
      : undefined,
  ]).then(([roller, regnskap, underenheter, aarsregnskapYears]) => ({
    roller,
    regnskap,
    underenheter,
    aarsregnskapYears,
  }));
}

// null = asked, and the company is in no group (erIKonsern false, a
// 404, or brreg's tree doesn't list it); undefined = couldn't ask.
function loadKonsern(enhet: Enhet): Promise<Konsern | null | undefined> {
  if (enhet.erIKonsern !== true) return Promise.resolve(null);
  const orgnr = enhet.organisasjonsnummer;
  return fetchKonsernstruktur(orgnr)
    .then((tree) => (tree && deriveKonsern(tree, orgnr)) ?? null)
    .catch((): undefined => undefined);
}

export interface CompanyData extends OrgnrMatch, SoftParts {
  // Only with `konsern: true` (else undefined): the company's place in
  // its group, null when it is in none, undefined when brreg couldn't
  // be asked.
  konsern: Konsern | null | undefined;
  // When this data was fetched from brreg (ms epoch): the oldest of its
  // cached parts, since a cache hit can be up to a day old.
  fetchedAt: number;
}

export async function loadCompany(
  orgnr: string,
  opts: LoadOptions = {},
): Promise<CompanyData> {
  // Start the soft fetches alongside the Enhet: the user waits on the
  // slowest request, and almost every orgnr is an enhet. They never
  // reject, so leaving them behind on the underenhet path is safe.
  const guessed = fetchSoftParts(orgnr, opts);
  const match = await lookupOrgnr(orgnr);
  const shown = match.enhet.organisasjonsnummer;
  // An underenhet has no roller or regnskap of its own; the parent's
  // are what the view shows. Konsern needs the Enhet's erIKonsern, so
  // it can only start now.
  const [soft, konsern] = await Promise.all([
    shown === orgnr ? guessed : fetchSoftParts(shown, opts),
    opts.konsern ? loadKonsern(match.enhet) : undefined,
  ]);
  const ages = await Promise.all(
    [...new Set([orgnr, shown])].map((n) => getFetchedAt(n)),
  );
  const cached = ages.filter((t): t is number => t !== undefined);
  // Nothing cached (the write failed) means it all came from brreg
  // just now.
  const fetchedAt = cached.length > 0 ? Math.min(...cached) : Date.now();
  return { ...match, ...soft, konsern, fetchedAt };
}
