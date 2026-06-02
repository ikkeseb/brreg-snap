import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchHit } from '../src/types/brreg.js';

// Mock the brreg module so resolveOrgnrAsync can run its hostname-
// search fallback offline. Sync tests don't touch this path, so the
// mock stays inert for them.
vi.mock('../src/lib/brreg.js', () => ({
  searchEnheterWithParams: vi.fn(),
}));

import { searchEnheterWithParams } from '../src/lib/brreg.js';
import {
  extractOrgnrFromText,
  isValidOrgnr,
  resolveOrgnr,
  resolveOrgnrAsync,
} from '../src/lib/orgnr.js';

const searchMock = vi.mocked(searchEnheterWithParams);

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

  it('ignores earlier mod-11-INVALID runs and resolves the single valid one', () => {
    // 123456789 fails mod-11; 982463718 (Telenor) passes — only one valid.
    expect(extractOrgnrFromText('foo 123456789 bar 982463718 baz')).toBe(
      '982463718',
    );
  });

  it('abstains when two or more distinct VALID candidates are present', () => {
    // Both pass mod-11 (Equinor + Telenor). Positional first-match would
    // silently pick the earlier one — which could be the wrong company —
    // so we return undefined and let the caller fall through instead.
    expect(
      extractOrgnrFromText('aff 923609016 then 982463718'),
    ).toBeUndefined();
    // A repeated single valid candidate is NOT ambiguous.
    expect(extractOrgnrFromText('982463718 / 982463718')).toBe('982463718');
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

  it('returns undefined when neither URL nor title carry an orgnr', () => {
    const result = resolveOrgnr({
      url: 'https://www.telenor.no/privat',
      title: 'Telenor',
    });
    expect(result).toBeUndefined();
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

describe('resolveOrgnr — key-awareness and ambiguity (anti-shadowing)', () => {
  it('a named ?orgnr= param wins over an unnamed valid tracking id', () => {
    expect(
      resolveOrgnr({
        url: 'https://shop.example/?aff=923609016&orgnr=982463718',
        title: '',
      }),
    ).toBe('982463718');
  });

  it('resolves a single valid orgnr in the path (e.g. brreg /enheter/<orgnr>)', () => {
    expect(
      resolveOrgnr({ url: 'https://x.example/enheter/982463718', title: '' }),
    ).toBe('982463718');
  });

  it('still resolves a single valid orgnr in a query value', () => {
    expect(
      resolveOrgnr({ url: 'https://x.example/p?id=982463718', title: '' }),
    ).toBe('982463718');
  });

  it('abstains when two unnamed valid candidates collide — never a silent wrong company', () => {
    expect(
      resolveOrgnr({
        url: 'https://x.example/?aff=923609016&ref=982463718',
        title: '',
      }),
    ).toBeUndefined();
  });

  it('does NOT let a chance-valid path-segment id shadow the real orgnr', () => {
    // 100000008 passes mod-11 but is a product id in the path; 982463718
    // is the real orgnr in the query. A path-segment heuristic would
    // confidently return the junk — we abstain (the hostname pipeline /
    // picker takes over) rather than show the wrong company.
    expect(
      resolveOrgnr({
        url: 'https://shop.no/p/100000008/detail?id=982463718',
        title: '',
      }),
    ).toBeUndefined();
  });

  it('abstains when two differently-named orgnr params disagree', () => {
    expect(
      resolveOrgnr({
        url: 'https://x.example/?orgnr=982463718&organisasjonsnummer=923609016',
        title: '',
      }),
    ).toBeUndefined();
  });

  it('a mod-11-INVALID named param falls through to the single valid candidate', () => {
    // 123456789 fails mod-11, so the named param yields nothing; the only
    // valid 9-digit (982463718, in the path) is then resolved.
    expect(
      resolveOrgnr({
        url: 'https://x.example/enheter/982463718?orgnr=123456789',
        title: '',
      }),
    ).toBe('982463718');
  });

  it('falls through to the title when the URL is malformed (never throws)', () => {
    expect(
      resolveOrgnr({ url: 'ht!tp://[bad', title: 'Telenor 982463718' }),
    ).toBe('982463718');
  });
});

describe('resolveOrgnrAsync', () => {
  beforeEach(() => {
    installStorageMock();
    searchMock.mockReset();
  });

  it('short-circuits to the sync result and skips search when URL has an orgnr', async () => {
    const result = await resolveOrgnrAsync({
      url: 'https://example.com/about/982463718',
      title: '',
    });
    expect(result).toBe('982463718');
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('falls back to hostname search when the sync cascade misses', async () => {
    searchMock.mockResolvedValue([
      hit('YARA INTERNATIONAL ASA', '986228608', 'ASA'),
    ]);
    const result = await resolveOrgnrAsync({
      url: 'https://www.yara.com/about',
      title: 'Yara — global crop nutrition',
    });
    expect(result).toBe('986228608');
    // Pipeline issues multiple parallel queries (hjemmeside variants
    // + navn variants); we don't pin the exact count.
    expect(searchMock).toHaveBeenCalled();
  });

  it('returns undefined when both sync and search miss', async () => {
    searchMock.mockResolvedValue([]);
    const result = await resolveOrgnrAsync({
      url: 'https://random-unknown-blog.example/',
      title: 'Random',
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined for malformed URLs without hitting the network', async () => {
    const result = await resolveOrgnrAsync({ url: 'about:newtab', title: '' });
    expect(result).toBeUndefined();
    expect(searchMock).not.toHaveBeenCalled();
  });
});
