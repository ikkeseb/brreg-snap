import { describe, expect, it } from 'vitest';

import { keyFigures, sortRegnskapDesc } from '../src/lib/regnskap.js';
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
