import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/hostname-search.js', () => ({
  searchByHostnameDetailed: vi.fn(),
  getRejectedChoices: vi.fn(async () => []),
}));
vi.mock('../src/lib/company-load.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/company-load.js')>()),
  lookupOrgnr: vi.fn(async () => ({})),
}));
vi.mock('../src/lib/orgnr.js', () => ({
  resolveOrgnr: vi.fn(() => undefined),
}));

import {
  getRejectedChoices,
  searchByHostnameDetailed,
} from '../src/lib/hostname-search.js';
import { lookupOrgnr } from '../src/lib/company-load.js';
import { resolveOrgnr } from '../src/lib/orgnr.js';
import {
  isHostDerived,
  RESOLUTION_METHODS,
  resolveTabContext,
} from '../src/lib/ui/resolve-tab.js';

const detailedMock = vi.mocked(searchByHostnameDetailed);
const syncMock = vi.mocked(resolveOrgnr);
const rejectedMock = vi.mocked(getRejectedChoices);
const lookupMock = vi.mocked(lookupOrgnr);

describe('resolveTabContext degraded flag', () => {
  beforeEach(() => {
    detailedMock.mockReset();
    syncMock.mockReset();
    syncMock.mockReturnValue(undefined);
  });

  it('marks a failed-search "none" as degraded, not a confirmed miss', async () => {
    detailedMock.mockResolvedValue({
      band: 'none',
      candidates: [],
      complete: false,
    });
    const ctx = await resolveTabContext('https://www.dnb.no/', 'DNB');
    expect(ctx.orgnr).toBeUndefined();
    expect(ctx.host).toBe('www.dnb.no');
    expect(ctx.degraded).toBe(true);
  });

  it('leaves a complete "none" un-degraded (genuine no-match)', async () => {
    detailedMock.mockResolvedValue({
      band: 'none',
      candidates: [],
      complete: true,
    });
    const ctx = await resolveTabContext('https://example.com/', 'Example');
    expect(ctx.degraded).toBeUndefined();
  });

  it('does not mark auto resolutions degraded even on partial data', async () => {
    detailedMock.mockResolvedValue({
      band: 'auto',
      candidates: [],
      choice: '910747711',
      complete: false,
    });
    const ctx = await resolveTabContext('https://orkla.com/', 'Orkla');
    expect(ctx.orgnr).toBe('910747711');
    expect(ctx.degraded).toBeUndefined();
  });

  it('skips the hostname search entirely for sync (URL) resolutions', async () => {
    syncMock.mockReturnValue({ orgnr: '984851006', method: 'url-path' });
    const ctx = await resolveTabContext(
      'https://virksomhet.brreg.no/nb/oppslag/enheter/984851006',
      '',
    );
    expect(ctx.orgnr).toBe('984851006');
    expect(ctx.method).toBe('url-path');
    expect(detailedMock).not.toHaveBeenCalled();
  });
});

describe('resolveTabContext provenance', () => {
  beforeEach(() => {
    detailedMock.mockReset();
    syncMock.mockReset();
    rejectedMock.mockReset();
    rejectedMock.mockResolvedValue([]);
  });

  it.each(['url-param', 'url-path', 'title'] as const)(
    'carries the %s tier as the method',
    async (tier) => {
      syncMock.mockReturnValue({ orgnr: '923609016', method: tier });
      const ctx = await resolveTabContext('https://trygg-handel.shop/', 'Org.nr 923609016');
      expect(ctx).toEqual({ orgnr: '923609016', host: 'trygg-handel.shop', method: tier });
    },
  );

  it('a URL/title orgnr the user rejected for this site falls through to the host search', async () => {
    // «Feil bedrift?» on a spoofing shop must not bring Equinor back on reload.
    syncMock.mockReturnValue({ orgnr: '923609016', method: 'title' });
    rejectedMock.mockResolvedValue(['923609016']);
    detailedMock.mockResolvedValue({ band: 'none', candidates: [], complete: true });
    const ctx = await resolveTabContext('https://trygg-handel.shop/', 'Org.nr 923609016');
    expect(ctx.orgnr).toBeUndefined();
    expect(ctx.host).toBe('trygg-handel.shop');
    expect(rejectedMock).toHaveBeenCalledWith('trygg-handel.shop');
    expect(detailedMock).toHaveBeenCalled();
  });

  it('passes the tab title to the host search as the word-boundary hint', async () => {
    syncMock.mockReturnValue(undefined);
    detailedMock.mockResolvedValue({ band: 'none', candidates: [], complete: true });
    await resolveTabContext('https://www.rema1000.no/', 'REMA 1000');
    expect(detailedMock).toHaveBeenCalledWith('www.rema1000.no', 'REMA 1000');
    await resolveTabContext('https://www.rema1000.no/', '');
    expect(detailedMock).toHaveBeenLastCalledWith('www.rema1000.no', undefined);
  });

  it('host-auto vs host-pick', async () => {
    syncMock.mockReturnValue(undefined);
    detailedMock.mockResolvedValue({ band: 'auto', candidates: [], choice: '984851006', complete: true });
    expect((await resolveTabContext('https://dnb.no/', '')).method).toBe('host-pick');
    detailedMock.mockResolvedValue({
      band: 'auto',
      candidates: [{ organisasjonsnummer: '984851006', navn: 'DNB BANK ASA', evidence: 'hjemmeside' }],
      choice: '984851006',
      complete: true,
    });
    expect((await resolveTabContext('https://dnb.no/', '')).method).toBe('host-auto');
  });
});

describe('isHostDerived — who gets «Feil bedrift?»', () => {
  it('every result the site produced, none the user chose elsewhere', () => {
    const derived = RESOLUTION_METHODS.filter((m) => isHostDerived(m));
    expect(derived).toEqual(['url-param', 'url-path', 'title', 'host-auto', 'host-pick']);
    expect(isHostDerived('manual')).toBe(false);
    expect(isHostDerived('drill-in')).toBe(false);
    expect(isHostDerived(undefined)).toBe(false);
  });
});

describe('resolveTabContext — a URL/title orgnr brreg does not know', () => {
  beforeEach(() => {
    detailedMock.mockReset();
    syncMock.mockReset();
    lookupMock.mockReset();
    rejectedMock.mockResolvedValue([]);
    syncMock.mockReturnValue({ orgnr: '900000006', method: 'url-path' });
  });

  it('falls through to the hostname search instead of a hard error', async () => {
    // A chance-valid product id in the path: /enheter/ and /underenheter/ both 404.
    lookupMock.mockRejectedValue(new Error('No entity found for orgnr 900000006.'));
    detailedMock.mockResolvedValue({ band: 'none', candidates: [], complete: true });
    const ctx = await resolveTabContext('https://shop.no/p/900000006', 'Sko');
    expect(ctx.orgnr).toBeUndefined();
    expect(detailedMock).toHaveBeenCalledWith('shop.no', 'Sko');
  });

  it('keeps the orgnr when brreg could not be asked: the load shows the real error', async () => {
    lookupMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const ctx = await resolveTabContext('https://shop.no/p/900000006', '');
    expect(ctx).toEqual({ orgnr: '900000006', host: 'shop.no', method: 'url-path' });
    expect(detailedMock).not.toHaveBeenCalled();
  });

  it('checks existence with the lookup the view reuses from cache', async () => {
    lookupMock.mockResolvedValue({ enhet: { organisasjonsnummer: '900000006', navn: 'X' } } as never);
    await resolveTabContext('https://shop.no/p/900000006', '');
    expect(lookupMock).toHaveBeenCalledWith('900000006');
  });
});
