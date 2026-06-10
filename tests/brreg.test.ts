import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchRegnskap,
  searchEnheter,
  searchEnheterWithParams,
} from '../src/lib/brreg.js';

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

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  installStorageMock();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('searchEnheterWithParams', () => {
  const params = () => new URLSearchParams({ navn: 'orkla', size: '10' });

  it('throws when fetch rejects (offline / timeout abort)', async () => {
    // AbortSignal.timeout rejects the fetch with a TimeoutError
    // DOMException — same propagation path as a plain network error.
    fetchMock.mockRejectedValue(
      new DOMException('The operation was aborted.', 'TimeoutError'),
    );
    await expect(searchEnheterWithParams(params())).rejects.toThrow();
  });

  it('throws on 429 (throttled)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 429));
    await expect(searchEnheterWithParams(params())).rejects.toThrow(/429/);
  });

  it('throws on 503 (brreg down)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));
    await expect(searchEnheterWithParams(params())).rejects.toThrow(/503/);
  });

  it('returns [] only for a genuine 2xx response with zero hits', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    expect(await searchEnheterWithParams(params())).toEqual([]);

    fetchMock.mockResolvedValue(jsonResponse({ _embedded: { enheter: [] } }));
    expect(await searchEnheterWithParams(params())).toEqual([]);
  });

  it('returns the hits on a 2xx response with results', async () => {
    const hits = [{ organisasjonsnummer: '910747711', navn: 'ORKLA ASA' }];
    fetchMock.mockResolvedValue(jsonResponse({ _embedded: { enheter: hits } }));
    expect(await searchEnheterWithParams(params())).toEqual(hits);
  });

  it('attaches an abort signal so a hung request times out', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await searchEnheterWithParams(params());
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('searchEnheter', () => {
  it('throws when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new TypeError('NetworkError'));
    await expect(searchEnheter('orkla')).rejects.toThrow();
  });

  it('throws on non-2xx', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 500));
    await expect(searchEnheter('orkla')).rejects.toThrow(/500/);
  });

  it('returns [] on 2xx with no hits', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    expect(await searchEnheter('orkla')).toEqual([]);
  });

  it('attaches an abort signal so a hung request times out', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await searchEnheter('orkla');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('fetchRegnskap special-casing', () => {
  it('404 → empty items, cached so refresh does not re-hit', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 404));
    expect(await fetchRegnskap('123456785')).toEqual({ items: [] });

    expect(await fetchRegnskap('123456785')).toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('500 with unsupported-plan body → unsupportedPlan extracted and cached', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          message:
            'Regnskapet inneholder en oppstillingsplan som ikke er stottet (BANK)',
        },
        500,
      ),
    );
    expect(await fetchRegnskap('984851006')).toEqual({
      items: [],
      unsupportedPlan: 'BANK',
    });

    expect(await fetchRegnskap('984851006')).toEqual({
      items: [],
      unsupportedPlan: 'BANK',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('500 without a parseable plan code → throws (generic failure)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'boom' }, 500));
    await expect(fetchRegnskap('123456785')).rejects.toThrow(/500/);
  });

  it('throws on other non-2xx (e.g. 503)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));
    await expect(fetchRegnskap('123456785')).rejects.toThrow(/503/);
  });

  it('2xx array → items returned', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([{ journalnr: '1', regnskapsperiode: { tilDato: '2023-12-31' } }]),
    );
    const result = await fetchRegnskap('123456785');
    expect(result.items).toHaveLength(1);
    expect(result.unsupportedPlan).toBeUndefined();
  });
});
