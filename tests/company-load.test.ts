import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from './helpers/fake-browser.js';

import {
  DeletedAvdelingError,
  isNotFoundError,
  isPermanentLoadError,
  loadCompany,
  lookupOrgnr,
} from '../src/lib/company-load.js';
import { describeLoadError } from '../src/lib/ui/error-message.js';
import enhetDnb from './fixtures/brreg/enhet-984851006-dnb.json';
import enhetEquinor from './fixtures/brreg/enhet-923609016-equinor.json';
import regnskapDnb500 from './fixtures/brreg/regnskap-984851006-500.json';
import regnskapEquinor from './fixtures/brreg/regnskap-923609016-usd.json';
import rollerEquinor from './fixtures/brreg/roller-923609016-equinor.json';
import underenhetAlta from './fixtures/brreg/underenhet-973160834.json';
import underenhetSlettet from './fixtures/brreg/underenhet-915821537-slettet.json';
import underenheterEmpty from './fixtures/brreg/underenheter-931744682-empty.json';

const API = 'https://data.brreg.no/enhetsregisteret/api';
const REGNSKAP = 'https://data.brreg.no/regnskapsregisteret/regnskap';

type StorageMap = Record<string, unknown>;

function installStorage(initial: StorageMap = {}): StorageMap {
  return fakeBrowser({ storage: { session: initial } }).stores.session;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// The live API's answers, by URL. Anything unrouted is a 404 — which is
// what brreg sends for an orgnr it doesn't know.
function routeBrreg(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = String(input);
    return routes[url]?.() ?? new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    urls: () => fetchMock.mock.calls.map(([u]) => String(u)),
  };
}

beforeEach(() => {
  installStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('lookupOrgnr', () => {
  it('returns the enhet for an enhet orgnr, without asking /underenheter', async () => {
    const { urls } = routeBrreg({
      [`${API}/enheter/923609016`]: () => json(enhetEquinor),
    });
    const match = await lookupOrgnr('923609016');
    expect(match.enhet.navn).toBe('EQUINOR ASA');
    expect(match.avdeling).toBeUndefined();
    expect(urls()).toEqual([`${API}/enheter/923609016`]);
  });

  it('falls back to the underenhet and returns its parent', async () => {
    // Live: /enheter/973160834 is a 404, /underenheter/973160834 is DNB
    // BANK ASA AVD ALTA with overordnetEnhet 984851006.
    const { urls } = routeBrreg({
      [`${API}/underenheter/973160834`]: () => json(underenhetAlta),
      [`${API}/enheter/984851006`]: () => json(enhetDnb),
    });
    const match = await lookupOrgnr('973160834');
    expect(match.enhet.organisasjonsnummer).toBe('984851006');
    expect(match.enhet.navn).toBe('DNB BANK ASA');
    expect(match.avdeling?.navn).toBe('DNB BANK ASA AVD ALTA');
    expect(urls()).toEqual([
      `${API}/enheter/973160834`,
      `${API}/underenheter/973160834`,
      `${API}/enheter/984851006`,
    ]);
  });

  it('rejects with the not-found error when the orgnr is neither', async () => {
    routeBrreg({});
    const err = await lookupOrgnr('923609024').catch((e: unknown) => e);
    expect(isNotFoundError(err)).toBe(true);
    expect(isPermanentLoadError(err)).toBe(true);
    expect(describeLoadError(err)).toBe(
      'Fant ingen bedrift med organisasjonsnummer 923609024.',
    );
  });

  it('rejects a deleted underenhet (no parent to show) as permanent', async () => {
    routeBrreg({
      [`${API}/underenheter/915821537`]: () => json(underenhetSlettet),
    });
    const err = await lookupOrgnr('915821537').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeletedAvdelingError);
    expect(isPermanentLoadError(err)).toBe(true);
    expect(describeLoadError(err)).toBe(
      '915821537 er underenheten EIKSUND INVEST AS ENGROS, som er slettet 21.09.2026.',
    );
  });

  it('passes a network failure through, and it is worth retrying', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const err = await lookupOrgnr('923609016').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(isPermanentLoadError(err)).toBe(false);
  });

  it('a 503 on the underenhet fallback is not reported as not-found', async () => {
    routeBrreg({
      [`${API}/underenheter/973160834`]: () => json({}, 503),
    });
    const err = await lookupOrgnr('973160834').catch((e: unknown) => e);
    expect(isNotFoundError(err)).toBe(false);
    expect(isPermanentLoadError(err)).toBe(false);
  });
});

describe('loadCompany', () => {
  it('loads an enhet with its soft parts', async () => {
    const { urls } = routeBrreg({
      [`${API}/enheter/923609016`]: () => json(enhetEquinor),
      [`${API}/enheter/923609016/roller`]: () => json(rollerEquinor),
      [`${REGNSKAP}/923609016`]: () => json(regnskapEquinor),
      [`${API}/underenheter?overordnetEnhet=923609016&size=100`]: () =>
        json(underenheterEmpty),
    });
    const company = await loadCompany('923609016', { underenheter: true });
    expect(company.enhet.navn).toBe('EQUINOR ASA');
    expect(company.avdeling).toBeUndefined();
    expect(company.roller?.rollegrupper?.length).toBeGreaterThan(0);
    expect(company.regnskap?.items[0]?.valuta).toBe('USD');
    expect(company.underenheter).toEqual({ items: [], total: 0 });
    expect(urls()).not.toContain(`${API}/underenheter/923609016`);
  });

  it('the popup variant never asks for the underenheter list', async () => {
    const { urls } = routeBrreg({
      [`${API}/enheter/923609016`]: () => json(enhetEquinor),
    });
    const company = await loadCompany('923609016');
    expect(company.underenheter).toBeUndefined();
    expect(urls().some((u) => u.includes('overordnetEnhet'))).toBe(false);
  });

  it('maps soft failures to undefined, not to empty answers', async () => {
    routeBrreg({
      [`${API}/enheter/923609016`]: () => json(enhetEquinor),
      [`${API}/enheter/923609016/roller`]: () => json({}, 503),
      [`${REGNSKAP}/923609016`]: () => json({}, 502),
      [`${API}/underenheter?overordnetEnhet=923609016&size=100`]: () =>
        json({}, 503),
    });
    const company = await loadCompany('923609016', { underenheter: true });
    expect(company.enhet.navn).toBe('EQUINOR ASA');
    expect(company.roller).toBeUndefined();
    expect(company.regnskap).toBeUndefined();
    expect(company.underenheter).toBeUndefined();
  });

  it('an underenhet orgnr loads the parent and the parent’s roller/regnskap', async () => {
    const { urls } = routeBrreg({
      [`${API}/underenheter/973160834`]: () => json(underenhetAlta),
      [`${API}/enheter/984851006`]: () => json(enhetDnb),
      [`${API}/enheter/984851006/roller`]: () => json(rollerEquinor),
      [`${REGNSKAP}/984851006`]: () => json(regnskapDnb500, 500),
    });
    const company = await loadCompany('973160834');
    expect(company.enhet.organisasjonsnummer).toBe('984851006');
    expect(company.avdeling?.organisasjonsnummer).toBe('973160834');
    expect(company.roller?.rollegrupper?.length).toBeGreaterThan(0);
    expect(company.regnskap?.unavailable).toBe(true);
    expect(urls()).toContain(`${API}/enheter/984851006/roller`);
    expect(urls()).toContain(`${REGNSKAP}/984851006`);
  });

  it('fetchedAt is the data age from the cache, not the render time', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-09-23T12:00:00Z').getTime();
    vi.setSystemTime(now);
    const threeHoursAgo = now - 3 * 60 * 60 * 1000;
    installStorage({
      'enhet:923609016': {
        value: enhetEquinor,
        expiresAt: threeHoursAgo + 24 * 60 * 60 * 1000,
        storedAt: threeHoursAgo,
      },
    });
    routeBrreg({
      [`${API}/enheter/923609016/roller`]: () => json(rollerEquinor),
      [`${REGNSKAP}/923609016`]: () => json(regnskapEquinor),
    });
    const company = await loadCompany('923609016');
    // Roller and regnskap were fetched just now; the enhet is 3 h old,
    // and the view is only as fresh as its oldest part.
    expect(company.fetchedAt).toBe(threeHoursAgo);
  });

  it('fetchedAt is now when nothing could be cached', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-09-23T12:00:00Z').getTime();
    vi.setSystemTime(now);
    const store = installStorage();
    const session = (
      globalThis as unknown as {
        browser: { storage: { session: { set: ReturnType<typeof vi.fn> } } };
      }
    ).browser.storage.session;
    session.set.mockRejectedValue(new Error('QUOTA_BYTES quota exceeded'));
    routeBrreg({ [`${API}/enheter/923609016`]: () => json(enhetEquinor) });
    const company = await loadCompany('923609016');
    expect(Object.keys(store)).toEqual([]);
    expect(company.fetchedAt).toBe(now);
  });
});
