// Single source of truth for the storage.session TTL cache used by the
// brreg API client (src/lib/brreg.ts) and the hostname-resolution
// pipeline (src/lib/hostname-search.ts). Both stored byte-identical
// copies of this read/write pair before — consolidating here keeps the
// eviction semantics and the 24h TTL in one place so the two cannot
// drift apart.
//
// Semantics: a `get` past `expiresAt` evicts best-effort and returns
// undefined (a flaky remove must not turn into a hard read failure). A
// missing entry returns undefined. Values are wrapped with an absolute
// expiry and the fetch time, both stamped at write time.
//
// The cache is best-effort by contract, in both directions: a storage
// error on read is a miss, and a storage error on write is swallowed.
// The caller has already fetched good data by the time it writes, and a
// full quota must not surface to the user as "brreg failed".

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Reads only evict the key they touch, so without a sweep every host
// and company looked up in a session lingers until browser restart.
// The sweep reads the whole area (get(null)), so it runs at most once
// per interval per page rather than on every write.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  // When the value was fetched from brreg — the data age the UI shows.
  // Optional only for entries written before this field existed; those
  // all used CACHE_TTL_MS, so their fetch time is expiresAt − TTL.
  storedAt?: number;
}

// storage.session also holds non-cache keys (the recents list is a bare
// array), so the sweep must only ever touch values shaped like an entry.
function isCacheEntry(value: unknown): value is CacheEntry<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'value' in value &&
    typeof (value as { expiresAt?: unknown }).expiresAt === 'number'
  );
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  let entry: CacheEntry<T> | undefined;
  try {
    const store = await browser.storage.session.get(key);
    entry = store[key] as CacheEntry<T> | undefined;
  } catch {
    return undefined;
  }
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

// `ttlMs` lets a caller cache an outcome for less than a day — e.g. a
// regnskap 500, which is stable but not something to pin for 24h.
export async function cacheSet<T>(
  key: string,
  value: T,
  ttlMs: number = CACHE_TTL_MS,
): Promise<void> {
  const now = Date.now();
  const entry: CacheEntry<T> = { value, expiresAt: now + ttlMs, storedAt: now };
  try {
    await browser.storage.session.set({ [key]: entry });
  } catch {
    // Most likely the quota. Free what has expired and try once more;
    // if that fails too, give up quietly — the next read is a miss and
    // simply refetches.
    await sweepExpired(now);
    try {
      await browser.storage.session.set({ [key]: entry });
    } catch {
      /* best-effort */
    }
    return;
  }
  if (now - lastSweepAt >= SWEEP_INTERVAL_MS) void sweepExpired(now);
}

let lastSweepAt = 0;

// Remove every expired cache entry in storage.session. Never throws.
export async function sweepExpired(now: number = Date.now()): Promise<void> {
  lastSweepAt = now;
  try {
    const all = await browser.storage.session.get(null);
    const expired = Object.keys(all).filter((key) => {
      const entry: unknown = all[key];
      return isCacheEntry(entry) && entry.expiresAt < now;
    });
    if (expired.length > 0) await browser.storage.session.remove(expired);
  } catch {
    /* best-effort */
  }
}

// When the OLDEST live entry among `keys` was fetched (ms epoch). A view
// assembled from several cached fetches is only as fresh as its oldest
// part. Missing and expired entries are skipped; undefined when none is
// live (nothing cached, or the write failed — then the data on screen
// is exactly as old as the fetch that just returned it).
export async function cacheStoredAt(
  keys: string[],
): Promise<number | undefined> {
  let store: Record<string, unknown>;
  try {
    store = await browser.storage.session.get(keys);
  } catch {
    return undefined;
  }
  const now = Date.now();
  let oldest: number | undefined;
  for (const key of keys) {
    const entry = store[key];
    if (!isCacheEntry(entry) || entry.expiresAt < now) continue;
    const at = entry.storedAt ?? entry.expiresAt - CACHE_TTL_MS;
    if (oldest === undefined || at < oldest) oldest = at;
  }
  return oldest;
}
