// Hostname → brreg resolution. Last tier of the resolve cascade,
// after URL regex / title regex / curated domain override all miss.
//
// Runs three parallel brreg queries (hjemmeside, navn FORTLOEPENDE
// with org-form filter, fallback navn without filter), aggregates +
// scores candidates via src/lib/hostname-score.ts, and picks one of
// three outcomes:
//
//   - 'auto'   → confident match, resolves to a single orgnr
//   - 'picker' → ambiguous, return top candidates for sidebar UI
//   - 'none'   → no plausible match, surface manual-search UX
//
// Cached per hostname in storage.session (24h) so re-visits don't
// churn the API. User picker choices cache separately under
// `picker-choice:<host>` and win over any cached band.

import { searchEnheterWithParams } from './brreg.js';
import {
  decideBand,
  generateNordicVariants,
  hostnameLabel,
  scoreCandidate,
  type ResolutionBand,
} from './hostname-score.js';
import type { SearchHit } from '../types/brreg.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_PREFIX = 'hostname:';
const CHOICE_KEY_PREFIX = 'picker-choice:';
const MAX_CANDIDATES_IN_CACHE = 4;

export type HostnameResult =
  | { band: 'auto'; orgnr: string; candidates: SearchHit[] }
  | { band: 'picker'; candidates: SearchHit[] }
  | { band: 'none'; candidates: [] };

export interface DetailedResult {
  band: ResolutionBand;
  candidates: SearchHit[];
  // Populated when the user has previously picked a candidate for
  // this host. band is 'auto' in that case; sidebar loads `choice`
  // directly. A cached negative choice ("Ingen av disse") becomes
  // band='none' with `choice` undefined.
  choice?: string;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

async function cacheGet<T>(key: string): Promise<T | undefined> {
  const store = await browser.storage.session.get(key);
  const entry = store[key] as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    try {
      await browser.storage.session.remove(key);
    } catch {
      /* best-effort */
    }
    return undefined;
  }
  return entry.value;
}

async function cacheSet<T>(key: string, value: T): Promise<void> {
  const entry: CacheEntry<T> = {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  await browser.storage.session.set({ [key]: entry });
}

// Public helpers for the sidebar to read/write the user's picker
// choice. `value=null` represents "Ingen av disse" — a deliberate
// negative answer, distinct from "no cache entry".
export async function getPickerChoice(
  host: string,
): Promise<string | null | undefined> {
  return cacheGet<string | null>(`${CHOICE_KEY_PREFIX}${host}`);
}

export async function setPickerChoice(
  host: string,
  value: string | null,
): Promise<void> {
  await cacheSet(`${CHOICE_KEY_PREFIX}${host}`, value);
}

// Pull the brandable label out of a hostname for use as a search
// query. Re-exported from hostname-score so existing callers
// (tests, etc.) don't need a different import.
export function queryFromHostname(hostname: string): string | undefined {
  return hostnameLabel(hostname);
}

async function queryByHjemmeside(host: string): Promise<SearchHit[]> {
  const bare = host.replace(/^www\./i, '').toLowerCase();
  const variants = [bare, `www.${bare}`];
  const results = await Promise.all(
    variants.map((v) => {
      const params = new URLSearchParams();
      params.set('hjemmeside', v);
      params.set('size', '10');
      return searchEnheterWithParams(params);
    }),
  );
  return results.flat();
}

async function queryByNavn(
  label: string,
  withFilter: boolean,
): Promise<SearchHit[]> {
  const variants = generateNordicVariants(label);
  const results = await Promise.all(
    variants.map((v) => {
      const params = new URLSearchParams();
      params.set('navn', v);
      params.set('navnMetodeForSoek', 'FORTLOEPENDE');
      params.set('size', '20');
      if (withFilter) {
        params.set('organisasjonsform', 'AS,ASA,SA,ORGL,SF');
        params.set('sort', 'antallAnsatte,DESC');
      }
      return searchEnheterWithParams(params);
    }),
  );
  return results.flat();
}

function dedupeByOrgnr(hits: SearchHit[]): SearchHit[] {
  const seen = new Map<string, SearchHit>();
  for (const h of hits) {
    if (!seen.has(h.organisasjonsnummer)) seen.set(h.organisasjonsnummer, h);
  }
  return [...seen.values()];
}

async function runPipeline(
  host: string,
  label: string,
): Promise<HostnameResult> {
  const [byHj, byNavn] = await Promise.all([
    queryByHjemmeside(host),
    queryByNavn(label, true),
  ]);

  let candidates = dedupeByOrgnr([...byHj, ...byNavn]);

  // Q3 fallback — drop the org-form filter only if Q1+Q2 yielded zero.
  // Catches ORGL/SF entities like EKSPORTFINANSIERING NORGE without
  // re-adding the FLI/ENK noise we filtered out otherwise.
  if (candidates.length === 0) {
    candidates = dedupeByOrgnr(await queryByNavn(label, false));
  }

  if (candidates.length === 0) {
    return { band: 'none', candidates: [] };
  }

  const scored = candidates
    .map((c) => ({ cand: c, ...scoreCandidate(c, label, host) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  const runnerUp = scored[1];
  const band = decideBand(top?.score ?? 0, runnerUp?.score);

  if (band === 'auto' && top) {
    return {
      band: 'auto',
      orgnr: top.cand.organisasjonsnummer,
      candidates: scored.slice(0, MAX_CANDIDATES_IN_CACHE).map((s) => s.cand),
    };
  }
  if (band === 'picker') {
    return {
      band: 'picker',
      candidates: scored.slice(0, MAX_CANDIDATES_IN_CACHE).map((s) => s.cand),
    };
  }
  return { band: 'none', candidates: [] };
}

// Internal: resolve via cache + pipeline. Returns the rich result; the
// public wrappers below adapt it to their own return shapes.
async function resolveInternal(
  hostname: string,
): Promise<HostnameResult | undefined> {
  const label = queryFromHostname(hostname);
  if (!label) {
    const empty: HostnameResult = { band: 'none', candidates: [] };
    await cacheSet(`${KEY_PREFIX}${hostname}`, empty);
    return empty;
  }

  const cacheKey = `${KEY_PREFIX}${hostname}`;
  const cached = await cacheGet<HostnameResult>(cacheKey);
  if (cached) return cached;

  let result: HostnameResult;
  try {
    result = await runPipeline(hostname, label);
  } catch {
    // Network glitch — don't cache, next visit retries. The popup /
    // sidebar already handle undefined gracefully.
    return undefined;
  }

  await cacheSet(cacheKey, result);
  return result;
}

// Backwards-compatible AUTO-only resolver. Used by the sync cascade
// in src/lib/orgnr.ts and by the popup/background flows that only
// want a confident orgnr or nothing.
export async function searchByHostname(
  hostname: string,
): Promise<string | undefined> {
  const choice = await getPickerChoice(hostname);
  if (choice !== undefined) {
    // User explicitly chose for this host. Positive choice → that
    // orgnr; negative choice (null) → no match.
    return choice ?? undefined;
  }
  const result = await resolveInternal(hostname);
  if (!result) return undefined;
  return result.band === 'auto' ? result.orgnr : undefined;
}

// Picker-aware resolver. Returns the band + candidates so the sidebar
// can render the picker UI directly.
export async function searchByHostnameDetailed(
  hostname: string,
): Promise<DetailedResult | undefined> {
  const choice = await getPickerChoice(hostname);
  if (choice !== undefined) {
    if (choice === null) {
      return { band: 'none', candidates: [] };
    }
    return { band: 'auto', candidates: [], choice };
  }
  const result = await resolveInternal(hostname);
  if (!result) return undefined;
  if (result.band === 'auto') {
    return {
      band: 'auto',
      candidates: result.candidates,
      choice: result.orgnr,
    };
  }
  if (result.band === 'picker') {
    return { band: 'picker', candidates: result.candidates };
  }
  return { band: 'none', candidates: [] };
}
