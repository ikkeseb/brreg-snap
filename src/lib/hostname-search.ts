// Hostname → brreg resolution. Last tier of the resolve cascade,
// after URL regex and title regex both miss.
//
// Runs brreg queries in parallel (hjemmeside on the registrable
// domain, navn FORTLOEPENDE with org-form filter per Nordic variant,
// fallback navn without filter), aggregates + scores candidates via
// src/lib/hostname-score.ts, and picks one of three outcomes:
//
//   - 'auto'   → confident match, resolves to a single orgnr
//   - 'picker' → ambiguous, return top candidates for sidebar UI
//   - 'none'   → no plausible match, surface manual-search UX
//
// Everything is keyed by the SITE — the registrable domain — not the
// literal hostname: www.dnb.no, dnb.no and nettbank.dnb.no share one
// band cache entry, one picker choice and one rejection list.
//
// Cached per site in storage.session (24h) so re-visits don't churn
// the API — but only when every constituent query succeeded.
// Partial/failed runs return a best-effort result uncached so the
// next visit retries instead of serving a 24h "no match". User picker
// choices cache separately under `picker-choice:<site>` and win over
// any cached band. forgetHost clears all of it for one site.

import { searchEnheterWithParams } from './brreg.js';
import {
  decideBand,
  generateNordicVariants,
  hostnameLabel,
  registrableDomain,
  scoreCandidate,
  titleSegmentations,
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

// What ties a candidate to the site, for the picker's per-row label:
// 'hjemmeside' — its registered hjemmeside is this site (the site
// itself, a page on it or a subdomain); 'navn' — only its name matched
// the hostname.
export type CandidateEvidence = 'hjemmeside' | 'navn';

export interface Candidate extends SearchHit {
  evidence: CandidateEvidence;
}

export type HostnameResult =
  | { band: 'auto'; orgnr: string; candidates: Candidate[] }
  | { band: 'picker'; candidates: Candidate[] }
  | { band: 'none'; candidates: [] };

export interface DetailedResult {
  band: ResolutionBand;
  candidates: Candidate[];
  // Populated when the user has previously picked a candidate for
  // this site. band is 'auto' in that case; sidebar loads `choice`
  // directly. A cached negative choice ("Ingen av disse") becomes
  // band='none' with `choice` undefined.
  choice?: string;
  // False when one or more constituent brreg queries failed — the
  // band is then a best-effort guess, and a 'none' must not be
  // presented to the user as a confirmed "no match".
  complete: boolean;
}

// The key every per-site entry is stored under: the registrable domain
// (nettbank.dnb.no → dnb.no), or for hosts that have none (IP
// literals, intranet names) the bare lowercase host.
export function siteKey(host: string): string {
  return (
    registrableDomain(host) ??
    host.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '')
  );
}

// Public helpers for the surfaces to read/write the user's picker
// choice. `value=null` represents "Ingen av disse" — a deliberate
// negative answer, distinct from "no cache entry".
export async function getPickerChoice(
  host: string,
): Promise<string | null | undefined> {
  const value = await cacheGet<unknown>(`${CHOICE_KEY_PREFIX}${siteKey(host)}`);
  return value === null || typeof value === 'string' ? value : undefined;
}

export async function setPickerChoice(
  host: string,
  value: string | null,
): Promise<void> {
  await cacheSet(`${CHOICE_KEY_PREFIX}${siteKey(host)}`, value);
}

// Rejected orgnrs the user said "stemmer ikke" on for this site. Kept
// separate from picker-choice so the latter stays a simple
// string|null. The pipeline filters these out before scoring, the
// URL/title tier skips them (resolve-tab.ts), and the band cache key
// folds in the set so a fresh rejection doesn't serve a stale
// pre-rejection result.
export async function getRejectedChoices(host: string): Promise<string[]> {
  const value = await cacheGet<unknown>(
    `${REJECTED_KEY_PREFIX}${siteKey(host)}`,
  );
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

export async function addRejectedChoice(
  host: string,
  orgnr: string,
): Promise<void> {
  const current = await getRejectedChoices(host);
  if (!current.includes(orgnr)) {
    await cacheSet(`${REJECTED_KEY_PREFIX}${siteKey(host)}`, [
      ...current,
      orgnr,
    ]);
  }
  // If a positive picker-choice equals this orgnr it would otherwise
  // keep short-circuiting all future resolutions to the rejected
  // entity — drop it so the next call re-runs the pipeline with the
  // rejection in effect.
  const choice = await getPickerChoice(host);
  if (choice === orgnr) {
    try {
      await browser.storage.session.remove(
        `${CHOICE_KEY_PREFIX}${siteKey(host)}`,
      );
    } catch {
      /* best-effort — TTL will sweep it eventually */
    }
  }
}

// What the user has told us about this site, if anything — for the
// «Glem valget for <host>» action. A choice wins over a rejection list
// (it short-circuits the search); 'none' is a stored «Ingen av disse».
export type RememberedChoice =
  | { kind: 'choice'; orgnr: string }
  | { kind: 'none' }
  | { kind: 'rejected'; orgnrs: string[] };

export async function getRememberedChoice(
  host: string,
): Promise<RememberedChoice | undefined> {
  const choice = await getPickerChoice(host);
  if (typeof choice === 'string') return { kind: 'choice', orgnr: choice };
  if (choice === null) return { kind: 'none' };
  const orgnrs = await getRejectedChoices(host);
  return orgnrs.length > 0 ? { kind: 'rejected', orgnrs } : undefined;
}

const SITE_PREFIXES = [KEY_PREFIX, CHOICE_KEY_PREFIX, REJECTED_KEY_PREFIX];

// The site a stored key belongs to, or undefined for keys that aren't
// per-site entries. Band keys may carry `:rej:` / `:seg:` suffixes, and
// entries written before site keys existed (1.3.1) are keyed by the
// full hostname — both map back to their site here.
function siteOfKey(key: string): string | undefined {
  const prefix = SITE_PREFIXES.find((p) => key.startsWith(p));
  if (!prefix) return undefined;
  const rest = key.slice(prefix.length).split(':')[0];
  return rest ? siteKey(rest) : undefined;
}

// «Glem valget»: drop the picker choice, the rejection list and every
// cached band for this site, under every key it may be stored under,
// so the next lookup resolves from scratch. Never throws.
export async function forgetHost(host: string): Promise<void> {
  const site = siteKey(host);
  const direct = new Set<string>();
  for (const h of [host, host.toLowerCase(), site, `www.${site}`]) {
    for (const p of SITE_PREFIXES) direct.add(`${p}${h}`);
  }
  let keys = [...direct];
  try {
    const all = await browser.storage.session.get(null);
    keys = [
      ...new Set([
        ...keys,
        ...Object.keys(all).filter((k) => siteOfKey(k) === site),
      ]),
    ];
  } catch {
    /* can't list — the direct keys cover every current writer */
  }
  try {
    await browser.storage.session.remove(keys);
  } catch {
    /* best-effort — TTL will sweep it eventually */
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

// Q1. Brreg matches hjemmeside as a substring, so one query on the
// registrable domain already returns the www. and subdomain rows —
// and a popular domain returns hundreds (obos.no: 600+ borettslag
// registered on www.obos.no). Sorting by headcount puts the operating
// company on the first page instead of an alphabetical slice of
// satellites; scoreCandidate then keeps only label-boundary matches.
async function queryByHjemmeside(domain: string): Promise<QueryOutcome> {
  const params = new URLSearchParams();
  params.set('hjemmeside', domain);
  params.set('sort', 'antallAnsatte,DESC');
  params.set('size', '20');
  return settleSearches([searchEnheterWithParams(params)]);
}

// Q2's org-form filter keeps the thousands of ENK/FLI namesakes out.
// BBL (boligbyggelag, a few dozen in the registry) is in because
// cooperatives like OBOS BBL run the sites people visit.
const NAVN_ORG_FORMS = 'AS,ASA,SA,BBL,ORGL,SF';

function navnParams(navn: string, withFilter: boolean): URLSearchParams {
  const params = new URLSearchParams();
  params.set('navn', navn);
  params.set('navnMetodeForSoek', 'FORTLOEPENDE');
  params.set('size', '20');
  if (withFilter) {
    params.set('organisasjonsform', NAVN_ORG_FORMS);
    params.set('sort', 'antallAnsatte,DESC');
  }
  return params;
}

async function queryByNavn(
  names: string[],
  withFilter: boolean,
): Promise<QueryOutcome> {
  return settleSearches(
    names.map((n) => searchEnheterWithParams(navnParams(n, withFilter))),
  );
}

// Filtered name queries first; the unfiltered Q3 only when they return
// nothing. Catches ORGL/SF entities like EKSPORTFINANSIERING NORGE
// without re-adding the FLI/ENK noise we filtered out otherwise.
async function queryNames(names: string[]): Promise<QueryOutcome> {
  const filtered = await queryByNavn(names, true);
  if (filtered.hits.length > 0) return filtered;
  const fallback = await queryByNavn(names, false);
  return { hits: fallback.hits, ok: filtered.ok && fallback.ok };
}

function dedupeByOrgnr(hits: SearchHit[]): SearchHit[] {
  const seen = new Map<string, SearchHit>();
  for (const h of hits) {
    if (!seen.has(h.organisasjonsnummer)) seen.set(h.organisasjonsnummer, h);
  }
  return [...seen.values()];
}

// Candidates are copied, never mutated: search hits may be shared.
function toCandidate(
  hit: SearchHit,
  hjemmesideTie: boolean,
): Candidate {
  return { ...hit, evidence: hjemmesideTie ? 'hjemmeside' : 'navn' };
}

// Best score over the name forms a candidate may match.
function bestScore(cand: SearchHit, labels: string[], domain: string) {
  return labels
    .map((label) => scoreCandidate(cand, label, domain))
    .reduce((best, s) => (s.score > best.score ? s : best));
}

// Score, rank and band a candidate set. `labels` are what names are
// matched against (the hostname label, or its title-segmented forms);
// `domain` is the site the hjemmeside must tie to. Scoring against the
// site rather than the literal host keeps one answer per site key.
function decide(
  hits: SearchHit[],
  labels: string[],
  domain: string,
  rejected: string[],
): HostnameResult {
  const rejSet = new Set(rejected);
  const scored = dedupeByOrgnr(hits)
    .filter((c) => !rejSet.has(c.organisasjonsnummer))
    .map((c) => ({ cand: c, ...bestScore(c, labels, domain) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  const band = decideBand(
    top?.score ?? 0,
    scored[1]?.score,
    top?.hjemmesideTie ?? false,
  );
  const candidates = scored
    .slice(0, MAX_PICKER_CANDIDATES)
    .map((s) => toCandidate(s.cand, s.hjemmesideTie));
  if (band === 'auto' && top) {
    return { band: 'auto', orgnr: top.cand.organisasjonsnummer, candidates };
  }
  if (band === 'picker') return { band: 'picker', candidates };
  return { band: 'none', candidates: [] };
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
  domain: string,
  label: string,
  rejected: string[],
): Promise<PipelineOutcome> {
  const [byHj, byNavn] = await Promise.all([
    queryByHjemmeside(domain),
    queryByNavn(generateNordicVariants(label), true),
  ]);
  let complete = byHj.ok && byNavn.ok;
  let hits = [...byHj.hits, ...byNavn.hits];
  // Q3 fallback — drop the org-form filter only if Q1+Q2 yielded zero.
  if (hits.length === 0) {
    const fallback = await queryByNavn(generateNordicVariants(label), false);
    complete = complete && fallback.ok;
    hits = fallback.hits;
  }
  return { result: decide(hits, [label], domain, rejected), complete };
}

// Title segmentation (hostname-score.ts § titleSegmentations): the
// label's own letters re-spaced at the title's word boundaries, sent as
// extra name queries. The site's earlier candidates are re-scored
// against the spaced label together with the new hits, so a picker of
// hjemmeside-only franchisees (rema1000.no) gains the chain itself.
async function runSegmented(
  domain: string,
  queries: string[],
  previous: Candidate[],
  rejected: string[],
): Promise<PipelineOutcome> {
  const byNavn = await queryNames(queries);
  const result = decide([...previous, ...byNavn.hits], queries, domain, rejected);
  return { result, complete: byNavn.ok };
}

function bandCacheKey(site: string, rejected: string[]): string {
  if (rejected.length === 0) return `${KEY_PREFIX}${site}`;
  // Sort so two callers passing the same set in different orders hit
  // the same cache entry. `|` is safe — orgnrs are 9 digits.
  const sorted = [...rejected].sort().join('|');
  return `${KEY_PREFIX}${site}:rej:${sorted}`;
}

function isCandidate(value: unknown): value is Candidate {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Partial<Candidate>;
  return (
    typeof c.organisasjonsnummer === 'string' &&
    typeof c.navn === 'string' &&
    (c.evidence === 'hjemmeside' || c.evidence === 'navn')
  );
}

// Shape guard for band-cache reads: an entry from an older build (no
// `evidence`) or anything else unexpected is a miss, not a crash.
function isHostnameResult(value: unknown): value is HostnameResult {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as { band?: unknown; candidates?: unknown; orgnr?: unknown };
  if (!Array.isArray(r.candidates) || !r.candidates.every(isCandidate)) {
    return false;
  }
  if (r.band === 'auto') return typeof r.orgnr === 'string';
  return r.band === 'picker' || r.band === 'none';
}

// Concurrent lookups of the same site (popup + panel probe, a burst of
// tab events) share one in-flight run per cache key instead of each
// firing the full query fan-out. Per document: the popup and the panel
// are separate pages and coalesce separately; the session cache is
// what they share.
const inflight = new Map<string, Promise<PipelineOutcome>>();

function cachedRun(
  key: string,
  run: () => Promise<PipelineOutcome>,
): Promise<PipelineOutcome> {
  const pending = inflight.get(key);
  if (pending) return pending;
  const promise = (async (): Promise<PipelineOutcome> => {
    const cached = await cacheGet<unknown>(key);
    if (isHostnameResult(cached)) return { result: cached, complete: true };
    const outcome = await run();
    // Only cache runs where every query succeeded. A partial or failed
    // run still returns its best-effort result, but skipping the write
    // means the next visit retries instead of serving a 24h miss.
    if (outcome.complete) await cacheSet(key, outcome.result);
    return outcome;
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

// Whether the title may help: nothing confident, and no candidate
// matched on the name — the label as written found no name at all.
function worthSegmenting(result: HostnameResult): boolean {
  return (
    result.band !== 'auto' &&
    result.candidates.every((c) => c.evidence !== 'navn')
  );
}

// The resolver every live path uses (resolveTabContext, the panel's
// host probe, «Feil bedrift?»). Returns the band + candidates so the
// surfaces can render the picker directly. `title` is the tab title,
// used only as a word-boundary hint for run-together labels.
export async function searchByHostnameDetailed(
  hostname: string,
  title?: string,
): Promise<DetailedResult | undefined> {
  const choice = await getPickerChoice(hostname);
  if (choice !== undefined) {
    if (choice === null) {
      return { band: 'none', candidates: [], complete: true };
    }
    return { band: 'auto', candidates: [], choice, complete: true };
  }

  const domain = registrableDomain(hostname);
  const label = queryFromHostname(hostname);
  if (!domain || !label) {
    // IP literals, intranet hosts and hosts with nothing brandable are
    // decided locally and never sent to brreg. Not cached either: the
    // check is cheap and deterministic, and internal host names have
    // no business sitting in storage.
    return { band: 'none', candidates: [], complete: true };
  }

  const rejected = await getRejectedChoices(hostname);
  const key = bandCacheKey(domain, rejected);
  let { result, complete } = await cachedRun(key, () =>
    runPipeline(domain, label, rejected),
  );

  const queries = title ? titleSegmentations(label, title) : [];
  if (queries.length > 0 && worthSegmenting(result)) {
    const previous = result.candidates;
    const seg = await cachedRun(`${key}:seg:${queries.join('|')}`, () =>
      runSegmented(domain, queries, previous, rejected),
    );
    // A failed spaced query means "couldn't check", even when the
    // plain result stands.
    complete = complete && seg.complete;
    if (seg.result.band !== 'none') result = seg.result;
  }

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
  return { band: 'none', candidates: [], complete: complete };
}
