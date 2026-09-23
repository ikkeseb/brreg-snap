import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchEndringer } from '../src/lib/brreg-endringer.js';
import { invalidateCache } from '../src/lib/brreg.js';
import feedEmpty from './fixtures/brreg/oppdateringer-984851006-empty.json';
import feedEquinor from './fixtures/brreg/oppdateringer-923609016-equinor.json';
import feedRenamed from './fixtures/brreg/oppdateringer-914375916-nytt-navn.json';

type StorageMap = Record<string, unknown>;

function installStorage(): StorageMap {
  const store: StorageMap = {};
  (globalThis as { browser?: unknown }).browser = {
    storage: {
      session: {
        get: vi.fn(async (keys: string | string[] | null) => {
          const list =
            keys === null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
          const out: StorageMap = {};
          for (const k of list) if (k in store) out[k] = store[k];
          return out;
        }),
        set: vi.fn(async (entries: StorageMap) => {
          Object.assign(store, entries);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
        }),
      },
    },
  };
  return store;
}

const fetchMock = vi.fn();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SINCE = '2026-03-25T00:00:00.000Z';

let store: StorageMap;

beforeEach(() => {
  store = installStorage();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchEndringer', () => {
  it('asks the change feed for one orgnr, newest first, with changes', async () => {
    fetchMock.mockResolvedValue(json(feedEquinor));
    await fetchEndringer('923609016', SINCE);
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe(
      'https://data.brreg.no/enhetsregisteret/api/oppdateringer/enheter',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      organisasjonsnummer: '923609016',
      dato: SINCE,
      includeChanges: 'true',
      size: '100',
      sort: 'id,DESC',
    });
  });

  it('keeps each event with its patch paths and drops the values (live TOLLBUGATA 17)', async () => {
    fetchMock.mockResolvedValue(json(feedRenamed));
    const events = await fetchEndringer('914375916', SINCE);
    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({
      oppdateringsid: 25152016,
      dato: '2026-09-01T10:30:11.706Z',
      endringstype: 'Endring',
    });
    expect(events[0]!.endringer).toContainEqual({
      op: 'replace',
      path: '/forretningsadresse/postnummer',
    });
    expect(JSON.stringify(events)).not.toContain('Eksempelveien');
  });

  it('returns [] for a live answer without _embedded (nothing changed)', async () => {
    expect(feedEmpty).not.toHaveProperty('_embedded');
    fetchMock.mockResolvedValue(json(feedEmpty));
    await expect(fetchEndringer('984851006', SINCE)).resolves.toEqual([]);
  });

  it('caches for the day and reuses a cached window that covers the asked one', async () => {
    fetchMock.mockImplementation(async () => json(feedEquinor));
    const first = await fetchEndringer('923609016', SINCE);
    // A later window: served from cache, trimmed to the window.
    const later = await fetchEndringer('923609016', '2026-08-01T00:00:00.000Z');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(later.map((e) => e.dato)).toEqual(
      first.map((e) => e.dato).filter((d) => d >= '2026-08-01T00:00:00.000Z'),
    );
    expect(later).toHaveLength(3);
    // An earlier window than the cached one asks again.
    await fetchEndringer('923609016', '2026-01-01T00:00:00.000Z');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('is dropped by invalidateCache like the other per-orgnr parts', async () => {
    fetchMock.mockResolvedValue(json(feedEquinor));
    await fetchEndringer('923609016', SINCE);
    expect(store).toHaveProperty('endringer:923609016');
    await invalidateCache('923609016');
    expect(store).not.toHaveProperty('endringer:923609016');
  });

  it('refetches over a cache entry of the wrong shape', async () => {
    store['endringer:923609016'] = { value: [], expiresAt: Date.now() + 60_000 };
    fetchMock.mockResolvedValue(json(feedEquinor));
    await expect(fetchEndringer('923609016', SINCE)).resolves.toHaveLength(8);
  });

  it.each([400, 404, 429, 500, 503])('rejects on %i (never a silent «no changes»)', async (status) => {
    fetchMock.mockResolvedValue(json({ status }, status));
    await expect(fetchEndringer('923609016', SINCE)).rejects.toThrow(String(status));
    expect(store).not.toHaveProperty('endringer:923609016');
  });

  it('rejects when the network fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('NetworkError'));
    await expect(fetchEndringer('923609016', SINCE)).rejects.toThrow();
  });

  it.each([[[]], ['text'], [{ _embedded: { oppdaterteEnheter: {} } }], [{ _embedded: 3 }]])(
    'rejects an unexpected shape: %j',
    async (body) => {
      fetchMock.mockResolvedValue(json(body));
      await expect(fetchEndringer('923609016', SINCE)).rejects.toThrow(/shape/);
    },
  );

  it('skips malformed events and patch operations', async () => {
    fetchMock.mockResolvedValue(
      json({
        _embedded: {
          oppdaterteEnheter: [
            { oppdateringsid: 1 },
            { dato: '2026-09-01T10:00:00.000Z', endringer: [{ op: 'add' }, 7, { op: 'add', path: '/navn' }] },
          ],
        },
      }),
    );
    await expect(fetchEndringer('923609016', SINCE)).resolves.toEqual([
      { dato: '2026-09-01T10:00:00.000Z', endringer: [{ op: 'add', path: '/navn' }] },
    ]);
  });
});
