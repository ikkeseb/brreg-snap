import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchHit } from '../src/types/brreg.js';

// Mock the brreg module so resolveOrgnrAsync can run its hostname-
// search fallback offline. Sync tests don't touch this path, so the
// mock stays inert for them.
vi.mock('../src/lib/brreg.js', () => ({
  searchEnheter: vi.fn(),
}));

import { searchEnheter } from '../src/lib/brreg.js';
import {
  extractOrgnrFromText,
  isValidOrgnr,
  resolveOrgnr,
  resolveOrgnrAsync,
} from '../src/lib/orgnr.js';

const searchEnheterMock = vi.mocked(searchEnheter);

type StorageMap = Record<string, unknown>;

function installStorageMock(): void {
  const store: StorageMap = {};
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
}

function hit(navn: string, organisasjonsnummer: string): SearchHit {
  return {
    navn,
    organisasjonsnummer,
    organisasjonsform: { kode: 'AS', beskrivelse: 'AS' },
  } as SearchHit;
}

describe('isValidOrgnr', () => {
  it('accepts valid 9-digit orgnr with correct mod-11 check digit', () => {
    expect(isValidOrgnr('982463718')).toBe(true); // Telenor
    expect(isValidOrgnr('923609016')).toBe(true); // Equinor
  });

  it('rejects malformed input', () => {
    expect(isValidOrgnr('12345678')).toBe(false);
    expect(isValidOrgnr('1234567890')).toBe(false);
    expect(isValidOrgnr('abcdefghi')).toBe(false);
    expect(isValidOrgnr('')).toBe(false);
  });

  it('rejects 9-digit numbers with invalid check digit', () => {
    expect(isValidOrgnr('982463719')).toBe(false);
  });

  it('rejects numbers whose check digit would be 10', () => {
    // 400000000 → sum 12, 12 % 11 = 1, cd = 10 → invalid by spec
    expect(isValidOrgnr('400000000')).toBe(false);
  });
});

describe('extractOrgnrFromText', () => {
  it('finds a valid orgnr inside surrounding text', () => {
    expect(extractOrgnrFromText('orgnr 982 463 718')).toBeUndefined(); // spaces break regex
    expect(extractOrgnrFromText('Foo 982463718 bar')).toBe('982463718');
  });

  it('returns undefined when no valid orgnr is present', () => {
    expect(extractOrgnrFromText('no numbers here')).toBeUndefined();
    expect(extractOrgnrFromText('123456789')).toBeUndefined();
  });

  it('skips earlier invalid 9-digit runs and returns the first valid one', () => {
    // 123456789 fails mod-11; 982463718 is Telenor and passes.
    expect(extractOrgnrFromText('foo 123456789 bar 982463718 baz')).toBe(
      '982463718',
    );
  });
});

describe('resolveOrgnr', () => {
  it('prefers orgnr from URL when present', () => {
    const result = resolveOrgnr({
      url: 'https://example.com/about/982463718',
      title: 'Telenor',
    });
    expect(result).toBe('982463718');
  });

  it('falls back to domain table when URL has no orgnr', () => {
    const result = resolveOrgnr({
      url: 'https://www.telenor.no/privat',
      title: 'Telenor',
    });
    expect(result).toBe('982463718');
  });

  it('handles subdomains via parent-domain lookup', () => {
    const result = resolveOrgnr({
      url: 'https://shop.telenor.no/abonnement',
      title: '',
    });
    expect(result).toBe('982463718');
  });

  it('returns undefined for unknown domain without orgnr in text', () => {
    const result = resolveOrgnr({
      url: 'https://unknown-company-xyz.example/',
      title: 'Unknown',
    });
    expect(result).toBeUndefined();
  });

  it('gracefully handles malformed URLs', () => {
    const result = resolveOrgnr({ url: 'about:newtab', title: '' });
    expect(result).toBeUndefined();
  });
});

describe('resolveOrgnrAsync', () => {
  beforeEach(() => {
    installStorageMock();
    searchEnheterMock.mockReset();
  });

  it('short-circuits to the sync result and skips search when URL has an orgnr', async () => {
    const result = await resolveOrgnrAsync({
      url: 'https://example.com/about/982463718',
      title: '',
    });
    expect(result).toBe('982463718');
    expect(searchEnheterMock).not.toHaveBeenCalled();
  });

  it('short-circuits to the sync result on a curated domain', async () => {
    const result = await resolveOrgnrAsync({
      url: 'https://www.telenor.no/privat',
      title: '',
    });
    expect(result).toBe('982463718');
    expect(searchEnheterMock).not.toHaveBeenCalled();
  });

  it('falls back to hostname search when the sync cascade misses', async () => {
    searchEnheterMock.mockResolvedValue([
      hit('YARA INTERNATIONAL ASA', '986228608'),
    ]);
    const result = await resolveOrgnrAsync({
      url: 'https://www.yara.com/about',
      title: 'Yara — global crop nutrition',
    });
    expect(result).toBe('986228608');
    expect(searchEnheterMock).toHaveBeenCalledTimes(1);
  });

  it('returns undefined when both sync and search miss', async () => {
    searchEnheterMock.mockResolvedValue([]);
    const result = await resolveOrgnrAsync({
      url: 'https://random-unknown-blog.example/',
      title: 'Random',
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined for malformed URLs without hitting the network', async () => {
    const result = await resolveOrgnrAsync({ url: 'about:newtab', title: '' });
    expect(result).toBeUndefined();
    expect(searchEnheterMock).not.toHaveBeenCalled();
  });
});
