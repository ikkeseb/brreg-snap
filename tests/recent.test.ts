import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeBrowser } from './helpers/fake-browser.js';
import { getRecent, pushRecent } from '../src/lib/ui/recent.js';

// Characterization tests for the popup "recent companies" stack. Locks
// in the current behavior (storage.session backing, MAX 5, dedupe-by-
// orgnr most-recent-first, shape validation, error-swallowing) before
// the Chrome port. storage.session comes from the shared browser fake.

const STORAGE_KEY = 'recent-companies';

type StorageMap = Record<string, unknown>;

// Installs the shared fake (tests/helpers/fake-browser.ts) with the
// given storage.session contents. The returned handle exposes the
// backing store and the get/set spies so tests can seed data, assert
// writes, or swap in rejecting implementations.
function installStorageMock(initial: StorageMap = {}) {
  const fake = fakeBrowser({ storage: { session: initial } });
  const { get, set } = fake.storage.session;
  return { store: fake.stores.session, get, set };
}

describe('getRecent', () => {
  beforeEach(() => {
    installStorageMock();
  });

  it('returns [] when the key has never been written', async () => {
    expect(await getRecent()).toEqual([]);
  });

  it('returns [] when the stored value is not an array', async () => {
    installStorageMock({ [STORAGE_KEY]: { not: 'an array' } });
    expect(await getRecent()).toEqual([]);
  });

  it('returns well-formed entries unchanged', async () => {
    const entries = [
      { orgnr: '984851006', navn: 'DNB BANK ASA', ts: 100 },
      { orgnr: '986228608', navn: 'YARA INTERNATIONAL ASA', ts: 90 },
    ];
    installStorageMock({ [STORAGE_KEY]: entries });
    expect(await getRecent()).toEqual(entries);
  });

  it('filters malformed entries (non-string orgnr/navn, missing/wrong-typed ts)', async () => {
    const good = { orgnr: '984851006', navn: 'DNB BANK ASA', ts: 100 };
    installStorageMock({
      [STORAGE_KEY]: [
        good,
        { orgnr: 123, navn: 'numeric orgnr', ts: 1 }, // non-string orgnr
        { orgnr: '111', navn: 42, ts: 1 }, // non-string navn
        { orgnr: '222', navn: 'no ts' }, // missing ts
        { orgnr: '333', navn: 'string ts', ts: '5' }, // ts wrong type
        null, // null entry — optional chaining yields undefined typeof
        'not-an-object',
      ],
    });
    expect(await getRecent()).toEqual([good]);
  });

  it('returns [] when storage.session.get rejects (error swallowed)', async () => {
    const mock = installStorageMock();
    mock.get.mockRejectedValueOnce(new Error('session unavailable'));
    expect(await getRecent()).toEqual([]);
  });
});

describe('pushRecent', () => {
  beforeEach(() => {
    installStorageMock();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function stored(mock: ReturnType<typeof installStorageMock>): unknown {
    return mock.store[STORAGE_KEY];
  }

  it('adds an entry to an empty store with a Date.now() timestamp', async () => {
    const mock = installStorageMock();
    await pushRecent('984851006', 'DNB BANK ASA');
    expect(stored(mock)).toEqual([
      { orgnr: '984851006', navn: 'DNB BANK ASA', ts: Date.now() },
    ]);
  });

  it('prepends new entries (most-recent-first)', async () => {
    const mock = installStorageMock();
    await pushRecent('111', 'First');
    vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 1, 0));
    await pushRecent('222', 'Second');
    const list = stored(mock) as Array<{ orgnr: string }>;
    expect(list.map((e) => e.orgnr)).toEqual(['222', '111']);
  });

  it('dedupes by orgnr: re-pushing moves the entry to the top without duplicating', async () => {
    const mock = installStorageMock();
    await pushRecent('111', 'First');
    await pushRecent('222', 'Second');
    await pushRecent('333', 'Third');
    vi.setSystemTime(new Date(2026, 5, 1, 12, 5, 0, 0));
    await pushRecent('111', 'First (revisited)');
    const list = stored(mock) as Array<{ orgnr: string; navn: string; ts: number }>;
    expect(list.map((e) => e.orgnr)).toEqual(['111', '333', '222']);
    expect(list).toHaveLength(3);
    // The moved entry takes the new navn and the new timestamp.
    expect(list[0]).toEqual({
      orgnr: '111',
      navn: 'First (revisited)',
      ts: new Date(2026, 5, 1, 12, 5, 0, 0).getTime(),
    });
  });

  it('truncates to MAX_ENTRIES (5): pushing a 6th drops the oldest', async () => {
    const mock = installStorageMock();
    for (let i = 1; i <= 6; i++) {
      vi.setSystemTime(new Date(2026, 5, 1, 12, 0, i, 0));
      await pushRecent(String(i), `Company ${i}`);
    }
    const list = stored(mock) as Array<{ orgnr: string }>;
    expect(list).toHaveLength(5);
    // Newest first; orgnr "1" (oldest) is dropped.
    expect(list.map((e) => e.orgnr)).toEqual(['6', '5', '4', '3', '2']);
  });

  it('swallows errors when storage.session.set rejects (no throw)', async () => {
    const mock = installStorageMock();
    mock.set.mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(pushRecent('984851006', 'DNB BANK ASA')).resolves.toBeUndefined();
  });

  it('swallows errors when getRecent (the read inside push) cannot run', async () => {
    // getRecent itself swallows get-rejection and returns [], so push
    // proceeds and writes a single-entry list. This documents that a
    // read failure does NOT abort the subsequent write.
    const mock = installStorageMock();
    mock.get.mockRejectedValueOnce(new Error('session unavailable'));
    await pushRecent('984851006', 'DNB BANK ASA');
    expect(stored(mock)).toEqual([
      { orgnr: '984851006', navn: 'DNB BANK ASA', ts: Date.now() },
    ]);
  });
});
