import { describe, expect, it } from 'vitest';

import { deriveVerdict, yearsSince } from '../src/lib/ui/verdict.js';
import type { Enhet, RegnskapResponse } from '../src/types/brreg.js';

// Fixed "today" so age math is deterministic.
const NOW = new Date('2026-07-04T12:00:00Z');

function makeEnhet(overrides: Partial<Enhet> = {}): Enhet {
  return {
    organisasjonsnummer: '984851006',
    navn: 'TESTSELSKAP AS',
    organisasjonsform: { kode: 'AS', beskrivelse: 'Aksjeselskap' },
    registreringsdatoEnhetsregisteret: '2002-09-12',
    antallAnsatte: 7536,
    ...overrides,
  };
}

function regnskapWithYear(year: string): RegnskapResponse {
  return {
    items: [{ regnskapsperiode: { tilDato: `${year}-12-31` } }],
  };
}

function signal(enhet: Enhet, regnskap: RegnskapResponse | undefined, key: string) {
  return deriveVerdict(enhet, regnskap, NOW).find((s) => s.key === key);
}

describe('yearsSince', () => {
  it('counts whole years', () => {
    expect(yearsSince('2002-09-12', NOW)).toBe(23);
  });

  it('does not count the year before the anniversary has passed', () => {
    // Registered 2002-09-12; on 2026-07-04 the 24th anniversary is
    // still ahead.
    expect(yearsSince('2002-07-05', NOW)).toBe(23);
    expect(yearsSince('2002-07-04', NOW)).toBe(24);
  });

  it('clamps future dates to 0 and rejects garbage', () => {
    expect(yearsSince('2027-01-01', NOW)).toBe(0);
    expect(yearsSince('not-a-date', NOW)).toBeUndefined();
    expect(yearsSince(undefined, NOW)).toBeUndefined();
  });
});

describe('deriveVerdict — status', () => {
  it('active company gets an ok status', () => {
    const s = signal(makeEnhet(), undefined, 'status');
    expect(s).toMatchObject({ value: 'Aktiv', tone: 'ok' });
  });

  it('konkurs wins as primary status', () => {
    const s = signal(makeEnhet({ konkurs: true }), undefined, 'status');
    expect(s).toMatchObject({ value: 'Konkurs', tone: 'danger' });
  });

  it('slettet beats a warn-level status', () => {
    const s = signal(
      makeEnhet({ slettedato: '2024-05-31', underAvvikling: true }),
      undefined,
      'status',
    );
    expect(s).toMatchObject({ value: 'Slettet', tone: 'danger' });
  });

  it('under avvikling alone is a warn', () => {
    const s = signal(makeEnhet({ underAvvikling: true }), undefined, 'status');
    expect(s).toMatchObject({ value: 'Under avvikling', tone: 'warn' });
  });
});

describe('deriveVerdict — alder', () => {
  it('renders whole years with the registration year as detail', () => {
    const s = signal(makeEnhet(), undefined, 'alder');
    expect(s).toMatchObject({
      value: '23 år',
      detail: 'reg. 2002',
      tone: 'neutral',
    });
  });

  it('flags a brand-new registration as warn', () => {
    const s = signal(
      makeEnhet({ registreringsdatoEnhetsregisteret: '2026-02-01' }),
      undefined,
      'alder',
    );
    expect(s).toMatchObject({ value: 'Under 1 år', tone: 'warn' });
  });

  it('is omitted when the registration date is missing', () => {
    const s = signal(
      makeEnhet({ registreringsdatoEnhetsregisteret: undefined }),
      undefined,
      'alder',
    );
    expect(s).toBeUndefined();
  });
});

describe('deriveVerdict — ansatte', () => {
  it('formats the count with nb-NO separators', () => {
    const s = signal(makeEnhet(), undefined, 'ansatte');
    expect(s?.value).toBe((7536).toLocaleString('nb-NO'));
    expect(s?.tone).toBe('neutral');
  });

  it('states "Ingen" for zero/missing without judging', () => {
    for (const antallAnsatte of [0, undefined]) {
      const s = signal(makeEnhet({ antallAnsatte }), undefined, 'ansatte');
      expect(s).toMatchObject({ value: 'Ingen', tone: 'neutral' });
    }
  });
});

describe('deriveVerdict — regnskap', () => {
  it('is omitted entirely when the fetch failed (undefined response)', () => {
    expect(signal(makeEnhet(), undefined, 'regnskap')).toBeUndefined();
  });

  it('shows the latest filed year as ok', () => {
    const s = signal(makeEnhet(), regnskapWithYear('2024'), 'regnskap');
    expect(s).toMatchObject({ value: '2024', detail: 'levert', tone: 'ok' });
  });

  it('picks the newest filing when several are returned unordered', () => {
    const regnskap: RegnskapResponse = {
      items: [
        { regnskapsperiode: { tilDato: '2022-12-31' } },
        { regnskapsperiode: { tilDato: '2024-12-31' } },
        { regnskapsperiode: { tilDato: '2023-12-31' } },
      ],
    };
    expect(signal(makeEnhet(), regnskap, 'regnskap')?.value).toBe('2024');
  });

  it('flags a filing older than two calendar years as stale', () => {
    const s = signal(makeEnhet(), regnskapWithYear('2022'), 'regnskap');
    expect(s).toMatchObject({
      value: '2022',
      detail: 'siste innsendte',
      tone: 'warn',
    });
  });

  it('treats an unsupported oppstillingsplan as a positive filing', () => {
    const s = signal(
      makeEnhet(),
      { items: [], unsupportedPlan: 'BANK' },
      'regnskap',
    );
    expect(s).toMatchObject({ value: 'Levert', tone: 'ok' });
  });

  it('warns when an old AS has nothing filed', () => {
    const s = signal(makeEnhet(), { items: [] }, 'regnskap');
    expect(s).toMatchObject({ value: 'Mangler', tone: 'warn' });
  });

  it('stays neutral for forms without an unconditional filing duty', () => {
    const s = signal(
      makeEnhet({
        organisasjonsform: {
          kode: 'ENK',
          beskrivelse: 'Enkeltpersonforetak',
        },
      }),
      { items: [] },
      'regnskap',
    );
    expect(s).toMatchObject({ value: 'Ingen', tone: 'neutral' });
  });

  it('gives a young AS grace before warning about missing regnskap', () => {
    const s = signal(
      makeEnhet({ registreringsdatoEnhetsregisteret: '2025-06-01' }),
      { items: [] },
      'regnskap',
    );
    expect(s).toMatchObject({ value: 'Ingen', tone: 'neutral' });
  });

  it('warns for filings without tilDato only via the missing-branch', () => {
    // Filings that can't be placed on a timeline are dropped by the
    // sorter, so this behaves like "nothing filed".
    const s = signal(makeEnhet(), { items: [{}] }, 'regnskap');
    expect(s).toMatchObject({ value: 'Mangler', tone: 'warn' });
  });
});

describe('deriveVerdict — composition', () => {
  it('keeps a stable signal order: status, alder, ansatte, regnskap', () => {
    const keys = deriveVerdict(
      makeEnhet(),
      regnskapWithYear('2024'),
      NOW,
    ).map((s) => s.key);
    expect(keys).toEqual(['status', 'alder', 'ansatte', 'regnskap']);
  });
});
