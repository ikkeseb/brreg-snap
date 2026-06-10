import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchHit } from '../src/types/brreg.js';

vi.mock('../src/lib/brreg.js', () => ({
  searchEnheterWithParams: vi.fn(),
}));

import { searchEnheterWithParams } from '../src/lib/brreg.js';
import {
  addRejectedChoice,
  getPickerChoice,
  getRejectedChoices,
  queryFromHostname,
  searchByHostname,
  searchByHostnameDetailed,
  setPickerChoice,
} from '../src/lib/hostname-search.js';

const searchMock = vi.mocked(searchEnheterWithParams);

type StorageMap = Record<string, unknown>;

function installStorageMock(initial: StorageMap = {}): StorageMap {
  const store: StorageMap = { ...initial };
  (globalThis as { browser?: unknown }).browser = {
    storage: {
      session: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: StorageMap = {};
          for (const k of list) {
            if (k in store) out[k] = store[k];
          }
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

function hit(
  navn: string,
  organisasjonsnummer: string,
  extra: Partial<SearchHit> = {},
): SearchHit {
  return {
    navn,
    organisasjonsnummer,
    organisasjonsform: { kode: 'AS' },
    ...extra,
  } as SearchHit;
}

describe('queryFromHostname', () => {
  it('strips www and TLD, leaves the brand label', () => {
    expect(queryFromHostname('www.yara.com')).toBe('yara');
    expect(queryFromHostname('yara.com')).toBe('yara');
  });

  it('returns undefined for single-label or too-short hostnames', () => {
    expect(queryFromHostname('localhost')).toBeUndefined();
    expect(queryFromHostname('a.no')).toBeUndefined();
  });
});

describe('searchByHostname (AUTO-only legacy wrapper)', () => {
  beforeEach(() => {
    installStorageMock();
    searchMock.mockReset();
  });

  it('returns the AUTO-band orgnr when scoring is confident', async () => {
    // ORKLA ASA → exact-prefix(+48) + ASA(+28) + top-level(+12) +
    // short(2w)(+10) = 98, clear winner.
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) return [];
      return [
        hit('ORKLA ASA', '910747711', {
          organisasjonsform: { kode: 'ASA' },
          antallAnsatte: 50,
        }),
        hit('ORKLA FOODS NORGE AS', '999999998', {
          organisasjonsform: { kode: 'AS' },
          overordnetEnhet: '910747711',
        }),
      ];
    });

    expect(await searchByHostname('orkla.com')).toBe('910747711');
  });

  it('returns undefined when band is picker (ambiguous)', async () => {
    // Two near-identical kjedebutikker — picker band, no AUTO.
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) {
        return [
          hit('ELKJØP LEKNES', '111111118', { hjemmeside: 'elkjop.no' }),
          hit('ELKJØP SVOLVÆR', '222222226', { hjemmeside: 'elkjop.no' }),
        ];
      }
      return [];
    });

    expect(await searchByHostname('elkjop.no')).toBeUndefined();
  });

  it('returns undefined when no candidates score above the gate', async () => {
    searchMock.mockResolvedValue([]);
    expect(await searchByHostname('mdn.mozilla.org')).toBeUndefined();
  });

  it('caches results and skips network on the second call', async () => {
    searchMock.mockResolvedValue([
      hit('ORKLA ASA', '910747711', { organisasjonsform: { kode: 'ASA' } }),
    ]);
    await searchByHostname('orkla.com');
    const callsAfterFirst = searchMock.mock.calls.length;
    await searchByHostname('orkla.com');
    expect(searchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('returns the cached picker choice when one exists', async () => {
    await setPickerChoice('shell.no', '914807077');
    expect(await searchByHostname('shell.no')).toBe('914807077');
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('returns undefined when the cached choice is "Ingen av disse"', async () => {
    await setPickerChoice('shell.no', null);
    expect(await searchByHostname('shell.no')).toBeUndefined();
    expect(searchMock).not.toHaveBeenCalled();
  });
});

describe('searchByHostnameDetailed', () => {
  beforeEach(() => {
    installStorageMock();
    searchMock.mockReset();
  });

  it('returns band=auto with the choice orgnr when confident', async () => {
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) return [];
      return [
        hit('ORKLA ASA', '910747711', {
          organisasjonsform: { kode: 'ASA' },
        }),
      ];
    });

    const result = await searchByHostnameDetailed('orkla.com');
    expect(result?.band).toBe('auto');
    expect(result?.choice).toBe('910747711');
  });

  it('returns band=picker with candidates when ambiguous', async () => {
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) {
        return [
          hit('ELKJØP LEKNES', '111111118', { hjemmeside: 'elkjop.no' }),
          hit('ELKJØP SVOLVÆR', '222222226', { hjemmeside: 'elkjop.no' }),
        ];
      }
      return [];
    });

    const result = await searchByHostnameDetailed('elkjop.no');
    expect(result?.band).toBe('picker');
    expect(result?.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('returns band=none when nothing matches', async () => {
    searchMock.mockResolvedValue([]);
    const result = await searchByHostnameDetailed('mdn.mozilla.org');
    expect(result?.band).toBe('none');
    expect(result?.candidates).toEqual([]);
  });

  it('honors a positive picker-choice cache: band=auto, choice set', async () => {
    await setPickerChoice('shell.no', '914807077');
    const result = await searchByHostnameDetailed('shell.no');
    expect(result).toEqual({ band: 'auto', candidates: [], choice: '914807077' });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('honors a negative picker-choice cache: band=none', async () => {
    await setPickerChoice('shell.no', null);
    const result = await searchByHostnameDetailed('shell.no');
    expect(result).toEqual({ band: 'none', candidates: [] });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('falls back to Q3 (no org-form filter) when Q1+Q2 yields zero', async () => {
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) return [];
      if (params.get('organisasjonsform') === 'AS,ASA,SA,ORGL,SF') return [];
      // Q3 has no organisasjonsform set.
      return [
        hit('EKSPORTFINANSIERING NORGE', '999000001', {
          organisasjonsform: { kode: 'ORGL' },
        }),
      ];
    });

    const result = await searchByHostnameDetailed('eksfin.no');
    const q3Call = searchMock.mock.calls.find(
      (call) => !(call[0] as URLSearchParams).has('organisasjonsform'),
    );
    expect(q3Call).toBeDefined();
    expect(result).toBeDefined();
  });
});

describe('pipeline failure handling (network errors)', () => {
  let store: StorageMap;

  beforeEach(() => {
    store = installStorageMock();
    searchMock.mockReset();
  });

  const bandKeys = () =>
    Object.keys(store).filter((k) => k.startsWith('hostname:'));

  it('returns band=none WITHOUT caching when every query fails', async () => {
    searchMock.mockRejectedValue(new Error('brreg search returned 503.'));

    const result = await searchByHostnameDetailed('orkla.com');
    expect(result).toEqual({ band: 'none', candidates: [] });
    expect(bandKeys()).toEqual([]);

    // Next visit retries the network instead of serving a 24h miss.
    const callsAfterFirst = searchMock.mock.calls.length;
    await searchByHostnameDetailed('orkla.com');
    expect(searchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('returns a best-effort result WITHOUT caching on partial failure', async () => {
    // hjemmeside queries throttled; navn queries succeed with a clear
    // winner. The result is served, but built on partial data — it
    // must not enter the band cache.
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) {
        throw new Error('brreg search returned 429.');
      }
      return [
        hit('ORKLA ASA', '910747711', {
          organisasjonsform: { kode: 'ASA' },
          antallAnsatte: 50,
        }),
        hit('ORKLA FOODS NORGE AS', '999999998', {
          organisasjonsform: { kode: 'AS' },
          overordnetEnhet: '910747711',
        }),
      ];
    });

    const result = await searchByHostnameDetailed('orkla.com');
    expect(result?.band).toBe('auto');
    expect(result?.choice).toBe('910747711');
    expect(bandKeys()).toEqual([]);
  });

  it('caches the result when all queries succeed (regression)', async () => {
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) return [];
      return [
        hit('ORKLA ASA', '910747711', {
          organisasjonsform: { kode: 'ASA' },
          antallAnsatte: 50,
        }),
      ];
    });

    const result = await searchByHostnameDetailed('orkla.com');
    expect(result?.band).toBe('auto');
    expect(bandKeys()).toEqual(['hostname:orkla.com']);
  });

  it('a failed Q3 fallback also blocks caching', async () => {
    // Q1+Q2 succeed with zero hits, which triggers the Q3 fallback
    // (no org-form filter) — and Q3 fails. The run is incomplete.
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) return [];
      if (params.has('organisasjonsform')) return [];
      throw new Error('brreg search returned 503.');
    });

    const result = await searchByHostnameDetailed('eksfin.no');
    expect(result?.band).toBe('none');
    expect(bandKeys()).toEqual([]);
  });

  it('picker-choice cache still wins regardless of network state', async () => {
    searchMock.mockRejectedValue(new Error('offline'));
    await setPickerChoice('orkla.com', '910747711');
    expect(await searchByHostname('orkla.com')).toBe('910747711');
    expect(searchMock).not.toHaveBeenCalled();
  });
});

describe('getPickerChoice / setPickerChoice', () => {
  beforeEach(() => {
    installStorageMock();
  });

  it('round-trips a positive choice', async () => {
    await setPickerChoice('shell.no', '914807077');
    expect(await getPickerChoice('shell.no')).toBe('914807077');
  });

  it('round-trips a negative choice (null = "Ingen av disse")', async () => {
    await setPickerChoice('shell.no', null);
    expect(await getPickerChoice('shell.no')).toBeNull();
  });

  it('returns undefined when no choice has been cached', async () => {
    expect(await getPickerChoice('shell.no')).toBeUndefined();
  });
});

describe('addRejectedChoice + pipeline filtering', () => {
  beforeEach(() => {
    installStorageMock();
    searchMock.mockReset();
  });

  it('round-trips and dedupes rejected orgnrs', async () => {
    await addRejectedChoice('foo.no', '111111118');
    await addRejectedChoice('foo.no', '222222226');
    await addRejectedChoice('foo.no', '111111118'); // duplicate — no-op
    expect(await getRejectedChoices('foo.no')).toEqual([
      '111111118',
      '222222226',
    ]);
  });

  it('returns [] when nothing has been rejected', async () => {
    expect(await getRejectedChoices('nothing.no')).toEqual([]);
  });

  it('filters rejected candidates from the pipeline result', async () => {
    // Two near-identical kjedebutikker — without rejection, this is
    // picker band. After rejecting the first, only one remains, which
    // means a (now unambiguous) auto pick on the second.
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) {
        return [
          hit('ELKJØP LEKNES', '111111118', { hjemmeside: 'elkjop.no' }),
          hit('ELKJØP SVOLVÆR', '222222226', { hjemmeside: 'elkjop.no' }),
        ];
      }
      return [];
    });

    const before = await searchByHostnameDetailed('elkjop.no');
    expect(before?.band).toBe('picker');

    await addRejectedChoice('elkjop.no', '111111118');
    const after = await searchByHostnameDetailed('elkjop.no');
    // Filtered candidate list excludes the rejected orgnr.
    expect(after?.candidates.find((c) => c.organisasjonsnummer === '111111118'))
      .toBeUndefined();
    expect(after?.candidates.length).toBe(1);
  });

  it('drops a positive picker-choice when the same orgnr is rejected', async () => {
    await setPickerChoice('elkjop.no', '111111118');
    expect(await getPickerChoice('elkjop.no')).toBe('111111118');

    await addRejectedChoice('elkjop.no', '111111118');
    // Positive choice no longer short-circuits future resolutions.
    expect(await getPickerChoice('elkjop.no')).toBeUndefined();
  });

  it('produces a separate band cache per rejected set', async () => {
    // First call without rejection; second after rejecting the auto
    // winner. Both must hit the network — the band cache key includes
    // the rejected hash, so the second is not served from the first.
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) return [];
      return [
        hit('ORKLA ASA', '910747711', {
          organisasjonsform: { kode: 'ASA' },
          antallAnsatte: 50,
        }),
        hit('ORKLA FOODS NORGE AS', '999999998', {
          organisasjonsform: { kode: 'AS' },
          overordnetEnhet: '910747711',
        }),
      ];
    });

    expect(await searchByHostname('orkla.com')).toBe('910747711');
    const callsAfterFirst = searchMock.mock.calls.length;

    await addRejectedChoice('orkla.com', '910747711');
    await searchByHostname('orkla.com');
    expect(searchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});
