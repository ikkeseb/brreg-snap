// Hostname → brreg resolution. Last tier of the resolve cascade,
// after URL regex and title regex both miss.
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
// churn the API — but only when every constituent query succeeded.
// Partial/failed runs return a best-effort result uncached so the
// next visit retries instead of serving a 24h "no match". User picker
// choices cache separately under `picker-choice:<host>` and win over
// any cached band.

import { searchEnheterWithParams } from './brreg.js';
import {
  decideBand,
  generateNordicVariants,
  hostnameLabel,
  scoreCandidate,
  type ResolutionBand,
} from './hostname-score.js';
import { cacheGet, cacheSet } from './session-cache.js';
import type { SearchHit } from '../types/brreg.js';

const KEY_PREFIX = 'hostname:';
const CHOICE_KEY_PREFIX = 'picker-choice:';
const REJECTED_KEY_PREFIX = 'rejected:';
// Single source of truth for the picker-candidate cap. Tied to the
// keyboard shortcuts (1-4) the popup and sidebar expose for the picker
// — bumping this number requires extending the shortcut handler too.
export const MAX_PICKER_CANDIDATES = 4;

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
  // False when one or more constituent brreg queries failed — the
  // band is then a best-effort guess, and a 'none' must not be
  // presented to the user as a confirmed "no match".
  complete: boolean;
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

// Rejected orgnrs the user said "stemmer ikke" on for this host. Kept
// separate from picker-choice so the latter stays a simple
// string|null. The pipeline filters these out before scoring, and the
// band cache key folds in the set so a fresh rejection doesn't serve
// a stale pre-rejection result.
export async function getRejectedChoices(host: string): Promise<string[]> {
  return (
    (await cacheGet<string[]>(`${REJECTED_KEY_PREFIX}${host}`)) ?? []
  );
}

export async function addRejectedChoice(
  host: string,
  orgnr: string,
): Promise<void> {
  const current = await getRejectedChoices(host);
  if (!current.includes(orgnr)) {
    await cacheSet(`${REJECTED_KEY_PREFIX}${host}`, [...current, orgnr]);
  }
  // If a positive picker-choice equals this orgnr it would otherwise
  // keep short-circuiting all future resolutions to the rejected
  // entity — drop it so the next call re-runs the pipeline with the
  // rejection in effect.
  const choice = await getPickerChoice(host);
  if (choice === orgnr) {
    try {
      await browser.storage.session.remove(`${CHOICE_KEY_PREFIX}${host}`);
    } catch {
      /* best-effort — TTL will sweep it eventually */
    }
  }
}

// Pull the brandable label out of a hostname for use as a search
// query. Re-exported from hostname-score so existing callers
// (tests, etc.) don't need a different import.
export function queryFromHostname(hostname: string): string | undefined {
  return hostnameLabel(hostname);
}

// Outcome of one query group. `ok` is true only when every constituent
// fetch succeeded — a partially failed group can still contribute hits
// (best effort), but the run must not be treated as authoritative.
interface QueryOutcome {
  hits: SearchHit[];
  ok: boolean;
}

// searchEnheterWithParams throws on network failure / non-2xx; settle
// each fetch so one hiccup doesn't sink the parallel siblings, while
// still recording that the group is incomplete.
async function settleSearches(
  searches: Promise<SearchHit[]>[],
): Promise<QueryOutcome> {
  const settled = await Promise.allSettled(searches);
  return {
    hits: settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : [])),
    ok: settled.every((s) => s.status === 'fulfilled'),
  };
}

async function queryByHjemmeside(host: string): Promise<QueryOutcome> {
  const bare = host.replace(/^www\./i, '').toLowerCase();
  const variants = [bare, `www.${bare}`];
  return settleSearches(
    variants.map((v) => {
      const params = new URLSearchParams();
      params.set('hjemmeside', v);
      params.set('size', '10');
      return searchEnheterWithParams(params);
    }),
  );
}

async function queryByNavn(
  label: string,
  withFilter: boolean,
): Promise<QueryOutcome> {
  const variants = generateNordicVariants(label);
  return settleSearches(
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
}

function dedupeByOrgnr(hits: SearchHit[]): SearchHit[] {
  const seen = new Map<string, SearchHit>();
  for (const h of hits) {
    if (!seen.has(h.organisasjonsnummer)) seen.set(h.organisasjonsnummer, h);
  }
  return [...seen.values()];
}

interface PipelineOutcome {
  result: HostnameResult;
  // True only when every constituent brreg query succeeded. Only
  // complete runs may enter the band cache — caching a result built on
  // partial data (offline, 429, 503, timeout) would pin a wrong "no
  // match" for 24h. Incomplete runs still return their best-effort
  // result; the all-failed case falls out naturally as band 'none'
  // with complete=false.
  complete: boolean;
}

async function runPipeline(
  host: string,
  label: string,
  rejected: string[] = [],
): Promise<PipelineOutcome> {
  const [byHj, byNavn] = await Promise.all([
    queryByHjemmeside(host),
    queryByNavn(label, true),
  ]);
  let complete = byHj.ok && byNavn.ok;

  let candidates = dedupeByOrgnr([...byHj.hits, ...byNavn.hits]);

  // Q3 fallback — drop the org-form filter only if Q1+Q2 yielded zero.
  // Catches ORGL/SF entities like EKSPORTFINANSIERING NORGE without
  // re-adding the FLI/ENK noise we filtered out otherwise.
  if (candidates.length === 0) {
    const fallback = await queryByNavn(label, false);
    complete = complete && fallback.ok;
    candidates = dedupeByOrgnr(fallback.hits);
  }

  if (rejected.length > 0) {
    const rejSet = new Set(rejected);
    candidates = candidates.filter(
      (c) => !rejSet.has(c.organisasjonsnummer),
    );
  }

  if (candidates.length === 0) {
    return { result: { band: 'none', candidates: [] }, complete };
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
      result: {
        band: 'auto',
        orgnr: top.cand.organisasjonsnummer,
        candidates: scored.slice(0, MAX_PICKER_CANDIDATES).map((s) => s.cand),
      },
      complete,
    };
  }
  if (band === 'picker') {
    return {
      result: {
        band: 'picker',
        candidates: scored.slice(0, MAX_PICKER_CANDIDATES).map((s) => s.cand),
      },
      complete,
    };
  }
  return { result: { band: 'none', candidates: [] }, complete };
}

function bandCacheKey(host: string, rejected: string[]): string {
  if (rejected.length === 0) return `${KEY_PREFIX}${host}`;
  // Sort so two callers passing the same set in different orders hit
  // the same cache entry. `|` is safe — orgnrs are 9 digits.
  const sorted = [...rejected].sort().join('|');
  return `${KEY_PREFIX}${host}:rej:${sorted}`;
}

// Internal: resolve via cache + pipeline. Returns the rich result; the
// public wrappers below adapt it to their own return shapes.
async function resolveInternal(
  hostname: string,
  rejected: string[] = [],
): Promise<PipelineOutcome> {
  const label = queryFromHostname(hostname);
  if (!label) {
    // No usable label is a deterministic property of the hostname, not
    // a network outcome — safe to cache.
    const empty: HostnameResult = { band: 'none', candidates: [] };
    await cacheSet(bandCacheKey(hostname, rejected), empty);
    return { result: empty, complete: true };
  }

  const cacheKey = bandCacheKey(hostname, rejected);
  const cached = await cacheGet<HostnameResult>(cacheKey);
  if (cached) return { result: cached, complete: true };

  const outcome = await runPipeline(hostname, label, rejected);

  // Only cache runs where every query succeeded. A partial or failed
  // run still returns its best-effort result, but skipping the write
  // means the next visit retries instead of serving a 24h miss.
  if (outcome.complete) {
    await cacheSet(cacheKey, outcome.result);
  }
  return outcome;
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
  const rejected = await getRejectedChoices(hostname);
  const { result } = await resolveInternal(hostname, rejected);
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
      return { band: 'none', candidates: [], complete: true };
    }
    return { band: 'auto', candidates: [], choice, complete: true };
  }
  const rejected = await getRejectedChoices(hostname);
  const { result, complete } = await resolveInternal(hostname, rejected);
  if (result.band === 'auto') {
    return {
      band: 'auto',
      candidates: result.candidates,
      choice: result.orgnr,
      complete,
    };
  }
  if (result.band === 'picker') {
    return { band: 'picker', candidates: result.candidates, complete };
  }
  return { band: 'none', candidates: [], complete };
}
