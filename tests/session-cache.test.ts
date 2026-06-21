import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheGet, cacheSet, CACHE_TTL_MS } from '../src/lib/session-cache.js';

type StorageMap = Record<string, unknown>;

function installStorageMock(initial: StorageMap = {}): StorageMap {
  const store: StorageMap = { ...initial };
  (globalThis as { browser?: unknown }).browser = {
    storage: {
      session: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: StorageMap = {};
          for (const k of list) if (k in store) out[k] = store[k];
          return out;
        }),
        set: vi.fn(async (entries: StorageMap) => {
          Object.assign(store, entries);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) delete store[k];
        }),
      },
    },
  };
  return store;
}

describe('session-cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips a value within the TTL', async () => {
    installStorageMock();
    await cacheSet('k', { a: 1 });
    expect(await cacheGet<{ a: number }>('k')).toEqual({ a: 1 });
  });

  it('returns undefined for a missing key', async () => {
    installStorageMock();
    expect(await cacheGet('absent')).toBeUndefined();
  });

  it('stamps an absolute expiry TTL ahead of write time', async () => {
    const store = installStorageMock();
    await cacheSet('k', 'v');
    const entry = store['k'] as { value: unknown; expiresAt: number };
    expect(entry.value).toBe('v');
    expect(entry.expiresAt).toBe(Date.now() + CACHE_TTL_MS);
  });

  it('evicts and returns undefined once past expiry', async () => {
    const store = installStorageMock();
    await cacheSet('k', 'v');
    vi.setSystemTime(new Date(Date.now() + CACHE_TTL_MS + 1));
    expect(await cacheGet('k')).toBeUndefined();
    expect(vi.mocked(browser.storage.session.remove)).toHaveBeenCalledWith('k');
    expect('k' in store).toBe(false);
  });

  it('still returns undefined when the best-effort eviction throws', async () => {
    installStorageMock();
    await cacheSet('k', 'v');
    // Make remove reject — a flaky eviction must not become a hard read error.
    vi.mocked(browser.storage.session.remove).mockRejectedValueOnce(
      new Error('flaky'),
    );
    vi.setSystemTime(new Date(Date.now() + CACHE_TTL_MS + 1));
    await expect(cacheGet('k')).resolves.toBeUndefined();
  });
});
