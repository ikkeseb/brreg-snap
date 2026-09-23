import { describe, expect, it, vi } from 'vitest';

import type { Adresse, Kode } from '../src/types/brreg.js';
import {
  formatAddress,
  formatDateNo,
  formatDateNumeric,
  formatMoney,
  formatMoneyCompact,
  formatNaering,
  formatPercent,
  formatRelativeTime,
  parseIsoDate,
} from '../src/lib/format.js';
import { keyFigures } from '../src/lib/regnskap.js';
import type { Regnskap } from '../src/types/brreg.js';
import equinorRegnskap from './fixtures/brreg/regnskap-923609016-usd.json';
import mowiRegnskap from './fixtures/brreg/regnskap-964118191-eur.json';

// Characterization tests — these lock in the CURRENT behavior of the
// pure formatting helpers ahead of the Chrome port. They assert the
// exact nb-NO ICU output produced by the host runtime. Note that the
// nb-NO thousands grouping separator is U+00A0 (non-breaking space),
// while the gap before a unit suffix ("mrd kr") is a plain ASCII space
// from the source template literal.
const NBSP = ' ';

describe('formatMoney (NOK / no valuta)', () => {
  describe('nullish / NaN inputs return undefined', () => {
    it('undefined', () => {
      expect(formatMoney(undefined)).toBeUndefined();
    });

    it('null (cast through — runtime guard catches it)', () => {
      expect(formatMoney(null as unknown as number)).toBeUndefined();
    });

    it('NaN', () => {
      expect(formatMoney(Number.NaN)).toBeUndefined();
    });
  });

  describe('mrd (>= 1e9) bucket, 1 fraction digit', () => {
    it('37 877 000 000 -> "37,9 mrd kr" (rounds half-up at one decimal)', () => {
      expect(formatMoney(37_877_000_000)).toBe('37,9 mrd kr');
    });

    it('exactly 1e9 -> "1,0 mrd kr" (lower boundary, inclusive)', () => {
      expect(formatMoney(1e9)).toBe('1,0 mrd kr');
    });
  });

  describe('mill (>= 1e6, < 1e9) bucket, 1 fraction digit', () => {
    it('5 500 000 -> "5,5 mill kr"', () => {
      expect(formatMoney(5_500_000)).toBe('5,5 mill kr');
    });

    it('exactly 1e6 -> "1,0 mill kr" (lower boundary, inclusive)', () => {
      expect(formatMoney(1e6)).toBe('1,0 mill kr');
    });

    it('999 999 999 -> "1,0 mrd kr" (rounding carries into the next unit)', () => {
      // Just under the mrd threshold, but it rounds to 1000,0 mill —
      // which must be shown as the next unit, not "1 000,0 mill kr".
      expect(formatMoney(999_999_999)).toBe('1,0 mrd kr');
      expect(formatMoney(999_950_000)).toBe('1,0 mrd kr');
    });

    it('999 940 000 -> "999,9 mill kr" (does not carry when it rounds down)', () => {
      expect(formatMoney(999_940_000)).toBe(`999,9 mill kr`);
    });
  });

  describe('tusen (>= 1e3, < 1e6) bucket, 0 fraction digits', () => {
    it('12 345 -> "12 tusen kr" (integer division display, truncates via rounding to 12)', () => {
      expect(formatMoney(12_345)).toBe('12 tusen kr');
    });

    it('exactly 1e3 -> "1 tusen kr" (lower boundary, inclusive)', () => {
      expect(formatMoney(1e3)).toBe('1 tusen kr');
    });

    it('999 500 -> "1,0 mill kr" (rounding carries into the next unit)', () => {
      expect(formatMoney(999_500)).toBe('1,0 mill kr');
      expect(formatMoney(999_999)).toBe('1,0 mill kr');
    });

    it('999 499 -> "999 tusen kr" (does not carry when it rounds down)', () => {
      expect(formatMoney(999_499)).toBe('999 tusen kr');
    });
  });

  describe('plain kr (< 1e3) bucket, 0 fraction digits', () => {
    it('999 -> "999 kr" (upper edge of plain bucket)', () => {
      expect(formatMoney(999)).toBe('999 kr');
    });

    it('500 -> "500 kr"', () => {
      expect(formatMoney(500)).toBe('500 kr');
    });

    it('0 -> "0 kr" (zero is NOT undefined; falls through to plain bucket)', () => {
      expect(formatMoney(0)).toBe('0 kr');
    });
  });

  describe('negative values carry a leading "-" via the sign prefix', () => {
    it('-250 -> "-250 kr"', () => {
      expect(formatMoney(-250)).toBe('-250 kr');
    });

    it('-1e9 -> "-1,0 mrd kr"', () => {
      expect(formatMoney(-1e9)).toBe('-1,0 mrd kr');
    });

    it('-5 500 000 -> "-5,5 mill kr"', () => {
      expect(formatMoney(-5_500_000)).toBe('-5,5 mill kr');
    });
  });
});

describe('formatRelativeTime', () => {
  // Fixed "now": 2026-06-01 14:32:00 local time. All assertions pass an
  // explicit `now` to avoid depending on wall-clock.
  const now = new Date(2026, 5, 1, 14, 32, 0, 0).getTime();

  it('diff < 45s -> "akkurat nå"', () => {
    expect(formatRelativeTime(now - 10_000, now)).toBe('akkurat nå');
  });

  it('diff exactly 0 -> "akkurat nå"', () => {
    expect(formatRelativeTime(now, now)).toBe('akkurat nå');
  });

  it('diff 44s (rounds to 44s, < 45) -> "akkurat nå"', () => {
    expect(formatRelativeTime(now - 44_000, now)).toBe('akkurat nå');
  });

  it('diff 45s -> "for 1 min siden" (45s rounds to 1 min via Math.round)', () => {
    // diffSec = 45 (>= 45 so not "akkurat nå"); diffMin = round(45/60) = 1.
    expect(formatRelativeTime(now - 45_000, now)).toBe('for 1 min siden');
  });

  it('diff ~3 min -> "for 3 min siden"', () => {
    expect(formatRelativeTime(now - 3 * 60_000, now)).toBe('for 3 min siden');
  });

  it('diff 59 min -> "for 59 min siden" (upper edge of minute bucket)', () => {
    expect(formatRelativeTime(now - 59 * 60_000, now)).toBe(
      'for 59 min siden',
    );
  });

  it('diff 60 min -> falls through to "i dag kl ..." (diffMin not < 60)', () => {
    expect(formatRelativeTime(now - 60 * 60_000, now)).toBe('i dag kl 13:32');
  });

  it('same calendar day, several hours earlier -> "i dag kl HH:MM"', () => {
    const then = new Date(2026, 5, 1, 9, 5, 0, 0).getTime();
    expect(formatRelativeTime(then, now)).toBe('i dag kl 09:05');
  });

  it('yesterday -> "i går kl HH:MM"', () => {
    const then = new Date(2026, 4, 31, 22, 15, 0, 0).getTime();
    expect(formatRelativeTime(then, now)).toBe('i går kl 22:15');
  });

  it('older than yesterday -> full date "DD. mon YYYY"', () => {
    const then = new Date(2026, 4, 20, 8, 0, 0, 0).getTime();
    // Host ICU renders nb-NO short month lowercase with a trailing-dot day.
    expect(formatRelativeTime(then, now)).toBe('20. mai 2026');
  });

  it('a future-ish timestamp (within 45s ahead) still maps to "akkurat nå"', () => {
    // diffMs negative, diffSec negative, negative < 45 -> "akkurat nå".
    expect(formatRelativeTime(now + 5_000, now)).toBe('akkurat nå');
  });

  it('defaults `now` to Date.now() when omitted', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 5, 1, 14, 32, 0, 0));
      expect(formatRelativeTime(Date.now() - 3 * 60_000)).toBe(
        'for 3 min siden',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('formatAddress', () => {
  function addr(partial: Partial<Adresse>): Adresse {
    return partial as Adresse;
  }

  it('undefined input -> undefined', () => {
    expect(formatAddress(undefined)).toBeUndefined();
  });

  it('empty object -> undefined (no lines survive the filter)', () => {
    expect(formatAddress(addr({}))).toBeUndefined();
  });

  it('full address: street lines + postnr/poststed + land, joined by ", "', () => {
    expect(
      formatAddress(
        addr({
          adresse: ['Karl Johans gate 1'],
          postnummer: '0154',
          poststed: 'OSLO',
          land: 'Norge',
        }),
      ),
    ).toBe('Karl Johans gate 1, 0154 OSLO, Norge');
  });

  it('multiple street lines are preserved in order', () => {
    expect(
      formatAddress(
        addr({
          adresse: ['Postboks 123', 'Sentrum'],
          postnummer: '0101',
          poststed: 'OSLO',
        }),
      ),
    ).toBe('Postboks 123, Sentrum, 0101 OSLO');
  });

  it('postnummer only (no poststed) -> "0154" line with no trailing space', () => {
    expect(formatAddress(addr({ postnummer: '0154' }))).toBe('0154');
  });

  it('poststed only (no postnummer) -> "OSLO" line', () => {
    expect(formatAddress(addr({ poststed: 'OSLO' }))).toBe('OSLO');
  });

  it('postnummer + poststed combine with a single space', () => {
    expect(formatAddress(addr({ postnummer: '0154', poststed: 'OSLO' }))).toBe(
      '0154 OSLO',
    );
  });

  it('land only -> just the country', () => {
    expect(formatAddress(addr({ land: 'Norge' }))).toBe('Norge');
  });

  it('street lines only -> joined without any postal/country segment', () => {
    expect(formatAddress(addr({ adresse: ['Storgata 5'] }))).toBe('Storgata 5');
  });

  it('empty adresse array contributes no lines', () => {
    expect(formatAddress(addr({ adresse: [], poststed: 'BERGEN' }))).toBe(
      'BERGEN',
    );
  });

  it('whitespace-only fields are dropped by the trim() filter', () => {
    // adresse entry "   " is whitespace-only -> filtered out. poststed
    // survives, postnummer empty so the postal segment is just "BERGEN".
    expect(
      formatAddress(
        addr({ adresse: ['   '], postnummer: '', poststed: 'BERGEN' }),
      ),
    ).toBe('BERGEN');
  });

  it('all whitespace-only -> undefined', () => {
    expect(
      formatAddress(addr({ adresse: ['  '], postnummer: '  ', land: '   ' })),
    ).toBeUndefined();
  });
});

describe('formatNaering', () => {
  const kode = (k: string, b?: string): Kode => ({ kode: k, beskrivelse: b });

  it('pairs description with code', () => {
    expect(formatNaering(kode('62.020', 'Konsulentvirksomhet'))).toBe(
      'Konsulentvirksomhet (62.020)',
    );
  });

  it('falls back to description only when code is blank', () => {
    expect(formatNaering(kode('', 'Konsulentvirksomhet'))).toBe(
      'Konsulentvirksomhet',
    );
  });

  it('falls back to bare code when no description', () => {
    expect(formatNaering(kode('62.020'))).toBe('62.020');
  });

  it('returns undefined for undefined input', () => {
    expect(formatNaering(undefined)).toBeUndefined();
  });
});

const EQUINOR_USD: Regnskap[] = equinorRegnskap;
const MOWI_EUR: Regnskap[] = mowiRegnskap;

describe('formatMoney with a foreign valuta', () => {
  // Live shapes: Equinor files in USD, Mowi in EUR. Printing "kr" here
  // understated Equinor's revenue roughly tenfold.
  it('labels Equinor (USD) figures with the currency code, not kr', () => {
    const f = keyFigures(EQUINOR_USD[0]!);
    expect(f.valuta).toBe('USD');
    expect(formatMoney(f.driftsinntekter, f.valuta)).toBe('68,0 mrd USD');
    expect(formatMoney(f.aarsresultat, f.valuta)).toBe('5,7 mrd USD');
  });

  it('labels Mowi (EUR) figures with EUR', () => {
    const f = keyFigures(MOWI_EUR[0]!);
    expect(f.valuta).toBe('EUR');
    expect(formatMoney(f.driftsinntekter, f.valuta)).toBe('1,9 mrd EUR');
  });

  it('prints kr for NOK in any case, and for a missing valuta', () => {
    expect(formatMoney(5_500_000, 'NOK')).toBe('5,5 mill kr');
    expect(formatMoney(5_500_000, 'nok')).toBe('5,5 mill kr');
    expect(formatMoney(5_500_000, undefined)).toBe('5,5 mill kr');
  });

  it('keeps the sign and small amounts', () => {
    expect(formatMoney(-250, 'EUR')).toBe('-250 EUR');
  });
});

describe('formatMoneyCompact', () => {
  it('drops the " kr" suffix but keeps the magnitude word', () => {
    expect(formatMoneyCompact(37_877_000_000)).toBe('37,9 mrd');
    expect(formatMoneyCompact(5_200_000, 'NOK')).toBe('5,2 mill');
    expect(formatMoneyCompact(850_000)).toBe('850 tusen');
  });

  it('keeps a foreign currency code — dropping it would read as kroner', () => {
    expect(formatMoneyCompact(67_956_000_000, 'USD')).toBe('68,0 mrd USD');
  });

  it('keeps the sign on losses', () => {
    expect(formatMoneyCompact(-1_200_000_000)).toBe('-1,2 mrd');
  });

  it('returns undefined for nullish / NaN', () => {
    expect(formatMoneyCompact(undefined)).toBeUndefined();
    expect(formatMoneyCompact(Number.NaN, 'USD')).toBeUndefined();
  });
});

describe('parseIsoDate / formatDateNo', () => {
  // A date-only string must be the same calendar day in every time
  // zone. new Date('2002-09-12') is UTC midnight — the 11th west of UTC.
  // (Vitest workers can't switch TZ at runtime, so this pins the
  // local-midnight contract rather than simulating New York.)
  it('reads a date-only string as local midnight', () => {
    expect(parseIsoDate('2002-09-12')).toEqual(new Date(2002, 8, 12));
    expect(formatDateNo('2002-09-12')).toBe('12. sep. 2002');
  });

  it('rejects impossible dates instead of rolling them over', () => {
    expect(parseIsoDate('2002-13-45')).toBeUndefined();
    expect(parseIsoDate('2026-02-30')).toBeUndefined();
    expect(formatDateNo('not-a-date')).toBeUndefined();
    expect(formatDateNo(undefined)).toBeUndefined();
  });

  it('formats the compact numeric form for verdict cells', () => {
    expect(formatDateNumeric('2026-08-26')).toBe('26.08.2026');
    expect(formatDateNumeric('2026-01-04')).toBe('04.01.2026');
    expect(formatDateNumeric('garbage')).toBeUndefined();
  });

  it('still parses full timestamps', () => {
    expect(parseIsoDate('2026-09-23T12:00:00Z')?.getTime()).toBe(
      Date.UTC(2026, 8, 23, 12),
    );
  });
});

describe('formatPercent', () => {
  it('rounds to a whole percent with a non-breaking space', () => {
    expect(formatPercent(42.4)).toBe(`42${NBSP}%`);
    expect(formatPercent(42.6)).toBe(`43${NBSP}%`);
  });

  it('handles negative (insolvent) shares', () => {
    expect(formatPercent(-25)).toBe(`-25${NBSP}%`);
  });

  it('returns undefined for nullish / NaN', () => {
    expect(formatPercent(undefined)).toBeUndefined();
    expect(formatPercent(null as unknown as number)).toBeUndefined();
    expect(formatPercent(Number.NaN)).toBeUndefined();
  });
});
