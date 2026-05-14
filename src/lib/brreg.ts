import type {
  Enhet,
  RollerResponse,
  SearchHit,
  Underenhet,
} from '../types/brreg.js';

const API = 'https://data.brreg.no/enhetsregisteret/api';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

async function cacheGet<T>(key: string): Promise<T | undefined> {
  const store = await browser.storage.session.get(key);
  const entry = store[key] as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    // Best-effort eviction; swallow failure so a flaky remove doesn't
    // turn into a hard read failure for the caller.
    try {
      await browser.storage.session.remove(key);
    } catch {
      /* ignore */
    }
    return undefined;
  }
  return entry.value;
}

function isEnhet(value: unknown): value is Enhet {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { organisasjonsnummer?: unknown }).organisasjonsnummer ===
      'string' &&
    typeof (value as { navn?: unknown }).navn === 'string'
  );
}

async function cacheSet<T>(key: string, value: T): Promise<void> {
  const entry: CacheEntry<T> = {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  await browser.storage.session.set({ [key]: entry });
}

export async function fetchEnhet(orgnr: string): Promise<Enhet> {
  const key = `enhet:${orgnr}`;
  const cached = await cacheGet<Enhet>(key);
  if (cached) return cached;

  const res = await fetch(`${API}/enheter/${orgnr}`, {
    headers: { Accept: 'application/json' },
  });
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
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
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

  const res = await fetch(`${API}/enheter/${orgnr}/roller`, {
    headers: { Accept: 'application/json' },
  });
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

export async function fetchUnderenheter(orgnr: string): Promise<Underenhet[]> {
  const key = `underenheter:${orgnr}`;
  const cached = await cacheGet<Underenhet[]>(key);
  if (cached) return cached;

  const url = new URL(`${API}/underenheter`);
  url.searchParams.set('overordnetEnhet', orgnr);
  url.searchParams.set('size', '100');
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`brreg underenheter API returned ${res.status}.`);
  }
  const data = (await res.json()) as {
    _embedded?: { underenheter?: unknown[] };
  };
  const raw = data._embedded?.underenheter ?? [];
  const safe = raw.filter(isUnderenhet);
  await cacheSet(key, safe);
  return safe;
}
