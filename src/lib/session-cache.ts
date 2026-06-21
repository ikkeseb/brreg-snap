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
// expiry stamped at write time.

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
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

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  const entry: CacheEntry<T> = {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  await browser.storage.session.set({ [key]: entry });
}
