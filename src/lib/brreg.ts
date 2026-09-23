import { cacheGet, cacheSet, cacheStoredAt } from './session-cache.js';
import type {
  Enhet,
  Regnskap,
  RegnskapResponse,
  RollerResponse,
  SearchHit,
  Underenhet,
  UnderenheterPage,
} from '../types/brreg.js';

export const API = 'https://data.brreg.no/enhetsregisteret/api';
const REGNSKAP_API = 'https://data.brreg.no/regnskapsregisteret/regnskap';
// Hard cap per request so a hung connection fails fast instead of
// leaving the UI in a spinner. AbortSignal.timeout() is supported in
// Firefox 100+ / Chrome 103+ — well below our minimum targets. An
// abort rejects the fetch, which counts as a failure like any other
// network error — callers decide what failure means.
export const FETCH_TIMEOUT_MS = 8000;

// The longest Retry-After a 429 may ask for and still get its one
// retry. Longer than this the user is better served by «prøv igjen»
// than by a spinner.
export const MAX_RETRY_AFTER_MS = 5000;

// Retry-After is either delay-seconds or an HTTP-date (RFC 9110
// § 10.2.3). Returns the wait in ms, or undefined when the header is
// missing or unparsable. A date in the past is "now" (0).
export function parseRetryAfter(
  value: string | null,
  now: number = Date.now(),
): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  // An HTTP-date always names its weekday and month; without letters
  // Date.parse would read "-1" as the year -1.
  if (!/[a-z]/i.test(trimmed)) return undefined;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}

// Every brreg request goes through here: JSON accept header, the
// timeout, and at most ONE retry on 429 when Retry-After asks for no
// more than MAX_RETRY_AFTER_MS. Otherwise the 429 response is handed
// back as is, and the caller's `!res.ok` branch turns it into the
// usual transient «returned 429» error (docs/notes/brreg-api.md
// § rate-limit). Exported so the other brreg fetchers (the change feed,
// konsern, annual reports) get the same timeout and 429 rule.
export async function brregFetch(url: string | URL): Promise<Response> {
  const init = (): RequestInit => ({
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const res = await fetch(url, init());
  if (res.status !== 429) return res;
  const wait = parseRetryAfter(res.headers.get('Retry-After'));
  if (wait === undefined || wait > MAX_RETRY_AFTER_MS) return res;
  await new Promise<void>((resolve) => setTimeout(resolve, wait));
  return fetch(url, init());
}

// A regnskap 500 is stable for banks and insurers, but it is also what
// a genuine brreg outage looks like — so it is cached for hours, not a
// day, and a real outage heals on its own.
const REGNSKAP_UNAVAILABLE_TTL_MS = 6 * 60 * 60 * 1000;

// Cache-key prefixes used by all fetchers. invalidateCache() and
// getFetchedAt() walk these for everything related to a single orgnr.
const CACHE_PREFIXES = [
  'enhet',
  'underenhet',
  'roller',
  'underenheter',
  'regnskap',
  // The change feed (src/lib/brreg-endringer.ts).
  'endringer',
] as const;

function isEnhet(value: unknown): value is Enhet {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { organisasjonsnummer?: unknown }).organisasjonsnummer ===
      'string' &&
    typeof (value as { navn?: unknown }).navn === 'string'
  );
}

export async function fetchEnhet(orgnr: string): Promise<Enhet> {
  const key = `enhet:${orgnr}`;
  const cached = await cacheGet<Enhet>(key);
  if (cached) return cached;

  const res = await brregFetch(`${API}/enheter/${orgnr}`);
  if (res.status === 404) {
    throw new Error(`No entity found for orgnr ${orgnr}.`);
  }
  if (!res.ok) {
    throw new Error(`brreg API returned ${res.status}.`);
  }
  const data: unknown = await res.json();
  if (!isEnhet(data)) {
    throw new Error('brreg returned an unexpected response shape.');
  }
  await cacheSet(key, data);
  return data;
}

export async function searchEnheter(
  query: string,
  size = 10,
): Promise<SearchHit[]> {
  const url = new URL(`${API}/enheter`);
  url.searchParams.set('navn', query);
  url.searchParams.set('size', String(size));
  const res = await brregFetch(url);
  if (!res.ok) throw new Error(`brreg search returned ${res.status}.`);
  const data = (await res.json()) as {
    _embedded?: { enheter?: SearchHit[] };
  };
  return data._embedded?.enheter ?? [];
}

// Multi-parameter search for the hostname-resolution pipeline. Callers
// pass a fully constructed URLSearchParams so they can mix
// `hjemmeside`, `navn`, `navnMetodeForSoek`, `organisasjonsform`,
// `sort`, `size`, etc. without an option-soup signature. Network
// failures (incl. timeouts) and non-2xx responses THROW — the pipeline
// must be able to tell "no hits" from "couldn't ask", or an offline /
// throttled moment would get cached as a 24h "no match". [] means a
// genuine 2xx response with zero hits, nothing else.
export async function searchEnheterWithParams(
  params: URLSearchParams,
): Promise<SearchHit[]> {
  const url = new URL(`${API}/enheter`);
  for (const [k, v] of params) url.searchParams.set(k, v);
  const res = await brregFetch(url);
  if (!res.ok) throw new Error(`brreg search returned ${res.status}.`);
  const data = (await res.json()) as {
    _embedded?: { enheter?: SearchHit[] };
  };
  return data._embedded?.enheter ?? [];
}

function isRollerResponse(value: unknown): value is RollerResponse {
  if (typeof value !== 'object' || value === null) return false;
  const groups = (value as { rollegrupper?: unknown }).rollegrupper;
  return groups === undefined || Array.isArray(groups);
}

export async function fetchRoller(orgnr: string): Promise<RollerResponse> {
  const key = `roller:${orgnr}`;
  const cached = await cacheGet<RollerResponse>(key);
  if (cached) return cached;

  const res = await brregFetch(`${API}/enheter/${orgnr}/roller`);
  if (res.status === 404) {
    // No roles registered — treat as empty rather than a hard error.
    const empty: RollerResponse = { rollegrupper: [] };
    await cacheSet(key, empty);
    return empty;
  }
  if (!res.ok) {
    throw new Error(`brreg roller API returned ${res.status}.`);
  }
  const data: unknown = await res.json();
  if (!isRollerResponse(data)) {
    throw new Error('brreg roller returned an unexpected response shape.');
  }
  await cacheSet(key, data);
  return data;
}

function isUnderenhet(value: unknown): value is Underenhet {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { organisasjonsnummer?: unknown }).organisasjonsnummer ===
      'string' &&
    typeof (value as { navn?: unknown }).navn === 'string'
  );
}

// One underenhet (a branch or department) by its own orgnr — the
// fallback when an orgnr typed in or found in a URL is not an enhet.
// Resolves undefined on 404 ("not an underenhet either") so a lookup
// chain can move on without try/catch; throws on network and other
// failures like the other fetchers. A deleted one still answers 200, as
// a SlettetUnderEnhet with a slettedato and no overordnetEnhet.
export async function fetchUnderenhet(
  orgnr: string,
): Promise<Underenhet | undefined> {
  const key = `underenhet:${orgnr}`;
  const cached = await cacheGet<Underenhet>(key);
  if (cached) return cached;

  const res = await brregFetch(`${API}/underenheter/${orgnr}`);
  if (res.status === 404) return undefined;
  if (!res.ok) {
    throw new Error(`brreg underenhet API returned ${res.status}.`);
  }
  const data: unknown = await res.json();
  if (!isUnderenhet(data)) {
    throw new Error('brreg returned an unexpected response shape.');
  }
  await cacheSet(key, data);
  return data;
}

// One request, first 100 rows (alphabetical) — enough for a panel list.
// The true count rides along in `total` so the UI can say it's capped.
export async function fetchUnderenheter(
  orgnr: string,
): Promise<UnderenheterPage> {
  const key = `underenheter:${orgnr}`;
  const cached = await cacheGet<UnderenheterPage>(key);
  // Shape check: this key held a bare array before `total` existed.
  if (cached && Array.isArray(cached.items)) return cached;

  const url = new URL(`${API}/underenheter`);
  url.searchParams.set('overordnetEnhet', orgnr);
  url.searchParams.set('size', '100');
  const res = await brregFetch(url);
  if (!res.ok) {
    throw new Error(`brreg underenheter API returned ${res.status}.`);
  }
  const data = (await res.json()) as {
    _embedded?: { underenheter?: unknown[] };
    page?: { totalElements?: unknown };
  };
  // A parent with none gets no _embedded at all, just page.totalElements 0.
  const items = (data._embedded?.underenheter ?? []).filter(isUnderenhet);
  const reported = data.page?.totalElements;
  const total =
    typeof reported === 'number' && reported >= items.length
      ? reported
      : items.length;
  const page: UnderenheterPage = { items, total };
  await cacheSet(key, page);
  return page;
}

function isRegnskap(value: unknown): value is Regnskap {
  return typeof value === 'object' && value !== null;
}

async function parseUnsupportedPlan(res: Response): Promise<string | undefined> {
  // The 500 body used to name the plan: `{"message": "Regnskapet
  // inneholder en oppstillingsplan som ikke er stottet (BANK)"}`. By
  // 2026-09 it is a generic "An error occurred while processing the
  // request." for the same companies. Still parsed in case brreg
  // restores it; nothing depends on it being there.
  try {
    const body = (await res.json()) as { message?: unknown };
    const msg = typeof body?.message === 'string' ? body.message : '';
    const m = msg.match(/\(([A-Z]+)\)/);
    return m?.[1];
  } catch {
    return undefined;
  }
}

export async function fetchRegnskap(orgnr: string): Promise<RegnskapResponse> {
  const key = `regnskap:${orgnr}`;
  const cached = await cacheGet<RegnskapResponse>(key);
  if (cached) return cached;

  const res = await brregFetch(`${REGNSKAP_API}/${orgnr}`);
  if (res.status === 404) {
    // Many small entities have no submitted regnskap. Cache the empty
    // result so we don't re-fetch on every refresh.
    const empty: RegnskapResponse = { items: [] };
    await cacheSet(key, empty);
    return empty;
  }
  if (res.status === 500) {
    // Not "couldn't ask": brreg answered, and retrying won't change the
    // answer for a bank. See docs/notes/brreg-api.md
    // § regnskap-500-unsupported-plan.
    const plan = await parseUnsupportedPlan(res);
    const response: RegnskapResponse = { items: [], unavailable: true };
    if (plan) response.unsupportedPlan = plan;
    await cacheSet(key, response, REGNSKAP_UNAVAILABLE_TTL_MS);
    return response;
  }
  if (!res.ok) {
    throw new Error(`brreg regnskap API returned ${res.status}.`);
  }
  const data: unknown = await res.json();
  const items = Array.isArray(data) ? data.filter(isRegnskap) : [];
  const response: RegnskapResponse = { items };
  await cacheSet(key, response);
  return response;
}

function cacheKeysFor(orgnr: string): string[] {
  return CACHE_PREFIXES.map((p) => `${p}:${orgnr}`);
}

// Drop everything cached for one orgnr so the next load refetches —
// the backing for the panel's «Oppdater» button.
export async function invalidateCache(orgnr: string): Promise<void> {
  try {
    await browser.storage.session.remove(cacheKeysFor(orgnr));
  } catch {
    /* ignore — best-effort eviction */
  }
}

// When the data on screen for `orgnr` was fetched from brreg: the
// oldest of its cached parts, since a cache hit can be up to a day old.
// Call it after the fetchers have settled. undefined = nothing cached
// (e.g. the write failed), meaning the data came straight from brreg.
export function getFetchedAt(orgnr: string): Promise<number | undefined> {
  return cacheStoredAt(cacheKeysFor(orgnr));
}
