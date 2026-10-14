import { describe, expect, it } from 'vitest';

import { formatAmountsIn } from '../src/lib/format.js';
import { trendRead } from '../src/lib/view/trend.js';

const YEARS = ['2023', '2024', '2025'];
// Points over 2023… (or 2024–2025 for two values); null = no figure.
const pts = (...values: Array<number | null>) => {
  const years = values.length === 2 ? YEARS.slice(1) : YEARS;
  return values.map((value, i) => (value === null ? undefined : { year: years[i]!, value }));
};
const resultat = (...values: Array<number | null>) => trendRead('Årsresultat', pts(...values), true);
const inntekter = (...values: Array<number | null>) => trendRead('Driftsinntekter', pts(...values), false);
const pct = (n: number) => `${n}\u00a0%`;

describe('trendRead — first to last', () => {
  it('a percentage from a positive first year; under 1 % is «omtrent uendret»; equal is «uendret»', () => {
    expect(inntekter(100, 137)).toBe(`Driftsinntekter opp ${pct(37)}.`);
    expect(inntekter(100, 49)).toBe(`Driftsinntekter ned ${pct(51)}.`);
    expect(inntekter(1000, 1004)).toBe('Driftsinntekter omtrent uendret.');
    expect(inntekter(500, 500)).toBe('Driftsinntekter uendret.');
    expect(inntekter(100, 0)).toBe(`Driftsinntekter ned ${pct(100)}.`);
  });

  it('first value 0 or negative: the direction only, never a percentage', () => {
    expect(inntekter(0, 50)).toBe('Driftsinntekter opp.');
    expect(inntekter(0, 0)).toBe('Driftsinntekter uendret.');
    expect(inntekter(-20, 50)).toBe('Driftsinntekter opp.');
    expect(inntekter(50, -20)).toBe('Driftsinntekter ned.');
  });

  it('1000 % or more: the bare direction, a tiny base carries no percentage (1 → 2 → 1 000 000 000)', () => {
    expect(inntekter(1, 2, 1_000_000_000)).toBe('Driftsinntekter opp.');
    expect(inntekter(100, 1099)).toBe(`Driftsinntekter opp ${pct(999)}.`);
    expect(inntekter(100, 1100)).toBe('Driftsinntekter opp.');
  });

  it('a missing end year: no sentence (the heading names a period the figure does not cover)', () => {
    expect(resultat(100, 200, null)).toBeUndefined();
    expect(resultat(null, 200, 300)).toBeUndefined();
    // A missing middle year does not move the period.
    expect(resultat(100, null, 300)).toBe(`Årsresultat opp ${pct(200)}.`);
  });
});

describe('trendRead — a middle year outside the ends is named', () => {
  it('a peak or a dip beyond a tenth of the larger end', () => {
    expect(inntekter(477, 678, 355)).toBe(`Driftsinntekter ned ${pct(26)}, høyest i 2024.`);
    expect(inntekter(100, 10, 100.5)).toBe('Driftsinntekter omtrent uendret, lavest i 2024.');
  });

  it('noise inside the bar stays out (Equinor 72,4 → 72,5 → 68,0)', () => {
    expect(inntekter(72.4, 72.5, 68.0)).toBe(`Driftsinntekter ned ${pct(6)}.`);
  });
});

describe('trendRead — a loss is never hidden', () => {
  it('profits at both ends, a loss between (24FITNESS)', () => {
    expect(resultat(768, -476, 860)).toBe(`Årsresultat opp ${pct(12)}, men underskudd i 2024.`);
  });

  it('one clean change of sign names the year it landed', () => {
    expect(resultat(-476, 860)).toBe('Årsresultat snudde fra underskudd til overskudd i 2025.');
    expect(resultat(500, -10)).toBe('Årsresultat snudde fra overskudd til underskudd i 2025.');
    expect(resultat(-1, -2, 5)).toBe('Årsresultat snudde fra underskudd til overskudd i 2025.');
    expect(resultat(5, -1, -2)).toBe('Årsresultat snudde fra overskudd til underskudd i 2024.');
  });

  it('a turn across a missing year names no year: it may have come a year earlier', () => {
    expect(resultat(-5, null, 3)).toBe('Årsresultat snudde fra underskudd til overskudd.');
    expect(resultat(5, null, -3)).toBe('Årsresultat snudde fra overskudd til underskudd.');
    // Held years that are not back to back (brreg skipped one): same.
    const gap = [
      { year: '2021', value: -5 },
      { year: '2023', value: 3 },
    ];
    expect(trendRead('Årsresultat', gap, true)).toBe('Årsresultat snudde fra underskudd til overskudd.');
    // A missing year after the turn does not hide it: 2024 follows 2023.
    expect(resultat(-5, 3, null)).toBeUndefined();
    expect(trendRead('Årsresultat', [{ year: '2023', value: -5 }, { year: '2024', value: 3 }, undefined, { year: '2026', value: 4 }], true)).toBe(
      'Årsresultat snudde fra underskudd til overskudd i 2024.',
    );
  });

  it('every year a loss: the size compared, equal values before bigger/smaller', () => {
    expect(resultat(-100_000, -100_000)).toBe('Årsresultat i underskudd begge år, like stort.');
    expect(resultat(-100_000, -100_500)).toBe('Årsresultat i underskudd begge år, omtrent like stort.');
    expect(resultat(-100, -300)).toBe('Årsresultat i underskudd begge år, større sist.');
    expect(resultat(-300, -100)).toBe('Årsresultat i underskudd begge år, mindre sist.');
    expect(resultat(-3, -2, -1)).toBe('Årsresultat i underskudd alle år, mindre sist.');
    expect(resultat(-1, -10, -2)).toBe('Årsresultat i underskudd alle år, størst i 2024.');
  });

  it('anything else lists the loss years', () => {
    expect(resultat(-5, 3, -2)).toBe('Årsresultat: underskudd i 2023 og 2025.');
    expect(resultat(0, -5)).toBe('Årsresultat: underskudd i 2025.');
    expect(resultat(-5, null, -2)).toBe('Årsresultat: underskudd i 2023 og 2025.');
  });

  it('a zero end with a loss between reads as the moved figure plus the loss', () => {
    expect(resultat(0, -5, 3)).toBe('Årsresultat opp, men underskudd i 2024.');
  });
});

describe('formatAmountsIn — one magnitude word per row', () => {
  it('takes the unit of the largest value and writes every value in it', () => {
    expect(formatAmountsIn([31_124_422, 36_300_000, 42_599_757])).toEqual({
      unit: 'mill',
      amounts: [{ amount: '31,1' }, { amount: '36,3' }, { amount: '42,6' }],
    });
    expect(formatAmountsIn([768_000, -475_672, 860_445])).toEqual({
      unit: 'tusen',
      amounts: [{ amount: '768' }, { amount: '-476' }, { amount: '860' }],
    });
    expect(formatAmountsIn([900_000, 1_200_000])).toEqual({ unit: 'mill', amounts: [{ amount: '0,9' }, { amount: '1,2' }] });
  });

  it('a non-zero value that rounds to zero in the unit reads «<0,1», sign kept, marked small', () => {
    // 1, 2 and 1 000 000 000: short cells, never «0,000000001».
    expect(formatAmountsIn([1, 2, 1_000_000_000])).toEqual({
      unit: 'mrd',
      amounts: [{ amount: '<0,1', small: true }, { amount: '<0,1', small: true }, { amount: '1,0' }],
    });
    expect(formatAmountsIn([-40_000, 2_000_000, undefined, 0])).toEqual({
      unit: 'mill',
      amounts: [{ amount: '-<0,1', small: true }, { amount: '2,0' }, undefined, { amount: '0,0' }],
    });
    // A whole-number unit: «<1».
    expect(formatAmountsIn([300, 500_000])).toEqual({ unit: 'tusen', amounts: [{ amount: '<1', small: true }, { amount: '500' }] });
  });

  it('plain kroner and missing values', () => {
    expect(formatAmountsIn([500, -20])).toEqual({ unit: '', amounts: [{ amount: '500' }, { amount: '-20' }] });
    expect(formatAmountsIn([undefined, undefined])).toEqual({ unit: '', amounts: [undefined, undefined] });
  });
});
