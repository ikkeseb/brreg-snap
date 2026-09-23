import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchAarsregnskapYears } from '../src/lib/aarsregnskap.js';
import { invalidateCache } from '../src/lib/brreg.js';
import {
  deriveKonsern,
  fetchKonsernstruktur,
  formatGrunnlag,
  konsernLine,
  type Konsern,
} from '../src/lib/konsern.js';
import type { KonsernNode } from '../src/types/brreg.js';
import akerTree from './fixtures/brreg/konsernstruktur-886581432-aker-trimmed.json';
import equinorTree from './fixtures/brreg/konsernstruktur-923609016-equinor.json';
import hydroTree from './fixtures/brreg/konsernstruktur-914778271-hydro-trimmed.json';
import telenorTree from './fixtures/brreg/konsernstruktur-982463718-telenor-trimmed.json';

const API = 'https://data.brreg.no/enhetsregisteret/api/konsernstruktur';
const NBSP = '\u00a0';

const equinor = equinorTree as KonsernNode;
const hydro = hydroTree as KonsernNode;
const aker = akerTree as KonsernNode;
const telenor = telenorTree as KonsernNode;

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

describe('fetchKonsernstruktur', () => {
  it('returns the whole group and caches it under the asked orgnr', async () => {
    // Live 2026-09-24: asking for the subsidiary 990888213 returns the
    // group rooted at EQUINOR ASA, byte-identical to asking for the top.
    const fetchMock = stubFetch(() => json(equinor));
    const tree = await fetchKonsernstruktur('990888213');
    expect(tree?.organisasjonsnummer).toBe('923609016');
    expect(fetchMock.mock.calls.map(([u]) => String(u))).toEqual([
      `${API}/990888213`,
    ]);

    const again = await fetchKonsernstruktur('990888213');
    expect(again?.organisasjonsnummer).toBe('923609016');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads a 404 as «not in a group» and caches that answer', async () => {
    // Live: STATKRAFT AS 987059699 (erIKonsern false) → 404, empty body.
    const fetchMock = stubFetch(() => new Response('', { status: 404 }));
    expect(await fetchKonsernstruktur('987059699')).toBeUndefined();
    expect(await fetchKonsernstruktur('987059699')).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store['konsern:987059699']).toBeDefined();
  });

  it('«Oppdater» (invalidateCache) drops the group and the year list too', async () => {
    const fetchMock = stubFetch(() => json(equinor));
    await fetchKonsernstruktur('923609016');
    fetchMock.mockImplementation(async () => json(['2025']));
    await fetchAarsregnskapYears('923609016');
    expect(Object.keys(store).sort()).toEqual([
      'aarsregnskap:923609016',
      'konsern:923609016',
    ]);
    await invalidateCache('923609016');
    expect(store).toEqual({});
  });

  it('reads a root without children as «not in a group»', async () => {
    stubFetch(() =>
      json({ organisasjonsnummer: '923609016', navn: 'EQUINOR ASA' }),
    );
    expect(await fetchKonsernstruktur('923609016')).toBeUndefined();
  });

  it('rejects on another status and caches nothing', async () => {
    // Live: an invalid orgnr (/konsernstruktur/123) answers 400.
    stubFetch(() => new Response('', { status: 503 }));
    await expect(fetchKonsernstruktur('923609016')).rejects.toThrow(/503/);
    expect(store).toEqual({});
  });

  it('rejects an unexpected shape', async () => {
    stubFetch(() => json([equinor]));
    await expect(fetchKonsernstruktur('923609016')).rejects.toThrow(/shape/);
    expect(store).toEqual({});
  });

  it('rejects a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('NetworkError');
      }),
    );
    await expect(fetchKonsernstruktur('923609016')).rejects.toThrow();
  });
});

describe('formatGrunnlag', () => {
  it('reads every stake format seen live', () => {
    expect(formatGrunnlag('100%')).toBe(`100${NBSP}%`);
    expect(formatGrunnlag('100 %')).toBe(`100${NBSP}%`);
    expect(formatGrunnlag('95,0%')).toBe(`95${NBSP}%`);
    expect(formatGrunnlag('95,00%')).toBe(`95${NBSP}%`);
    expect(formatGrunnlag('66,99%')).toBe(`66,99${NBSP}%`);
  });

  it('never rounds a partial stake up to full ownership', () => {
    expect(formatGrunnlag('99,99%')).toBe(`99,99${NBSP}%`);
  });

  it('gives nothing for text or a missing value', () => {
    expect(formatGrunnlag('Indirekte mor')).toBeUndefined();
    expect(formatGrunnlag(undefined)).toBeUndefined();
    expect(formatGrunnlag('')).toBeUndefined();
  });
});

describe('deriveKonsern — the top parent', () => {
  const k = deriveKonsern(equinor, '923609016')!;

  it('is the top, with itself as the whole path and no parent', () => {
    expect(k.role).toBe('top');
    expect(k.top).toEqual({ orgnr: '923609016', navn: 'EQUINOR ASA' });
    expect(k.parent).toBeUndefined();
    expect(k.path).toEqual([{ orgnr: '923609016', navn: 'EQUINOR ASA' }]);
  });

  it('counts every other company in the group', () => {
    // Live: 55 nodes, the top included.
    expect(k.groupSize).toBe(54);
  });

  it('lists only the direct children, by name, with their own child counts', () => {
    expect(k.children).toHaveLength(34);
    expect(k.children.slice(0, 2).map((c) => c.navn)).toEqual([
      'EQUINOR ALGERIA AS',
      'EQUINOR ANGOLA BLOCK 15 AS',
    ]);
    const energy = k.children.find((c) => c.orgnr === '990888213');
    expect(energy).toEqual({
      orgnr: '990888213',
      navn: 'EQUINOR ENERGY AS',
      grunnlag: `100${NBSP}%`,
      childCount: 10,
    });
  });

  it('says so in one line', () => {
    expect(konsernLine(k)).toBe('Morselskap i et konsern med 55 selskaper');
  });
});

describe('deriveKonsern — members', () => {
  it('a direct subsidiary: parent is the top', () => {
    const k = deriveKonsern(equinor, '990888213')!;
    expect(k.role).toBe('member');
    expect(k.parent).toEqual({
      orgnr: '923609016',
      navn: 'EQUINOR ASA',
      grunnlag: `100${NBSP}%`,
    });
    expect(k.path.map((p) => p.orgnr)).toEqual(['923609016', '990888213']);
    expect(k.groupSize).toBe(54);
    expect(k.children).toHaveLength(10);
    expect(
      k.children.find((c) => c.orgnr === '889094532')?.childCount,
    ).toBe(8);
    expect(konsernLine(k)).toBe(`Del av konsern: EQUINOR ASA (100${NBSP}%)`);
  });

  it('a member three levels down: full path, stake from its own parent', () => {
    // SAPA ALUMINIUM ARGENTINA S.A. under HYDRO EXTRUDED SOLUTIONS AS
    // under HYDRO ALUMINIUM AS (a mid-level «Konsern mor», stake written
    // «100 %») under Norsk Hydro ASA.
    const k = deriveKonsern(hydro, '913850602')!;
    expect(k.role).toBe('member');
    expect(k.top).toEqual({ orgnr: '914778271', navn: 'Norsk Hydro ASA' });
    expect(k.path.map((p) => p.navn)).toEqual([
      'Norsk Hydro ASA',
      'HYDRO ALUMINIUM AS',
      'HYDRO EXTRUDED SOLUTIONS AS',
      'SAPA ALUMINIUM ARGENTINA S.A.',
    ]);
    expect(k.parent).toEqual({
      orgnr: '899286952',
      navn: 'HYDRO EXTRUDED SOLUTIONS AS',
      grunnlag: `95${NBSP}%`,
    });
    expect(k.children).toEqual([]);
    expect(konsernLine(k)).toBe(
      `Del av konsern: Norsk Hydro ASA (via HYDRO EXTRUDED SOLUTIONS AS, 95${NBSP}%)`,
    );
  });

  it('a mid-level parent lists its own children', () => {
    const k = deriveKonsern(hydro, '917537534')!;
    expect(k.parent?.grunnlag).toBe(`100${NBSP}%`);
    expect(k.children.map((c) => [c.navn, c.childCount])).toEqual([
      ['HYCAST AS', 0],
      ['HYDRO EXTRUDED SOLUTIONS AS', 4],
    ]);
  });

  it('is undefined for an orgnr the tree does not hold', () => {
    expect(deriveKonsern(equinor, '984851006')).toBeUndefined();
  });

  it('is undefined for a tree that is only a root', () => {
    expect(
      deriveKonsern({ organisasjonsnummer: '923609016', navn: 'EQUINOR ASA' }, '923609016'),
    ).toBeUndefined();
  });
});

describe('deriveKonsern — a company listed under several parents', () => {
  // Live (Aker group, rooted at THE RESOURCE GROUP TRG AS): AKER ASA
  // sits under TRG HOLDING AS (KMOR 66,99%) and directly under the top
  // (KGRL 1,19%), with its whole subtree repeated under both.
  it('takes the controlling link as the parent, not the small stake', () => {
    const k = deriveKonsern(aker, '886581432')!;
    expect(k.parent).toEqual({
      orgnr: '981936248',
      navn: 'TRG HOLDING AS',
      grunnlag: `66,99${NBSP}%`,
    });
    expect(k.path.map((p) => p.navn)).toEqual([
      'THE RESOURCE GROUP TRG AS',
      'TRG HOLDING AS',
      'AKER ASA',
    ]);
  });

  it('counts each company once and does not repeat children', () => {
    const k = deriveKonsern(aker, '886581432')!;
    // 16 nodes in the trimmed tree, 9 distinct companies.
    expect(k.groupSize).toBe(8);
    expect(k.children.map((c) => c.navn)).toEqual([
      'AKER BIOMARINE ASA',
      'AKER HOLDING AS',
    ]);
  });

  it('prefers a controlling link over a larger-looking partial one', () => {
    // THE QRILL COMPANY AS: KDAT 60% under ANTARCTIC HARVESTING HOLDING
    // AS, KGRL 40% under AKER BIOMARINE ASA.
    const k = deriveKonsern(aker, '988354139')!;
    expect(k.parent?.navn).toBe('ANTARCTIC HARVESTING HOLDING AS');
    expect(k.parent?.grunnlag).toBe(`60${NBSP}%`);
    expect(k.path.map((p) => p.orgnr)).toEqual([
      '881653192',
      '914386632',
      '988354139',
    ]);
  });

  it('builds the path from the chosen parents, whatever order brreg lists them in', () => {
    // AKER HOLDING AS appears under both copies of AKER ASA. Move the
    // top's direct (KGRL) copy of AKER ASA first: the path must still
    // go through TRG HOLDING AS, AKER ASA's chosen parent.
    const reordered: KonsernNode = {
      ...aker,
      children: [...(aker.children ?? [])].reverse(),
    };
    for (const tree of [aker, reordered]) {
      const k = deriveKonsern(tree, '991368965')!;
      expect(k.path.map((p) => p.navn)).toEqual([
        'THE RESOURCE GROUP TRG AS',
        'TRG HOLDING AS',
        'AKER ASA',
        'AKER HOLDING AS',
      ]);
      expect(k.parent?.grunnlag).toBe(`70${NBSP}%`);
    }
  });

  it('keeps a text-only link («Indirekte mor») without a stake', () => {
    // Live (Telenor): BJØRVIKA IKT AS is KGRL 33,33% under TELENOR NORGE
    // AS and KMOR «Indirekte mor» directly under TELENOR ASA.
    const k = deriveKonsern(telenor, '990440212')!;
    expect(k.parent).toEqual({ orgnr: '982463718', navn: 'TELENOR ASA' });
    expect(k.path.map((p) => p.navn)).toEqual(['TELENOR ASA', 'BJØRVIKA IKT AS']);
    expect(konsernLine(k)).toBe('Del av konsern: TELENOR ASA');
    // TELENOR NORGE AS still lists it, with its partial stake.
    const norge = deriveKonsern(telenor, '976967631')!;
    expect(norge.children.map((c) => [c.navn, c.grunnlag])).toEqual([
      ['BJØRVIKA IKT AS', `33,33${NBSP}%`],
      ['TALKMORE AS', `100${NBSP}%`],
    ]);
  });
});

describe('deriveKonsern — robustness', () => {
  it('handles a group of thousands in one pass', () => {
    // Live, the largest group seen was 250 companies (NorgesGruppen,
    // rooted at JOH JOHANNSON HANDEL AS). Build a far bigger one.
    const leaves = (prefix: string, n: number): KonsernNode[] =>
      Array.from({ length: n }, (_, i) => ({
        organisasjonsnummer: `${prefix}${String(i).padStart(4, '0')}`,
        navn: `SELSKAP ${prefix}${i}`,
        grunnlag: '100%',
      }));
    const tree: KonsernNode = {
      organisasjonsnummer: '900000000',
      navn: 'TOPP AS',
      children: Array.from({ length: 50 }, (_, i) => ({
        organisasjonsnummer: `8000000${String(i).padStart(2, '0')}`,
        navn: `HOLDING ${i} AS`,
        grunnlag: '100%',
        children: leaves(`7${String(i).padStart(2, '0')}0`, 100),
      })),
    };
    const k = deriveKonsern(tree, '900000000')!;
    expect(k.groupSize).toBe(50 + 50 * 100);
    expect(k.children).toHaveLength(50);
    expect(k.children.every((c) => c.childCount === 100)).toBe(true);
    const leaf = deriveKonsern(tree, '74900099')!;
    expect(leaf.path.map((p) => p.navn)).toEqual([
      'TOPP AS',
      'HOLDING 49 AS',
      'SELSKAP 749099',
    ]);
  });

  it('skips malformed nodes instead of failing', () => {
    const tree = {
      organisasjonsnummer: '900000000',
      navn: 'TOPP AS',
      children: [
        null,
        { navn: 'NO ORGNR AS' },
        { organisasjonsnummer: '800000000', navn: 'DATTER AS', grunnlag: '100%' },
      ],
    } as unknown as KonsernNode;
    const k = deriveKonsern(tree, '900000000')!;
    expect(k.groupSize).toBe(1);
    expect(k.children.map((c) => c.navn)).toEqual(['DATTER AS']);
  });
});

describe('konsernLine', () => {
  const base: Konsern = {
    role: 'member',
    top: { orgnr: '923609016', navn: 'EQUINOR ASA' },
    path: [],
    children: [],
    groupSize: 54,
  };

  it('prints the stake only when the parent is known', () => {
    expect(konsernLine(base)).toBe('Del av konsern: EQUINOR ASA');
    expect(
      konsernLine({
        ...base,
        parent: { orgnr: '990888213', navn: 'EQUINOR ENERGY AS' },
      }),
    ).toBe('Del av konsern: EQUINOR ASA (via EQUINOR ENERGY AS)');
  });

  it('groups thousands the Norwegian way', () => {
    expect(konsernLine({ ...base, role: 'top', groupSize: 1499 })).toBe(
      `Morselskap i et konsern med 1${NBSP}500 selskaper`,
    );
  });
});
