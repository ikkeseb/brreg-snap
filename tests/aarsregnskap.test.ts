import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from './helpers/fake-browser.js';

import {
  aarsregnskapPdfUrl,
  fetchAarsregnskapYears,
  kunngjoringerUrl,
} from '../src/lib/aarsregnskap.js';
import yearsEquinor from './fixtures/brreg/aarsregnskap-aar-923609016.json';
import yearsSmall from './fixtures/brreg/aarsregnskap-aar-931744682.json';

const KOPI = 'https://data.brreg.no/regnskapsregisteret/regnskap/aarsregnskap/kopi';

type StorageMap = Record<string, unknown>;

function installStorage(): StorageMap {
  return fakeBrowser().stores.session;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(respond: () => Response) {
  const fetchMock = vi.fn(async (_input: string | URL) => respond());
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

let store: StorageMap;

beforeEach(() => {
  store = installStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchAarsregnskapYears', () => {
  it('returns the years newest first (brreg lists them oldest first)', async () => {
    const fetchMock = stubFetch(() => json(yearsEquinor));
    const years = await fetchAarsregnskapYears('923609016');
    expect(years[0]).toBe('2025');
    expect(years.at(-1)).toBe('2011');
    expect(years).toHaveLength(15);
    expect(fetchMock.mock.calls.map(([u]) => String(u))).toEqual([
      `${KOPI}/923609016/aar`,
    ]);
  });

  it('asks brreg once and serves the cache after', async () => {
    const fetchMock = stubFetch(() => json(yearsSmall));
    expect(await fetchAarsregnskapYears('931744682')).toEqual(['2023']);
    expect(await fetchAarsregnskapYears('931744682')).toEqual(['2023']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads [] as «no copies» and caches it', async () => {
    // Live: an orgnr brreg doesn't know (923609024) answers 200 [].
    const fetchMock = stubFetch(() => json([]));
    expect(await fetchAarsregnskapYears('923609024')).toEqual([]);
    expect(await fetchAarsregnskapYears('923609024')).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads a 404 as «no copies»', async () => {
    stubFetch(() => new Response('', { status: 404 }));
    expect(await fetchAarsregnskapYears('923609024')).toEqual([]);
    expect(store['aarsregnskap:923609024']).toBeDefined();
  });

  it('drops anything that is not a year', async () => {
    stubFetch(() => json(['2024', 2023, '20x2', '2024', null, '2022']));
    expect(await fetchAarsregnskapYears('923609016')).toEqual(['2024', '2022']);
  });

  it('rejects on another status, a bad shape or a network failure, caching nothing', async () => {
    // The regnskap API is rate-limited (x-rate-limit-remaining live).
    stubFetch(() => new Response('', { status: 429 }));
    await expect(fetchAarsregnskapYears('923609016')).rejects.toThrow(/429/);
    stubFetch(() => json({ years: ['2025'] }));
    await expect(fetchAarsregnskapYears('923609016')).rejects.toThrow(/shape/);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('NetworkError');
      }),
    );
    await expect(fetchAarsregnskapYears('923609016')).rejects.toThrow();
    expect(store).toEqual({});
  });
});

describe('link builders', () => {
  it('points at the annual-report copy for one year', () => {
    expect(aarsregnskapPdfUrl('923609016', '2025')).toBe(
      `${KOPI}/923609016/2025`,
    );
  });

  it('points at brreg’s announcement list', () => {
    expect(kunngjoringerUrl('923609016')).toBe(
      'https://w2.brreg.no/kunngjoring/hent_nr.jsp?orgnr=923609016',
    );
  });
});
