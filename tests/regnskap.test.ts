import { describe, expect, it } from 'vitest';

import {
  EGENKAPITALANDEL_WARN_BELOW,
  egenkapitalandelTone,
  keyFigures,
  latestRegnskap,
  regnskapGap,
} from '../src/lib/regnskap.js';
import type { Regnskap } from '../src/types/brreg.js';

function filing(
  tilDato: string | undefined,
  opts: {
    driftsinntekter?: number;
    driftsresultat?: number;
    resultatFoerSkatt?: number;
    aarsresultat?: number;
    egenkapital?: number;
    sumEgenkapitalGjeld?: number;
  } = {},
): Regnskap {
  return {
    regnskapsperiode: tilDato ? { tilDato } : undefined,
    resultatregnskapResultat: {
      driftsresultat: {
        driftsresultat: opts.driftsresultat,
        driftsinntekter: { sumDriftsinntekter: opts.driftsinntekter },
      },
      ordinaertResultatFoerSkattekostnad: opts.resultatFoerSkatt,
      aarsresultat: opts.aarsresultat,
    },
    egenkapitalGjeld: {
      sumEgenkapitalGjeld: opts.sumEgenkapitalGjeld,
      egenkapital: { sumEgenkapital: opts.egenkapital },
    },
  };
}

function typed(tilDato: string | undefined, regnskapstype: string, driftsinntekter: number): Regnskap {
  return { ...filing(tilDato, { driftsinntekter }), regnskapstype };
}

describe('latestRegnskap', () => {
  it('picks the most recent tilDato whatever the order', () => {
    const items = [
      filing('2022-12-31'),
      filing('2024-12-31'),
      filing('2023-12-31'),
    ];
    expect(latestRegnskap(items)?.regnskapsperiode?.tilDato).toBe('2024-12-31');
  });

  // The live shape for a parent (Telenor ASA, 2026-10): the group's
  // consolidated rows come first, then the company's own, three years
  // each. The group's 81 bn must never be shown as the company's 678 m.
  it("picks the company's own accounts, never the group's consolidated ones", () => {
    const items = [
      typed('2022-12-31', 'KONSERN', 100_957_000_000),
      typed('2023-12-31', 'KONSERN', 80_537_000_000),
      typed('2024-12-31', 'KONSERN', 81_413_000_000),
      typed('2022-12-31', 'SELSKAP', 871_000_000),
      typed('2023-12-31', 'SELSKAP', 477_000_000),
      typed('2024-12-31', 'SELSKAP', 678_000_000),
    ];
    const latest = latestRegnskap(items);
    expect(latest?.regnskapstype).toBe('SELSKAP');
    expect(keyFigures(latest!).driftsinntekter).toBe(678_000_000);
    expect(keyFigures(latestRegnskap([...items].reverse())!).driftsinntekter).toBe(678_000_000);
  });

  it('skips a consolidated filing even when it is the newest row', () => {
    const items = [
      typed('2025-12-31', 'KONSERN', 9),
      typed('2024-12-31', 'SELSKAP', 1),
    ];
    expect(latestRegnskap(items)?.regnskapsperiode?.tilDato).toBe('2024-12-31');
  });

  it('has no answer when only consolidated accounts came back', () => {
    expect(latestRegnskap([typed('2024-12-31', 'KONSERN', 9)])).toBeUndefined();
  });

  it('skips filings with no tilDato (cannot place on the timeline)', () => {
    const items = [filing(undefined), filing('2023-12-31'), filing(undefined)];
    expect(latestRegnskap(items)?.regnskapsperiode?.tilDato).toBe('2023-12-31');
    expect(latestRegnskap([filing(undefined)])).toBeUndefined();
  });

  it('reads the type whatever its case or padding', () => {
    const items = [typed('2024-12-31', ' konsern ', 9), typed('2024-12-31', 'selskap', 1)];
    expect(keyFigures(latestRegnskap(items)!).driftsinntekter).toBe(1);
  });

  it('skips rows whose tilDato is not an ISO date, before or after a valid one', () => {
    const bad = (tilDato: unknown) =>
      ({ regnskapsperiode: { tilDato } }) as unknown as Regnskap;
    const good = filing('2023-12-31');
    expect(latestRegnskap([bad(2025), bad('zzzz'), good, bad(2026), bad('i fjor')])).toBe(good);
    expect(latestRegnskap([bad(2025)])).toBeUndefined();
  });

  it('returns undefined for an empty input', () => {
    expect(latestRegnskap([])).toBeUndefined();
  });
});

describe('keyFigures', () => {
  it('extracts the headline figures and the year', () => {
    const f = keyFigures(
      filing('2024-12-31', {
        driftsinntekter: 1000,
        driftsresultat: 200,
        resultatFoerSkatt: 180,
        aarsresultat: 140,
        egenkapital: 600,
        sumEgenkapitalGjeld: 1000,
      }),
    );
    expect(f.year).toBe('2024');
    expect(f.driftsinntekter).toBe(1000);
    expect(f.aarsresultat).toBe(140);
  });

  it('derives gjeld = sumEgenkapitalGjeld − egenkapital', () => {
    const f = keyFigures(
      filing('2024-12-31', { egenkapital: 600, sumEgenkapitalGjeld: 1000 }),
    );
    expect(f.gjeld).toBe(400);
  });

  it('derives egenkapitalandel as a percentage', () => {
    const f = keyFigures(
      filing('2024-12-31', { egenkapital: 600, sumEgenkapitalGjeld: 1000 }),
    );
    expect(f.egenkapitalandel).toBeCloseTo(60);
  });

  it('returns negative egenkapitalandel for insolvent equity', () => {
    const f = keyFigures(
      filing('2024-12-31', { egenkapital: -200, sumEgenkapitalGjeld: 800 }),
    );
    expect(f.egenkapitalandel).toBeCloseTo(-25);
    expect(f.gjeld).toBe(1000);
  });

  it('guards against a zero balance total (no div-by-zero)', () => {
    const f = keyFigures(
      filing('2024-12-31', { egenkapital: 0, sumEgenkapitalGjeld: 0 }),
    );
    expect(f.egenkapitalandel).toBeUndefined();
    expect(f.gjeld).toBe(0);
  });

  it('leaves gjeld and andel undefined when balance fields are missing', () => {
    const f = keyFigures(filing('2024-12-31', { aarsresultat: 10 }));
    expect(f.gjeld).toBeUndefined();
    expect(f.egenkapitalandel).toBeUndefined();
  });

  it('handles a missing tilDato with an empty year', () => {
    const f = keyFigures(filing(undefined, { aarsresultat: 5 }));
    expect(f.year).toBe('');
    expect(f.tilDato).toBe('');
  });
});


describe('egenkapitalandelTone', () => {
  it('flags thin-but-positive equity as warn', () => {
    expect(egenkapitalandelTone(10)).toBe('warn');
    expect(egenkapitalandelTone(0)).toBe('warn');
    expect(egenkapitalandelTone(EGENKAPITALANDEL_WARN_BELOW - 0.1)).toBe('warn');
  });

  it('leaves healthy equity untoned (no full green/amber rubric)', () => {
    expect(egenkapitalandelTone(EGENKAPITALANDEL_WARN_BELOW)).toBeUndefined();
    expect(egenkapitalandelTone(40)).toBeUndefined();
  });

  it('leaves negative equity to the red sign path', () => {
    expect(egenkapitalandelTone(-5)).toBeUndefined();
  });

  it('declines missing or non-finite input', () => {
    expect(egenkapitalandelTone(undefined)).toBeUndefined();
    expect(egenkapitalandelTone(Number.NaN)).toBeUndefined();
  });
});

describe('regnskapGap', () => {
  it('explains banks (NACE 64.1x) and insurers (65.x) as special accounts', () => {
    // Live NACE codes of DNB, SpareBank 1 SMN, Storebrand Liv, Gjensidige.
    for (const kode of ['64.190', '64.110', '65.110', '65.120', '65.300']) {
      expect(regnskapGap(kode)).toBe('special-accounts');
    }
  });

  it('calls anything else a plain API error', () => {
    expect(regnskapGap('64.210')).toBe('api-error'); // holding, not a bank
    expect(regnskapGap('06.100')).toBe('api-error');
    expect(regnskapGap(undefined)).toBe('api-error');
  });

  it('trusts a plan code from the 500 body over the NACE code', () => {
    expect(regnskapGap('06.100', 'BANK')).toBe('special-accounts');
  });
});
