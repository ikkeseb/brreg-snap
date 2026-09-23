import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from './helpers/fake-browser.js';

import type { SearchHit } from '../src/types/brreg.js';

vi.mock('../src/lib/brreg.js', () => ({
  searchEnheterWithParams: vi.fn(),
}));

import { searchEnheterWithParams } from '../src/lib/brreg.js';
import {
  addRejectedChoice,
  forgetHost,
  getPickerChoice,
  getRejectedChoices,
  getRememberedChoice,
  queryFromHostname,
  searchByHostnameDetailed,
  setPickerChoice,
  siteKey,
} from '../src/lib/hostname-search.js';

const searchMock = vi.mocked(searchEnheterWithParams);

type StorageMap = Record<string, unknown>;

function installStorageMock(initial: StorageMap = {}): StorageMap {
  return fakeBrowser({ storage: { session: initial } }).stores.session;
}

function hit(
  navn: string,
  organisasjonsnummer: string,
  extra: Partial<SearchHit> = {},
): SearchHit {
  return {
    navn,
    organisasjonsnummer,
    organisasjonsform: { kode: 'AS' },
    ...extra,
  };
}

describe('queryFromHostname', () => {
  it('strips www and TLD, leaves the brand label', () => {
    expect(queryFromHostname('www.yara.com')).toBe('yara');
    expect(queryFromHostname('yara.com')).toBe('yara');
  });

  it('returns undefined for single-label or too-short hostnames', () => {
    expect(queryFromHostname('localhost')).toBeUndefined();
    expect(queryFromHostname('a.no')).toBeUndefined();
  });
});

describe('searchByHostnameDetailed', () => {
  beforeEach(() => {
    installStorageMock();
    searchMock.mockReset();
  });

  it('returns band=auto with the choice orgnr when confident', async () => {
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) return [];
      return [
        hit('YARA INTERNATIONAL ASA', '986228608', {
          organisasjonsform: { kode: 'ASA' },
          hjemmeside: 'www.yara.com',
        }),
      ];
    });

    const result = await searchByHostnameDetailed('yara.com');
    expect(result?.band).toBe('auto');
    expect(result?.choice).toBe('986228608');
  });

  it('returns band=picker with candidates when ambiguous', async () => {
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) {
        return [
          hit('ELKJØP LEKNES', '111111118', { hjemmeside: 'elkjop.no' }),
          hit('ELKJØP SVOLVÆR', '222222226', { hjemmeside: 'elkjop.no' }),
        ];
      }
      return [];
    });

    const result = await searchByHostnameDetailed('elkjop.no');
    expect(result?.band).toBe('picker');
    expect(result?.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('returns band=none when nothing matches', async () => {
    searchMock.mockResolvedValue([]);
    const result = await searchByHostnameDetailed('mdn.mozilla.org');
    expect(result?.band).toBe('none');
    expect(result?.candidates).toEqual([]);
  });

  it('caches results and skips network on the second call', async () => {
    searchMock.mockResolvedValue([
      hit('YARA INTERNATIONAL ASA', '986228608', {
        organisasjonsform: { kode: 'ASA' },
        hjemmeside: 'www.yara.com',
      }),
    ]);
    await searchByHostnameDetailed('yara.com');
    const callsAfterFirst = searchMock.mock.calls.length;
    await searchByHostnameDetailed('yara.com');
    expect(searchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('honors a positive picker-choice cache: band=auto, choice set', async () => {
    await setPickerChoice('shell.no', '914807077');
    const result = await searchByHostnameDetailed('shell.no');
    expect(result).toEqual({
      band: 'auto',
      candidates: [],
      choice: '914807077',
      complete: true,
    });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('honors a negative picker-choice cache: band=none', async () => {
    await setPickerChoice('shell.no', null);
    const result = await searchByHostnameDetailed('shell.no');
    expect(result).toEqual({ band: 'none', candidates: [], complete: true });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('falls back to Q3 (no org-form filter) when Q1+Q2 yields zero', async () => {
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) return [];
      if (params.has('organisasjonsform')) return [];
      // Q3 has no organisasjonsform set.
      return [
        hit('EKSPORTFINANSIERING NORGE', '999000001', {
          organisasjonsform: { kode: 'ORGL' },
        }),
      ];
    });

    const result = await searchByHostnameDetailed('eksfin.no');
    const q3Call = searchMock.mock.calls.find(
      (call) =>
        call[0].has('navn') &&
        !call[0].has('organisasjonsform'),
    );
    expect(q3Call).toBeDefined();
    expect(result).toBeDefined();
  });

  it('caps a confident name-only match at the picker', async () => {
    // Live shape (medium.com): MEDIUM AS scores 81 with a 13-point lead,
    // but nothing in the registry ties it to the site.
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) return [];
      return [
        hit('MEDIUM AS', '913491718', { registrertIForetaksregisteret: true }),
      ];
    });

    const result = await searchByHostnameDetailed('medium.com');
    expect(result?.band).toBe('picker');
    expect(result?.choice).toBeUndefined();
    expect(result?.candidates.map((c) => c.organisasjonsnummer)).toEqual([
      '913491718',
    ]);
  });
});

describe('brreg queries', () => {
  beforeEach(() => {
    installStorageMock();
    searchMock.mockReset();
    searchMock.mockResolvedValue([]);
  });

  const calls = () =>
    searchMock.mock.calls.map((c) => Object.fromEntries(c[0]));

  it('sends one hjemmeside query on the registrable domain, sorted by headcount', async () => {
    // Brreg matches hjemmeside as a substring, so the www. variant was a
    // redundant second request; unsorted, the first 10 rows of obos.no
    // were borettslag and OBOS BBL never became a candidate.
    await searchByHostnameDetailed('nettbank.dnb.no');
    const q1 = calls().filter((p) => 'hjemmeside' in p);
    expect(q1).toEqual([
      { hjemmeside: 'dnb.no', sort: 'antallAnsatte,DESC', size: '20' },
    ]);
  });

  it('keeps BBL in the name query\'s org-form filter', async () => {
    await searchByHostnameDetailed('obos.no');
    const q2 = calls().filter((p) => 'organisasjonsform' in p);
    expect(q2.length).toBeGreaterThan(0);
    for (const p of q2) {
      expect(p.organisasjonsform?.split(',')).toContain('BBL');
    }
  });

  it('queries the tenant on hosting-platform subdomains', async () => {
    await searchByHostnameDetailed('firma.pages.dev');
    const params = calls();
    expect(params).toContainEqual(
      expect.objectContaining({ hjemmeside: 'firma.pages.dev' }),
    );
    const navn = params.filter((p) => 'navn' in p).map((p) => p.navn);
    expect(navn).toContain('firma');
    expect(navn.some((n) => n?.includes('pages'))).toBe(false);
  });
});

describe('hosts that never reach brreg', () => {
  let store: StorageMap;

  beforeEach(() => {
    store = installStorageMock();
    searchMock.mockReset();
  });

  // Intranet names and IP literals used to go out as hjemmeside=/navn=
  // queries (192.168.10.20 → navn=10, jira.corp.internal → navn=corp).
  const hosts = [
    '192.168.10.20',
    '10.0.0.12',
    '[::1]',
    '[fe80::1]',
    'localhost',
    'intranet',
    'jira.corp.internal',
    'printer.local',
    'nas.lan',
    'router.home.arpa',
    'fileserver.firma.lokal',
    'sharepoint.firma.intern',
    'server.priv',
    'fritz.box',
    'sites.google.com',
  ];

  it.each(hosts)('%s resolves to none locally, sends nothing, stores nothing', async (host) => {
    expect(await searchByHostnameDetailed(host)).toEqual({
      band: 'none',
      candidates: [],
      complete: true,
    });
    expect(searchMock).not.toHaveBeenCalled();
    expect(Object.keys(store)).toEqual([]);
  });
});

describe('pipeline failure handling (network errors)', () => {
  let store: StorageMap;

  beforeEach(() => {
    store = installStorageMock();
    searchMock.mockReset();
  });

  const bandKeys = () =>
    Object.keys(store).filter((k) => k.startsWith('hostname:'));

  it('returns band=none WITHOUT caching when every query fails', async () => {
    searchMock.mockRejectedValue(new Error('brreg search returned 503.'));

    const result = await searchByHostnameDetailed('yara.com');
    expect(result).toEqual({ band: 'none', candidates: [], complete: false });
    expect(bandKeys()).toEqual([]);

    // Next visit retries the network instead of serving a 24h miss.
    const callsAfterFirst = searchMock.mock.calls.length;
    await searchByHostnameDetailed('yara.com');
    expect(searchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('returns a best-effort result WITHOUT caching on partial failure', async () => {
    // hjemmeside queries throttled; navn queries succeed with a clear
    // winner. The result is served, but built on partial data — it
    // must not enter the band cache.
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) {
        throw new Error('brreg search returned 429.');
      }
      return [
        hit('YARA INTERNATIONAL ASA', '986228608', {
          organisasjonsform: { kode: 'ASA' },
          hjemmeside: 'www.yara.com',
          antallAnsatte: 50,
        }),
        hit('YARA FOODS NORGE AS', '999999998', {
          organisasjonsform: { kode: 'AS' },
          overordnetEnhet: '986228608',
        }),
      ];
    });

    const result = await searchByHostnameDetailed('yara.com');
    expect(result?.band).toBe('auto');
    expect(result?.choice).toBe('986228608');
    expect(result?.complete).toBe(false);
    expect(bandKeys()).toEqual([]);
  });

  it('caches the result when all queries succeed (regression)', async () => {
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) return [];
      return [
        hit('YARA INTERNATIONAL ASA', '986228608', {
          organisasjonsform: { kode: 'ASA' },
          hjemmeside: 'www.yara.com',
          antallAnsatte: 50,
        }),
      ];
    });

    const result = await searchByHostnameDetailed('yara.com');
    expect(result?.band).toBe('auto');
    expect(bandKeys()).toEqual(['hostname:yara.com']);
  });

  it('a failed Q3 fallback also blocks caching', async () => {
    // Q1+Q2 succeed with zero hits, which triggers the Q3 fallback
    // (no org-form filter) — and Q3 fails. The run is incomplete.
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) return [];
      if (params.has('organisasjonsform')) return [];
      throw new Error('brreg search returned 503.');
    });

    const result = await searchByHostnameDetailed('eksfin.no');
    expect(result?.band).toBe('none');
    expect(result?.complete).toBe(false);
    expect(bandKeys()).toEqual([]);
  });

  it('picker-choice cache still wins regardless of network state', async () => {
    searchMock.mockRejectedValue(new Error('offline'));
    await setPickerChoice('yara.com', '986228608');
    expect(await searchByHostnameDetailed('yara.com')).toMatchObject({
      band: 'auto',
      choice: '986228608',
    });
    expect(searchMock).not.toHaveBeenCalled();
  });
});

describe('getPickerChoice / setPickerChoice', () => {
  beforeEach(() => {
    installStorageMock();
  });

  it('round-trips a positive choice', async () => {
    await setPickerChoice('shell.no', '914807077');
    expect(await getPickerChoice('shell.no')).toBe('914807077');
  });

  it('round-trips a negative choice (null = "Ingen av disse")', async () => {
    await setPickerChoice('shell.no', null);
    expect(await getPickerChoice('shell.no')).toBeNull();
  });

  it('returns undefined when no choice has been cached', async () => {
    expect(await getPickerChoice('shell.no')).toBeUndefined();
  });
});

describe('addRejectedChoice + pipeline filtering', () => {
  beforeEach(() => {
    installStorageMock();
    searchMock.mockReset();
  });

  it('round-trips and dedupes rejected orgnrs', async () => {
    await addRejectedChoice('foo.no', '111111118');
    await addRejectedChoice('foo.no', '222222226');
    await addRejectedChoice('foo.no', '111111118'); // duplicate — no-op
    expect(await getRejectedChoices('foo.no')).toEqual([
      '111111118',
      '222222226',
    ]);
  });

  it('returns [] when nothing has been rejected', async () => {
    expect(await getRejectedChoices('nothing.no')).toEqual([]);
  });

  it('filters rejected candidates from the pipeline result', async () => {
    // Two near-identical kjedebutikker — without rejection, this is
    // picker band. After rejecting the first, only one remains, which
    // means a (now unambiguous) auto pick on the second.
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) {
        return [
          hit('ELKJØP LEKNES', '111111118', { hjemmeside: 'elkjop.no' }),
          hit('ELKJØP SVOLVÆR', '222222226', { hjemmeside: 'elkjop.no' }),
        ];
      }
      return [];
    });

    const before = await searchByHostnameDetailed('elkjop.no');
    expect(before?.band).toBe('picker');

    await addRejectedChoice('elkjop.no', '111111118');
    const after = await searchByHostnameDetailed('elkjop.no');
    // Filtered candidate list excludes the rejected orgnr.
    expect(after?.candidates.find((c) => c.organisasjonsnummer === '111111118'))
      .toBeUndefined();
    expect(after?.candidates.length).toBe(1);
  });

  it('drops a positive picker-choice when the same orgnr is rejected', async () => {
    await setPickerChoice('elkjop.no', '111111118');
    expect(await getPickerChoice('elkjop.no')).toBe('111111118');

    await addRejectedChoice('elkjop.no', '111111118');
    // Positive choice no longer short-circuits future resolutions.
    expect(await getPickerChoice('elkjop.no')).toBeUndefined();
  });

  it('produces a separate band cache per rejected set', async () => {
    // First call without rejection; second after rejecting the auto
    // winner. Both must hit the network — the band cache key includes
    // the rejected hash, so the second is not served from the first.
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.has('hjemmeside')) return [];
      return [
        hit('YARA INTERNATIONAL ASA', '986228608', {
          organisasjonsform: { kode: 'ASA' },
          hjemmeside: 'www.yara.com',
          antallAnsatte: 50,
        }),
        hit('YARA FOODS NORGE AS', '999999998', {
          organisasjonsform: { kode: 'AS' },
          overordnetEnhet: '986228608',
        }),
      ];
    });

    expect((await searchByHostnameDetailed('yara.com'))?.choice).toBe('986228608');
    const callsAfterFirst = searchMock.mock.calls.length;

    await addRejectedChoice('yara.com', '986228608');
    await searchByHostnameDetailed('yara.com');
    expect(searchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});

describe('one site, one key: www., apex and subdomains share entries', () => {
  let store: StorageMap;

  beforeEach(() => {
    store = installStorageMock();
    searchMock.mockReset();
  });

  it('siteKey is the registrable domain, else the bare host', () => {
    expect(siteKey('www.dnb.no')).toBe('dnb.no');
    expect(siteKey('nettbank.dnb.no')).toBe('dnb.no');
    expect(siteKey('DNB.no.')).toBe('dnb.no');
    expect(siteKey('shop.firma.co.uk')).toBe('firma.co.uk');
    expect(siteKey('firma.netlify.app')).toBe('firma.netlify.app');
    expect(siteKey('192.168.1.10')).toBe('192.168.1.10');
    expect(siteKey('www.intranet')).toBe('intranet');
  });

  it('a pick on www.dnb.no answers for dnb.no and nettbank.dnb.no', async () => {
    await setPickerChoice('www.dnb.no', '984851006');
    for (const host of ['dnb.no', 'nettbank.dnb.no', 'www.dnb.no']) {
      expect(await searchByHostnameDetailed(host)).toMatchObject({
        band: 'auto',
        choice: '984851006',
      });
    }
    expect(Object.keys(store)).toEqual(['picker-choice:dnb.no']);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('a rejection on one subdomain applies to the whole site', async () => {
    await addRejectedChoice('nettbank.dnb.no', '111111118');
    expect(await getRejectedChoices('www.dnb.no')).toEqual(['111111118']);
  });

  it('the band cache is shared: the second host of the site sends nothing', async () => {
    searchMock.mockImplementation(async (params: URLSearchParams) =>
      params.has('hjemmeside')
        ? [
            hit('DNB BANK ASA', '984851006', {
              organisasjonsform: { kode: 'ASA' },
              hjemmeside: 'www.dnb.no',
              antallAnsatte: 9000,
            }),
          ]
        : [],
    );
    const first = await searchByHostnameDetailed('www.dnb.no');
    const calls = searchMock.mock.calls.length;
    const second = await searchByHostnameDetailed('nettbank.dnb.no');
    expect(searchMock.mock.calls.length).toBe(calls);
    expect(second).toEqual(first);
    expect(Object.keys(store)).toEqual(['hostname:dnb.no']);
  });
});

describe('getRememberedChoice + forgetHost (undo)', () => {
  let store: StorageMap;

  beforeEach(() => {
    store = installStorageMock();
    searchMock.mockReset();
  });

  it('reports nothing for a site the user never answered', async () => {
    expect(await getRememberedChoice('dnb.no')).toBeUndefined();
  });

  it('reports a pick, a «Ingen av disse» and a rejection list', async () => {
    await setPickerChoice('www.dnb.no', '984851006');
    expect(await getRememberedChoice('dnb.no')).toEqual({
      kind: 'choice',
      orgnr: '984851006',
    });
    await setPickerChoice('shell.no', null);
    expect(await getRememberedChoice('www.shell.no')).toEqual({ kind: 'none' });
    await addRejectedChoice('foo.no', '111111118');
    expect(await getRememberedChoice('foo.no')).toEqual({
      kind: 'rejected',
      orgnrs: ['111111118'],
    });
  });

  it('a choice wins over a rejection list: it is what decides the site', async () => {
    await addRejectedChoice('foo.no', '111111118');
    await setPickerChoice('foo.no', '222222226');
    expect(await getRememberedChoice('foo.no')).toEqual({
      kind: 'choice',
      orgnr: '222222226',
    });
  });

  it('forgetHost clears choice, rejections and every cached band for the site', async () => {
    const entry = (value: unknown) => ({
      value,
      expiresAt: Date.now() + 60_000,
      storedAt: Date.now(),
    });
    Object.assign(store, {
      'picker-choice:dnb.no': entry('984851006'),
      'rejected:dnb.no': entry(['111111118']),
      'hostname:dnb.no': entry({ band: 'none', candidates: [] }),
      'hostname:dnb.no:rej:111111118': entry({ band: 'none', candidates: [] }),
      'hostname:dnb.no:seg:d nb': entry({ band: 'none', candidates: [] }),
      // 1.3.1 keyed by the full hostname.
      'picker-choice:www.dnb.no': entry(null),
      'rejected:nettbank.dnb.no': entry(['222222226']),
      'hostname:www.dnb.no:rej:222222226': entry({ band: 'none', candidates: [] }),
      // Other sites and other caches stay.
      'picker-choice:dnbx.no': entry('999999999'),
      'hostname:tidsbanken.no': entry({ band: 'none', candidates: [] }),
      'enhet:984851006': entry({ navn: 'DNB BANK ASA' }),
      recent: [{ orgnr: '984851006' }],
    });
    await forgetHost('nettbank.dnb.no');
    expect(Object.keys(store).sort()).toEqual([
      'enhet:984851006',
      'hostname:tidsbanken.no',
      'picker-choice:dnbx.no',
      'recent',
    ]);
    expect(await getRememberedChoice('dnb.no')).toBeUndefined();
  });

  it('after forgetHost the site resolves from scratch', async () => {
    await setPickerChoice('shell.no', null);
    await forgetHost('www.shell.no');
    searchMock.mockResolvedValue([]);
    await searchByHostnameDetailed('shell.no');
    expect(searchMock).toHaveBeenCalled();
  });

  it('never throws when storage fails', async () => {
    (globalThis as { browser?: unknown }).browser = {
      storage: {
        session: {
          get: vi.fn(async () => {
            throw new Error('no storage');
          }),
          remove: vi.fn(async () => {
            throw new Error('no storage');
          }),
        },
      },
    };
    await expect(forgetHost('dnb.no')).resolves.toBeUndefined();
  });
});

describe('coalescing: concurrent lookups of one site share one run', () => {
  beforeEach(() => {
    installStorageMock();
    searchMock.mockReset();
  });

  it('two concurrent calls send each query once and get the same answer', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      await gate;
      return params.has('hjemmeside')
        ? [
            hit('YARA INTERNATIONAL ASA', '986228608', {
              organisasjonsform: { kode: 'ASA' },
              hjemmeside: 'www.yara.com',
              antallAnsatte: 50,
            }),
          ]
        : [];
    });
    const a = searchByHostnameDetailed('www.yara.com');
    const b = searchByHostnameDetailed('yara.com');
    await new Promise<void>((r) => setTimeout(r, 0));
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toEqual(rb);
    expect(ra?.choice).toBe('986228608');
    const hjemmesideCalls = searchMock.mock.calls.filter((c) =>
      (c[0]).has('hjemmeside'),
    );
    expect(hjemmesideCalls).toHaveLength(1);
  });

  it('a failed run is not remembered: the next call asks again', async () => {
    searchMock.mockRejectedValueOnce(new Error('offline'));
    searchMock.mockResolvedValue([]);
    await searchByHostnameDetailed('yara.com');
    const calls = searchMock.mock.calls.length;
    await searchByHostnameDetailed('yara.com');
    expect(searchMock.mock.calls.length).toBeGreaterThan(calls);
  });
});

describe('candidate evidence for per-row labels', () => {
  beforeEach(() => {
    installStorageMock();
    searchMock.mockReset();
  });

  it('marks hjemmeside-tied rows «hjemmeside» and name-only rows «navn»', async () => {
    searchMock.mockImplementation(async (params: URLSearchParams) =>
      params.has('hjemmeside')
        ? [
            hit('ELKJØP LEKNES AS', '111111118', { hjemmeside: 'www.elkjop.no/leknes' }),
            hit('ELKJØP SVOLVÆR AS', '222222226', { hjemmeside: 'elkjop.no/svolvaer' }),
          ]
        : [hit('ELKJØP NORGE AS', '333333334', { antallAnsatte: 2000 })],
    );
    const result = await searchByHostnameDetailed('elkjop.no');
    expect(result?.band).toBe('picker');
    const evidence = Object.fromEntries(
      (result?.candidates ?? []).map((c) => [c.organisasjonsnummer, c.evidence]),
    );
    expect(evidence).toEqual({
      '111111118': 'hjemmeside',
      '222222226': 'hjemmeside',
      '333333334': 'navn',
    });
  });

  it('treats a cached band from an older build (no evidence) as a miss', async () => {
    const store = installStorageMock({
      'hostname:yara.com': {
        value: { band: 'picker', candidates: [hit('YARA AS', '986228608')] },
        expiresAt: Date.now() + 60_000,
      },
    });
    searchMock.mockResolvedValue([]);
    const result = await searchByHostnameDetailed('yara.com');
    expect(searchMock).toHaveBeenCalled();
    expect(result?.band).toBe('none');
    expect(store['hostname:yara.com']).toMatchObject({
      value: { band: 'none', candidates: [] },
    });
  });
});

describe('title as a word-boundary hint (run-together labels)', () => {
  beforeEach(() => {
    installStorageMock();
    searchMock.mockReset();
  });

  const navnQueries = () =>
    searchMock.mock.calls
      .map((c) => (c[0]).get('navn'))
      .filter((n): n is string => n !== null);

  it('re-spaces the label from the title and finds the spaced name', async () => {
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.get('navn') === 'det norske teatret') {
        return [hit('LL DET NORSKE TEATRET', '921196164', { antallAnsatte: 306 })];
      }
      return [];
    });
    const result = await searchByHostnameDetailed(
      'www.detnorsketeatret.no',
      'Det Norske Teatret – Forestillinger og billetter',
    );
    expect(result?.band).toBe('picker');
    expect(result?.candidates[0]).toMatchObject({
      organisasjonsnummer: '921196164',
      evidence: 'navn',
    });
    // Nothing but the label's own letters, re-spaced, is sent.
    const spaced = navnQueries().filter((q) => q.includes(' '));
    expect([...new Set(spaced)]).toEqual(['det norske teatret']);
    expect(navnQueries().some((q) => q.includes('forestilling'))).toBe(false);
  });

  it('never runs without a title, or when the label already matched a name', async () => {
    searchMock.mockImplementation(async (params: URLSearchParams) =>
      params.get('navn') === 'obos'
        ? [hit('OBOS BBL', '937052766', { organisasjonsform: { kode: 'BBL' } })]
        : [],
    );
    await searchByHostnameDetailed('obos.no', 'OBOS – Obos Boligbyggelag');
    expect(navnQueries().every((q) => !q.includes(' '))).toBe(true);
    searchMock.mockClear();
    await searchByHostnameDetailed('rema1000.no');
    expect(navnQueries().every((q) => !q.includes(' '))).toBe(true);
  });

  it('a title with nothing matching the label sends no extra query', async () => {
    searchMock.mockResolvedValue([]);
    const result = await searchByHostnameDetailed('rema1000.no', 'Handle mat på nett');
    expect(result?.band).toBe('none');
    expect(navnQueries().every((q) => !q.includes(' '))).toBe(true);
  });

  it('keeps the plain result when the spaced query finds nothing', async () => {
    searchMock.mockImplementation(async (params: URLSearchParams) =>
      params.has('hjemmeside')
        ? [hit('STEIN LYSTHAUG AS', '985814430', { hjemmeside: 'www.rema1000.no', antallAnsatte: 18 })]
        : [],
    );
    const result = await searchByHostnameDetailed('rema1000.no', 'REMA 1000');
    expect(navnQueries()).toContain('rema 1000');
    expect(result?.candidates.map((c) => c.organisasjonsnummer)).toEqual(['985814430']);
  });

  it('a failed spaced query leaves the result uncached', async () => {
    const store = installStorageMock();
    searchMock.mockImplementation(async (params: URLSearchParams) => {
      if (params.get('navn') === 'rema 1000') throw new Error('offline');
      return [];
    });
    const result = await searchByHostnameDetailed('rema1000.no', 'REMA 1000');
    expect(result?.complete).toBe(false);
    expect(Object.keys(store).filter((k) => k.includes(':seg:'))).toEqual([]);
  });
});
