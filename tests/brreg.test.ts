import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchEnhet,
  fetchRegnskap,
  fetchRoller,
  fetchUnderenhet,
  fetchUnderenheter,
  getFetchedAt,
  invalidateCache,
  MAX_RETRY_AFTER_MS,
  parseRetryAfter,
  searchEnheter,
  searchEnheterWithParams,
} from '../src/lib/brreg.js';
import regnskap500 from './fixtures/brreg/regnskap-984851006-500.json';
import underenhetAlta from './fixtures/brreg/underenhet-973160834.json';
import underenhetSlettet from './fixtures/brreg/underenhet-915821537-slettet.json';
import underenheterEmpty from './fixtures/brreg/underenheter-931744682-empty.json';
import underenheterPage from './fixtures/brreg/underenheter-984661185-page.json';

type StorageMap = Record<string, unknown>;

function installStorageMock(initial: StorageMap = {}): StorageMap {
  const store: StorageMap = { ...initial };
  (globalThis as { browser?: unknown }).browser = {
    storage: {
      session: {
        // null = the whole area, like the real API.
        get: vi.fn(async (keys: string | string[] | null) => {
          const list =
            keys === null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
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

  it('500 with the live generic body (DNB) → unavailable, not a failure', async () => {
    // The body brreg sends for banks/insurers since 2026: no plan code.
    fetchMock.mockResolvedValue(jsonResponse(regnskap500, 500));
    expect(await fetchRegnskap('984851006')).toEqual({
      items: [],
      unavailable: true,
    });
  });

  it('500 is cached for hours, not a day', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-23T08:00:00Z'));
      fetchMock.mockResolvedValue(jsonResponse(regnskap500, 500));
      await fetchRegnskap('984851006');

      vi.setSystemTime(new Date('2026-09-23T13:59:00Z'));
      await fetchRegnskap('984851006');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date('2026-09-23T14:01:00Z'));
      fetchMock.mockResolvedValue(jsonResponse(regnskap500, 500));
      await fetchRegnskap('984851006');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('500 naming the plan (the pre-2026 body) → plan code kept', async () => {
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
      unavailable: true,
      unsupportedPlan: 'BANK',
    });
  });

  it('500 with a non-JSON body → still unavailable', async () => {
    fetchMock.mockResolvedValue(new Response('<html>oops</html>', { status: 500 }));
    expect(await fetchRegnskap('123456785')).toEqual({
      items: [],
      unavailable: true,
    });
  });

  it('a network failure rejects, so callers can tell "couldn\'t ask"', async () => {
    fetchMock.mockRejectedValue(new TypeError('NetworkError'));
    await expect(fetchRegnskap('123456785')).rejects.toThrow();
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
    expect(result.unavailable).toBeUndefined();
  });
});

describe('fetchUnderenheter', () => {
  it('returns the true total with the first page (live Posten: 133)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(underenheterPage));
    const page = await fetchUnderenheter('984661185');
    expect(page.total).toBe(133);
    expect(page.items.map((u) => u.organisasjonsnummer)).toEqual([
      '918018395',
      '983498221',
    ]);
  });

  it('reads a parent with none (no _embedded) as an empty page', async () => {
    fetchMock.mockResolvedValue(jsonResponse(underenheterEmpty));
    expect(await fetchUnderenheter('931744682')).toEqual({ items: [], total: 0 });
  });

  it('never reports a total below what it returned', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        _embedded: {
          underenheter: [{ organisasjonsnummer: '918018395', navn: 'A' }],
        },
      }),
    );
    expect((await fetchUnderenheter('984661185')).total).toBe(1);
  });

  it('rejects on failure, so the UI can tell it from "none registered"', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));
    await expect(fetchUnderenheter('984661185')).rejects.toThrow(/503/);
  });

  it('ignores a cached entry in the old bare-array shape', async () => {
    installStorageMock({
      'underenheter:984661185': { value: [], expiresAt: Date.now() + 60_000 },
    });
    fetchMock.mockResolvedValue(jsonResponse(underenheterPage));
    expect((await fetchUnderenheter('984661185')).total).toBe(133);
  });
});

describe('fetchUnderenhet', () => {
  it('returns the underenhet with its parent (live DNB AVD ALTA)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(underenhetAlta));
    const u = await fetchUnderenhet('973160834');
    expect(u).toMatchObject({
      navn: 'DNB BANK ASA AVD ALTA',
      overordnetEnhet: '984851006',
    });
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toBe(
      'https://data.brreg.no/enhetsregisteret/api/underenheter/973160834',
    );
  });

  it('caches a hit', async () => {
    fetchMock.mockResolvedValue(jsonResponse(underenhetAlta));
    await fetchUnderenhet('973160834');
    await fetchUnderenhet('973160834');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolves undefined on 404 (not an underenhet)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 404));
    expect(await fetchUnderenhet('984851006')).toBeUndefined();
  });

  it('returns a deleted one as-is: slettedato, no parent (live shape)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(underenhetSlettet));
    const u = await fetchUnderenhet('915821537');
    expect(u?.slettedato).toBe('2026-09-21');
    expect(u?.overordnetEnhet).toBeUndefined();
  });

  it('rejects on failure and on an unexpected shape', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));
    await expect(fetchUnderenhet('973160834')).rejects.toThrow(/503/);
    fetchMock.mockResolvedValue(jsonResponse({ foo: 1 }));
    await expect(fetchUnderenhet('973160834')).rejects.toThrow(/shape/);
  });
});

describe('fetchRoller', () => {
  it('404 → empty roles (none registered), cached', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 404));
    expect(await fetchRoller('933724751')).toEqual({ rollegrupper: [] });
  });

  it('rejects on failure, so the UI can tell it from "none registered"', async () => {
    fetchMock.mockRejectedValue(new TypeError('NetworkError'));
    await expect(fetchRoller('923609016')).rejects.toThrow();
  });
});

describe('cache robustness + data age', () => {
  const ENHET = { organisasjonsnummer: '923609016', navn: 'EQUINOR ASA' };

  it('a failed cache write does not turn a good fetch into an error', async () => {
    vi.mocked(browser.storage.session.set).mockRejectedValue(
      new Error('QUOTA_BYTES quota exceeded'),
    );
    fetchMock.mockResolvedValue(jsonResponse(ENHET));
    await expect(fetchEnhet('923609016')).resolves.toEqual(ENHET);
  });

  it('getFetchedAt reports the original fetch time on a later cache hit', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-23T08:00:00Z'));
      const fetchedAt = Date.now();
      fetchMock.mockResolvedValue(jsonResponse(ENHET));
      await fetchEnhet('923609016');

      vi.setSystemTime(new Date('2026-09-23T15:00:00Z'));
      await fetchEnhet('923609016');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(await getFetchedAt('923609016')).toBe(fetchedAt);
    } finally {
      vi.useRealTimers();
    }
  });

  it('invalidateCache forces the next load to refetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENHET));
    await fetchEnhet('923609016');
    await invalidateCache('923609016');
    expect(await getFetchedAt('923609016')).toBeUndefined();
    fetchMock.mockResolvedValue(jsonResponse(ENHET));
    await fetchEnhet('923609016');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('429 rate limit: honour Retry-After, retry once', () => {
  const params = () => new URLSearchParams({ navn: 'orkla', size: '10' });
  const hits = { _embedded: { enheter: [{ organisasjonsnummer: '910747711', navn: 'ORKLA ASA' }] } };

  function tooMany(retryAfter?: string): Response {
    return new Response('{}', {
      status: 429,
      headers: retryAfter === undefined ? {} : { 'Retry-After': retryAfter },
    });
  }

  it('parses delay-seconds and HTTP-dates; junk and absence are undefined', () => {
    const now = Date.parse('2026-09-24T10:00:00Z');
    expect(parseRetryAfter('2', now)).toBe(2000);
    expect(parseRetryAfter(' 0 ', now)).toBe(0);
    expect(parseRetryAfter('Thu, 24 Sep 2026 10:00:03 GMT', now)).toBe(3000);
    // A date already past means "now", not a negative wait.
    expect(parseRetryAfter('Thu, 24 Sep 2026 09:59:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter('-1', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });

  it('waits Retry-After seconds, then retries once and succeeds', async () => {
    vi.useFakeTimers();
    try {
      fetchMock
        .mockResolvedValueOnce(tooMany('2'))
        .mockResolvedValueOnce(jsonResponse(hits));
      const pending = searchEnheterWithParams(params());
      await vi.advanceTimersByTimeAsync(1999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honours an HTTP-date Retry-After', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-24T10:00:00Z'));
      fetchMock
        .mockResolvedValueOnce(tooMany('Thu, 24 Sep 2026 10:00:04 GMT'))
        .mockResolvedValueOnce(jsonResponse(hits));
      const pending = searchEnheterWithParams(params());
      await vi.advanceTimersByTimeAsync(4000);
      await expect(pending).resolves.toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a wait longer than the cap is not retried: transient 429 error', async () => {
    fetchMock.mockResolvedValue(tooMany(String(MAX_RETRY_AFTER_MS / 1000 + 1)));
    await expect(searchEnheterWithParams(params())).rejects.toThrow(
      'brreg search returned 429.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('no Retry-After header is not retried', async () => {
    fetchMock.mockResolvedValue(tooMany());
    await expect(searchEnheterWithParams(params())).rejects.toThrow('429');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries only once: a second 429 fails as transient', async () => {
    fetchMock.mockResolvedValue(tooMany('0'));
    await expect(searchEnheterWithParams(params())).rejects.toThrow('429');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('applies to the detail fetchers too, and a 429 is never cached', async () => {
    fetchMock
      .mockResolvedValueOnce(tooMany('0'))
      .mockResolvedValueOnce(tooMany('0'));
    await expect(fetchEnhet('923609016')).rejects.toThrow('brreg API returned 429.');
    fetchMock.mockResolvedValueOnce(tooMany('0')).mockResolvedValueOnce(
      jsonResponse({ organisasjonsnummer: '923609016', navn: 'EQUINOR ASA' }),
    );
    await expect(fetchEnhet('923609016')).resolves.toMatchObject({ navn: 'EQUINOR ASA' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
