import { describe, expect, it } from 'vitest';

import {
  EGENKAPITALANDEL_WARN_BELOW,
  egenkapitalandelTone,
  isConsecutiveYear,
  keyFigures,
  sortRegnskapDesc,
  yoyDelta,
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

describe('sortRegnskapDesc', () => {
  it('sorts by tilDato descending (most recent first)', () => {
    const items = [
      filing('2022-12-31'),
      filing('2024-12-31'),
      filing('2023-12-31'),
    ];
    expect(sortRegnskapDesc(items).map((r) => r.regnskapsperiode?.tilDato)).toEqual(
      ['2024-12-31', '2023-12-31', '2022-12-31'],
    );
  });

  it('drops filings with no tilDato (cannot place on the timeline)', () => {
    const items = [filing('2023-12-31'), filing(undefined)];
    expect(sortRegnskapDesc(items)).toHaveLength(1);
  });

  it('returns empty for an empty input', () => {
    expect(sortRegnskapDesc([])).toEqual([]);
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

describe('yoyDelta', () => {
  it('reports growth as a positive percent and an up direction', () => {
    expect(yoyDelta(110, 100)).toEqual({ pct: 10, direction: 'up' });
  });

  it('reports a decline as a negative percent and a down direction', () => {
    expect(yoyDelta(90, 100)).toEqual({ pct: -10, direction: 'down' });
  });

  it('reports no change as flat', () => {
    expect(yoyDelta(100, 100)).toEqual({ pct: 0, direction: 'flat' });
  });

  it('still reports direction when the figure swings negative', () => {
    // prior is positive so the % is honest, even though current is a loss.
    expect(yoyDelta(-50, 100)).toEqual({ pct: -150, direction: 'down' });
  });

  it('declines a zero base (no div-by-zero)', () => {
    expect(yoyDelta(50, 0)).toBeUndefined();
  });

  it('declines a negative base (a % off a loss would mislead)', () => {
    expect(yoyDelta(-50, -100)).toBeUndefined();
  });

  it('declines when either figure is missing', () => {
    expect(yoyDelta(undefined, 100)).toBeUndefined();
    expect(yoyDelta(100, undefined)).toBeUndefined();
  });

  it('declines non-finite inputs', () => {
    expect(yoyDelta(Number.NaN, 100)).toBeUndefined();
    expect(yoyDelta(Number.POSITIVE_INFINITY, 100)).toBeUndefined();
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

describe('isConsecutiveYear', () => {
  const yr = (y: string | undefined) =>
    keyFigures(filing(y ? `${y}-12-31` : undefined));

  it('is true when the prior filing is exactly one year earlier', () => {
    expect(isConsecutiveYear(yr('2024'), yr('2023'))).toBe(true);
  });

  it('is false across a multi-year gap', () => {
    expect(isConsecutiveYear(yr('2024'), yr('2022'))).toBe(false);
  });

  it('is false for two filings ending in the same year', () => {
    expect(isConsecutiveYear(yr('2024'), yr('2024'))).toBe(false);
  });

  it('is false when a year is missing (no tilDato)', () => {
    expect(isConsecutiveYear(yr('2024'), yr(undefined))).toBe(false);
    expect(isConsecutiveYear(yr(undefined), yr('2023'))).toBe(false);
  });
});
