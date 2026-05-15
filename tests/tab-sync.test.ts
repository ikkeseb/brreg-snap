import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchHit } from '../src/types/brreg.js';

vi.mock('../src/lib/brreg.js', () => ({
  searchEnheterWithParams: vi.fn(),
}));

import { searchEnheterWithParams } from '../src/lib/brreg.js';
import { deriveSync, deriveSyncAsync } from '../src/lib/tab-sync.js';

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

describe('deriveSync', () => {
  it('resolves orgnr from url path even when title is empty', () => {
    // brreg's own canonical orgnr appears in path; resolver picks it up
    const result = deriveSync('https://example.com/foo/950588063', '');
    expect(result).toEqual({ orgnr: '950588063', host: 'example.com' });
  });

  it('returns null when url is undefined', () => {
    expect(deriveSync(undefined, 'DNB')).toBeNull();
  });

  it('returns null when no orgnr can be resolved', () => {
    expect(deriveSync('https://example.com/no-orgnr-here', 'Random')).toBeNull();
  });

  it('returns null on unknown menu target with non-http url', () => {
    // about:blank, file://, etc. — no orgnr resolvable, no domain match
    expect(deriveSync('about:blank', 'New Tab')).toBeNull();
  });

  it('handles malformed url by leaving host undefined when orgnr is in title', () => {
    // Edge case: resolver finds orgnr in title even though URL is junk
    const result = deriveSync('not-a-url', 'DNB BANK ASA orgnr 984851006');
    expect(result).toEqual({ orgnr: '984851006', host: undefined });
  });
});

describe('deriveSyncAsync', () => {
  beforeEach(() => {
    installStorageMock();
    searchMock.mockReset();
  });

  it('returns the sync result without hitting the network when URL carries an orgnr', async () => {
    const result = await deriveSyncAsync(
      'https://example.com/foo/984851006',
      'DNB',
    );
    expect(result).toEqual({ orgnr: '984851006', host: 'example.com' });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('falls back to hostname search when sync misses, populating host', async () => {
    searchMock.mockResolvedValue([
      hit('YARA INTERNATIONAL ASA', '986228608', 'ASA'),
    ]);
    const result = await deriveSyncAsync(
      'https://www.yara.com/about',
      'Yara — global crop nutrition',
    );
    expect(result).toEqual({ orgnr: '986228608', host: 'www.yara.com' });
  });

  it('returns null when both sync and search miss', async () => {
    searchMock.mockResolvedValue([]);
    expect(
      await deriveSyncAsync('https://random-unknown-blog.example/', ''),
    ).toBeNull();
  });

  it('returns null when url is undefined', async () => {
    expect(await deriveSyncAsync(undefined, 'DNB')).toBeNull();
    expect(searchMock).not.toHaveBeenCalled();
  });
});
