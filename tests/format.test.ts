import { describe, expect, it, vi } from 'vitest';

import type { Adresse } from '../src/types/brreg.js';
import {
  formatAddress,
  formatNok,
  formatRelativeTime,
} from '../src/lib/format.js';

// Characterization tests — these lock in the CURRENT behavior of the
// pure formatting helpers ahead of the Chrome port. They assert the
// exact nb-NO ICU output produced by the host runtime. Note that the
// nb-NO thousands grouping separator is U+00A0 (non-breaking space),
// while the gap before a unit suffix ("mrd kr") is a plain ASCII space
// from the source template literal.
const NBSP = ' ';

describe('formatNok', () => {
  describe('nullish / NaN inputs return undefined', () => {
    it('undefined', () => {
      expect(formatNok(undefined)).toBeUndefined();
    });

    it('null (cast through — runtime guard catches it)', () => {
      expect(formatNok(null as unknown as number)).toBeUndefined();
    });

    it('NaN', () => {
      expect(formatNok(Number.NaN)).toBeUndefined();
    });
  });

  describe('mrd (>= 1e9) bucket, 1 fraction digit', () => {
    it('37 877 000 000 -> "37,9 mrd kr" (rounds half-up at one decimal)', () => {
      expect(formatNok(37_877_000_000)).toBe('37,9 mrd kr');
    });

    it('exactly 1e9 -> "1,0 mrd kr" (lower boundary, inclusive)', () => {
      expect(formatNok(1e9)).toBe('1,0 mrd kr');
    });
  });

  describe('mill (>= 1e6, < 1e9) bucket, 1 fraction digit', () => {
    it('5 500 000 -> "5,5 mill kr"', () => {
      expect(formatNok(5_500_000)).toBe('5,5 mill kr');
    });

    it('exactly 1e6 -> "1,0 mill kr" (lower boundary, inclusive)', () => {
      expect(formatNok(1e6)).toBe('1,0 mill kr');
    });

    it('999 999 999 -> "1' + NBSP + '000,0 mill kr" (below 1e9, rounds up across grouping)', () => {
      // Surprising boundary: just under the mrd threshold so it stays in
      // the mill bucket, yet rounds to 1000,0 with an NBSP group sep.
      expect(formatNok(999_999_999)).toBe(`1${NBSP}000,0 mill kr`);
    });
  });

  describe('tusen (>= 1e3, < 1e6) bucket, 0 fraction digits', () => {
    it('12 345 -> "12 tusen kr" (integer division display, truncates via rounding to 12)', () => {
      expect(formatNok(12_345)).toBe('12 tusen kr');
    });

    it('exactly 1e3 -> "1 tusen kr" (lower boundary, inclusive)', () => {
      expect(formatNok(1e3)).toBe('1 tusen kr');
    });

    it('999 999 -> "1' + NBSP + '000 tusen kr" (below 1e6, rounds up across grouping)', () => {
      expect(formatNok(999_999)).toBe(`1${NBSP}000 tusen kr`);
    });
  });

  describe('plain kr (< 1e3) bucket, 0 fraction digits', () => {
    it('999 -> "999 kr" (upper edge of plain bucket)', () => {
      expect(formatNok(999)).toBe('999 kr');
    });

    it('500 -> "500 kr"', () => {
      expect(formatNok(500)).toBe('500 kr');
    });

    it('0 -> "0 kr" (zero is NOT undefined; falls through to plain bucket)', () => {
      expect(formatNok(0)).toBe('0 kr');
    });
  });

  describe('negative values carry a leading "-" via the sign prefix', () => {
    it('-250 -> "-250 kr"', () => {
      expect(formatNok(-250)).toBe('-250 kr');
    });

    it('-1e9 -> "-1,0 mrd kr"', () => {
      expect(formatNok(-1e9)).toBe('-1,0 mrd kr');
    });

    it('-5 500 000 -> "-5,5 mill kr"', () => {
      expect(formatNok(-5_500_000)).toBe('-5,5 mill kr');
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
