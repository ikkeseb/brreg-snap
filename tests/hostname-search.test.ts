import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchHit } from '../src/types/brreg.js';

vi.mock('../src/lib/brreg.js', () => ({
  searchEnheterWithParams: vi.fn(),
}));

import { searchEnheterWithParams } from '../src/lib/brreg.js';
import {
  getPickerChoice,
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
