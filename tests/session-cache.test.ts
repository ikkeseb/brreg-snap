import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from './helpers/fake-browser.js';

import {
  cacheGet,
  cacheSet,
  cacheStoredAt,
  CACHE_TTL_MS,
  sweepExpired,
} from '../src/lib/session-cache.js';

type StorageMap = Record<string, unknown>;

function installStorageMock(initial: StorageMap = {}): StorageMap {
  return fakeBrowser({ storage: { session: initial } }).stores.session;
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

  it('stamps the fetch time and an absolute expiry TTL ahead of it', async () => {
    const store = installStorageMock();
    await cacheSet('k', 'v');
    const entry = store['k'] as {
      value: unknown;
      expiresAt: number;
      storedAt: number;
    };
    expect(entry.value).toBe('v');
    expect(entry.storedAt).toBe(Date.now());
    expect(entry.expiresAt).toBe(Date.now() + CACHE_TTL_MS);
  });

  it('honours a per-entry TTL', async () => {
    installStorageMock();
    const sixHours = 6 * 60 * 60 * 1000;
    await cacheSet('short', 'v', sixHours);
    vi.setSystemTime(new Date(Date.now() + sixHours - 1));
    expect(await cacheGet('short')).toBe('v');
    vi.setSystemTime(new Date(Date.now() + 2));
    expect(await cacheGet('short')).toBeUndefined();
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

  it('treats a storage read error as a miss', async () => {
    installStorageMock();
    vi.mocked(browser.storage.session.get).mockRejectedValueOnce(
      new Error('storage unavailable'),
    );
    await expect(cacheGet('k')).resolves.toBeUndefined();
  });

  it('never throws on a failed write, and retries once after sweeping', async () => {
    const store = installStorageMock({
      stale: { value: 'old', expiresAt: Date.now() - 1 },
    });
    vi.mocked(browser.storage.session.set).mockRejectedValueOnce(
      new Error('QUOTA_BYTES quota exceeded'),
    );
    await expect(cacheSet('k', 'v')).resolves.toBeUndefined();
    expect('stale' in store).toBe(false);
    expect(await cacheGet('k')).toBe('v');
  });

  it('swallows a write that keeps failing', async () => {
    installStorageMock();
    vi.mocked(browser.storage.session.set).mockRejectedValue(
      new Error('QUOTA_BYTES quota exceeded'),
    );
    await expect(cacheSet('k', 'v')).resolves.toBeUndefined();
    expect(await cacheGet('k')).toBeUndefined();
  });
});

describe('sweepExpired', () => {
  it('removes expired entries only, and never touches non-cache keys', async () => {
    const now = Date.parse('2026-06-21T12:00:00Z');
    const store = installStorageMock({
      'enhet:1': { value: {}, expiresAt: now - 1 },
      'enhet:2': { value: {}, expiresAt: now + 1000 },
      // The recents list is a bare array in the same storage area.
      'recent-companies': [{ orgnr: '923609016', navn: 'EQUINOR ASA', ts: 1 }],
    });
    await sweepExpired(now);
    expect(Object.keys(store).sort()).toEqual(['enhet:2', 'recent-companies']);
  });

  it('never throws when storage fails', async () => {
    installStorageMock();
    vi.mocked(browser.storage.session.get).mockRejectedValueOnce(new Error('x'));
    await expect(sweepExpired()).resolves.toBeUndefined();
  });

  it('runs opportunistically from cacheSet at most once per interval', async () => {
    // Fresh module instance so the per-page sweep clock starts at zero.
    vi.resetModules();
    const cache = await import('../src/lib/session-cache.js');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T12:00:00Z'));
    try {
      installStorageMock();
      const get = vi.mocked(browser.storage.session.get);
      await cache.cacheSet('a', 1);
      await vi.waitFor(() => expect(get).toHaveBeenCalledWith(null));
      get.mockClear();

      vi.setSystemTime(new Date(Date.now() + 60_000));
      await cache.cacheSet('b', 2);
      expect(get).not.toHaveBeenCalledWith(null);

      vi.setSystemTime(new Date(Date.now() + 10 * 60_000));
      await cache.cacheSet('c', 3);
      await vi.waitFor(() => expect(get).toHaveBeenCalledWith(null));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('cacheStoredAt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the oldest fetch time among the live keys', async () => {
    installStorageMock();
    const t0 = Date.now();
    await cacheSet('enhet:1', {});
    vi.setSystemTime(new Date(t0 + 5_000));
    await cacheSet('roller:1', {});
    expect(await cacheStoredAt(['enhet:1', 'roller:1', 'absent:1'])).toBe(t0);
  });

  it('skips expired entries', async () => {
    installStorageMock();
    const t0 = Date.now();
    await cacheSet('short', {}, 1_000);
    vi.setSystemTime(new Date(t0 + 500));
    await cacheSet('long', {});
    vi.setSystemTime(new Date(t0 + 2_000));
    expect(await cacheStoredAt(['short', 'long'])).toBe(t0 + 500);
  });

  it('derives the fetch time of an entry written before storedAt existed', async () => {
    const fetchedAt = Date.now() - 3_600_000;
    installStorageMock({
      legacy: { value: {}, expiresAt: fetchedAt + CACHE_TTL_MS },
    });
    expect(await cacheStoredAt(['legacy'])).toBe(fetchedAt);
  });

  it('is undefined when nothing is cached or storage fails', async () => {
    installStorageMock();
    expect(await cacheStoredAt(['enhet:1'])).toBeUndefined();
    vi.mocked(browser.storage.session.get).mockRejectedValueOnce(new Error('x'));
    expect(await cacheStoredAt(['enhet:1'])).toBeUndefined();
  });
});
