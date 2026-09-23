// Replays recorded live brreg responses (tests/fixtures/hostname/,
// recorded 2026-09-23) through the real brreg.ts + hostname-search.ts,
// with only `fetch` and storage.session faked. Each host here resolved
// wrongly or not at all before the resolver-precision fix. Fixture keys
// are the request's query string with params sorted; sole-proprietor
// (ENK) hits carry fictitious names, phones and street addresses.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeBrowser } from './helpers/fake-browser.js';
import { searchByHostnameDetailed } from '../src/lib/hostname-search.js';

type Fixture = Record<string, unknown>;

function loadFixture(host: string): Fixture {
  const url = new URL(`./fixtures/hostname/${host}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Fixture;
}

let unexpected: string[] = [];

function replay(fixture: Fixture): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string) => {
      const params = new URL(String(input)).searchParams;
      params.sort();
      const body = fixture[params.toString()];
      if (body === undefined) {
        // A request the recording never saw means the query shape
        // changed — fail loudly instead of letting the pipeline treat
        // it as a network error and quietly return a partial result.
        unexpected.push(String(input));
        return new Response('{}', { status: 599 });
      }
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}

async function resolve(host: string) {
  replay(loadFixture(host));
  const result = await searchByHostnameDetailed(host);
  expect(unexpected).toEqual([]);
  expect(result?.complete).toBe(true);
  return result;
}

beforeEach(() => {
  unexpected = [];
  fakeBrowser();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolver regressions against recorded live responses', () => {
  it('sbanken.no is not auto-resolved to TIDSBANKEN AS', async () => {
    // Was AUTO 999582214 via 'tidsbanken.no'.includes('sbanken.no').
    const result = await resolve('sbanken.no');
    expect(result?.band).toBe('picker');
    expect(result?.choice).toBeUndefined();
  });

  it('obos.no auto-resolves to OBOS BBL', async () => {
    // Was AUTO OBOS FELLESKOST AS / picker without OBOS BBL: the
    // unsorted 10-row hjemmeside page was all borettslag.
    const result = await resolve('obos.no');
    expect(result?.band).toBe('auto');
    expect(result?.choice).toBe('937052766');
  });

  it.each(['medium.com', 'bbc.co.uk', 'bbc.com'])(
    '%s no longer auto-resolves to a Norwegian namesake',
    async (host) => {
      // Was AUTO MEDIUM AS / BBC AS on the name alone (81 points, no
      // hjemmeside). The namesake stays offered in the picker.
      const result = await resolve(host);
      expect(result?.band).toBe('picker');
      expect(result?.choice).toBeUndefined();
    },
  );

  it('10thpbergen.com offers its own company although it is under avvikling', async () => {
    // Was «Ingen bedrift identifisert»: the -30 inactive penalty pushed
    // the site's only, hjemmeside-exact match below the picker floor.
    const result = await resolve('10thpbergen.com');
    expect(result?.band).toBe('picker');
    expect(result?.candidates.map((c) => c.organisasjonsnummer)).toContain(
      '931396145',
    );
  });

  it('storebrand.no puts STOREBRAND ASA first, above SPVs on page hjemmesider', async () => {
    // Property SPVs registered www.storebrand.no/eiendom; scored as
    // exact they filled the picker and pushed the ASA out of it.
    const result = await resolve('storebrand.no');
    expect(result?.band).toBe('picker');
    expect(result?.candidates[0]?.organisasjonsnummer).toBe('916300484');
  });
});
