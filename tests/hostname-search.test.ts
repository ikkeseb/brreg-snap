import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchHit } from '../src/types/brreg.js';

// Mock the brreg module before importing hostname-search, so the
// re-export picks up the mock. Vitest hoists vi.mock to the top of
// the file, but we still define the implementation here for clarity.
vi.mock('../src/lib/brreg.js', () => ({
  searchEnheter: vi.fn(),
}));

import { searchEnheter } from '../src/lib/brreg.js';
import {
  queryFromHostname,
  searchByHostname,
} from '../src/lib/hostname-search.js';

const searchEnheterMock = vi.mocked(searchEnheter);

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
  formKode = 'AS',
): SearchHit {
  return {
    navn,
    organisasjonsnummer,
    organisasjonsform: { kode: formKode, beskrivelse: formKode },
  } as SearchHit;
}

describe('queryFromHostname', () => {
  it('strips www and TLD, leaves the brand label', () => {
    expect(queryFromHostname('www.yara.com')).toBe('yara');
    expect(queryFromHostname('yara.com')).toBe('yara');
  });

  it('takes the rightmost label before the TLD for deeper hosts', () => {
    expect(queryFromHostname('shop.mestergruppen.no')).toBe('mestergruppen');
    expect(queryFromHostname('a.b.c.equinor.com')).toBe('equinor');
  });

  it('lowercases the result', () => {
    expect(queryFromHostname('NRK.no')).toBe('nrk');
  });

  it('returns undefined for single-label hostnames', () => {
    expect(queryFromHostname('localhost')).toBeUndefined();
  });

  it('returns undefined when the brand label is too short to be useful', () => {
    // `a.no` → "a", which would match too much in brreg search.
    expect(queryFromHostname('a.no')).toBeUndefined();
  });
});

describe('searchByHostname', () => {
  beforeEach(() => {
    installStorageMock();
    searchEnheterMock.mockReset();
  });

  it('returns the first plausible hit when search succeeds', async () => {
    searchEnheterMock.mockResolvedValue([
      hit('YARA INTERNATIONAL ASA', '986228608'),
    ]);
    expect(await searchByHostname('www.yara.com')).toBe('986228608');
  });

  it('prefers a hit whose navn starts with the query over other plausibles', async () => {
    // "shell" matches both "SHELLY AS" and "A/S NORSKE SHELL".
    // SHELLY starts with the query so it wins the prefix tiebreak.
    searchEnheterMock.mockResolvedValue([
      hit('A/S NORSKE SHELL', '914807077'),
      hit('SHELLY AS', '999999999'),
    ]);
    expect(await searchByHostname('shell.no')).toBe('999999999');
  });

  it('falls back to first plausible when no hit starts with the query', async () => {
    // The brand sits at the end of the legal name. Without prefix
    // matches we still want a result, not undefined.
    searchEnheterMock.mockResolvedValue([
      hit('A/S NORSKE SHELL', '914807077'),
    ]);
    expect(await searchByHostname('shell.no')).toBe('914807077');
  });

  it('filters out ENK (sole proprietorship) hits', async () => {
    searchEnheterMock.mockResolvedValue([
      hit('YARA NORDIC ENK', '111111111', 'ENK'),
      hit('YARA INTERNATIONAL ASA', '986228608', 'AS'),
    ]);
    expect(await searchByHostname('yara.com')).toBe('986228608');
  });

  it('returns undefined when no hits contain the query in their navn', async () => {
    searchEnheterMock.mockResolvedValue([
      hit('UNRELATED COMPANY AS', '111111111'),
    ]);
    expect(await searchByHostname('yara.com')).toBeUndefined();
  });

  it('returns undefined when the query is unusable (single-label)', async () => {
    expect(await searchByHostname('localhost')).toBeUndefined();
    expect(searchEnheterMock).not.toHaveBeenCalled();
  });

  it('caches positive results and skips the network on repeat', async () => {
    searchEnheterMock.mockResolvedValue([
      hit('YARA INTERNATIONAL ASA', '986228608'),
    ]);
    expect(await searchByHostname('yara.com')).toBe('986228608');
    expect(await searchByHostname('yara.com')).toBe('986228608');
    expect(searchEnheterMock).toHaveBeenCalledTimes(1);
  });

  it('caches negative results so re-visits do not re-search', async () => {
    searchEnheterMock.mockResolvedValue([]);
    expect(await searchByHostname('mdn.mozilla.org')).toBeUndefined();
    expect(await searchByHostname('mdn.mozilla.org')).toBeUndefined();
    expect(searchEnheterMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT cache network errors — next call retries', async () => {
    searchEnheterMock.mockRejectedValueOnce(new Error('network down'));
    expect(await searchByHostname('yara.com')).toBeUndefined();
    searchEnheterMock.mockResolvedValueOnce([
      hit('YARA INTERNATIONAL ASA', '986228608'),
    ]);
    expect(await searchByHostname('yara.com')).toBe('986228608');
    expect(searchEnheterMock).toHaveBeenCalledTimes(2);
  });
});
