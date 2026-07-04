import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/hostname-search.js', () => ({
  searchByHostnameDetailed: vi.fn(),
}));
vi.mock('../src/lib/orgnr.js', () => ({
  resolveOrgnr: vi.fn(() => undefined),
}));

import { searchByHostnameDetailed } from '../src/lib/hostname-search.js';
import { resolveOrgnr } from '../src/lib/orgnr.js';
import { resolveTabContext } from '../src/lib/ui/resolve-tab.js';

const detailedMock = vi.mocked(searchByHostnameDetailed);
const syncMock = vi.mocked(resolveOrgnr);

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
    syncMock.mockReturnValue('984851006');
    const ctx = await resolveTabContext(
      'https://virksomhet.brreg.no/nb/oppslag/enheter/984851006',
      '',
    );
    expect(ctx.orgnr).toBe('984851006');
    expect(detailedMock).not.toHaveBeenCalled();
  });
});
