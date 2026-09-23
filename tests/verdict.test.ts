import { describe, expect, it } from 'vitest';

import { deriveVerdict, yearsSince } from '../src/lib/ui/verdict.js';
import type { Enhet, RegnskapResponse } from '../src/types/brreg.js';
import dnbEnhet from './fixtures/brreg/enhet-984851006-dnb.json';
import equinorEnhet from './fixtures/brreg/enhet-923609016-equinor.json';
import konkursEnhet from './fixtures/brreg/enhet-915330193-konkurs.json';
import slettetEnhet from './fixtures/brreg/enhet-989566733-slettet.json';
import smallEmployer from './fixtures/brreg/enhet-999999999-ansatte-1-4.json';
import tvangEnhet from './fixtures/brreg/enhet-931744682-tvangsopplost.json';

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

  it('an active company carries no status detail', () => {
    expect(signal(makeEnhet(), undefined, 'status')?.detail).toBeUndefined();
  });

  it('says since when for a konkurs (live 1VASK AS)', () => {
    const s = signal(konkursEnhet as Enhet, undefined, 'status');
    expect(s).toMatchObject({
      value: 'Konkurs',
      detail: 'siden 26.08.2026',
      tone: 'danger',
    });
  });

  it('says why for a forced dissolution (live 1779 HOLDING AS)', () => {
    const s = signal(tvangEnhet as Enhet, undefined, 'status');
    expect(s).toMatchObject({
      value: 'Tvangsavvikling',
      detail: 'mangler regnskap',
    });
  });

  it('dates a deletion (live SlettetEnhet)', () => {
    const s = signal(slettetEnhet as Enhet, undefined, 'status');
    expect(s).toMatchObject({ value: 'Slettet', detail: '15.09.2026' });
  });

  it('turns the other green cells neutral under a danger status', () => {
    const signals = deriveVerdict(
      konkursEnhet as Enhet,
      regnskapWithYear('2025'),
      NOW,
    );
    expect(signals.find((s) => s.key === 'regnskap')?.tone).toBe('neutral');
    expect(signals.find((s) => s.key === 'status')?.tone).toBe('danger');
  });
});

describe('deriveVerdict — alder', () => {
  it('counts from stiftelsesdato, not the 1995 register floor (live Equinor)', () => {
    const s = signal(equinorEnhet as Enhet, undefined, 'alder');
    // Founded 1972-09-18; on 2026-07-04 that is 53 whole years.
    expect(s).toMatchObject({ value: '53 år', detail: 'stiftet 1972' });
  });

  it('falls back to the earliest registration date', () => {
    const s = signal(
      makeEnhet({
        registreringsdatoEnhetsregisteret: '1995-03-12',
        registreringsdatoForetaksregisteret: '1988-04-28',
      }),
      undefined,
      'alder',
    );
    expect(s).toMatchObject({ value: '38 år', detail: 'reg. 1988' });
  });

  it('flags a brand-new company as warn, labelled by its founding year', () => {
    const s = signal(
      makeEnhet({
        stiftelsesdato: '2026-01-15',
        registreringsdatoEnhetsregisteret: '2026-02-01',
      }),
      undefined,
      'alder',
    );
    expect(s).toMatchObject({
      value: 'Under 1 år',
      detail: 'stiftet 2026',
      tone: 'warn',
    });
  });

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

  it('states "Ingen" when the register says none, without judging', () => {
    for (const enhet of [
      makeEnhet({ antallAnsatte: 0 }),
      makeEnhet({ antallAnsatte: undefined, harRegistrertAntallAnsatte: false }),
      konkursEnhet as Enhet, // live: harRegistrertAntallAnsatte false
    ]) {
      const s = signal(enhet, undefined, 'ansatte');
      expect(s).toMatchObject({ value: 'Ingen', tone: 'neutral' });
    }
  });

  it('says «1–4» when the register flags employees but gives no count', () => {
    // Live shape: brreg drops antallAnsatte below five employees and
    // keeps harRegistrertAntallAnsatte true. This used to read «Ingen».
    const s = signal(smallEmployer as Enhet, undefined, 'ansatte');
    expect(smallEmployer).not.toHaveProperty('antallAnsatte');
    expect(s).toEqual({
      key: 'ansatte',
      label: 'Ansatte',
      value: '1–4',
      detail: 'registrert',
      tone: 'neutral',
    });
  });

  it('is omitted for a deleted entity, which carries no employee data', () => {
    expect(signal(slettetEnhet as Enhet, undefined, 'ansatte')).toBeUndefined();
  });

  it('is omitted when the payload says nothing about employees', () => {
    const s = signal(makeEnhet({ antallAnsatte: undefined }), undefined, 'ansatte');
    expect(s).toBeUndefined();
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

  it('treats a 500 that names the plan as a positive filing', () => {
    const s = signal(
      makeEnhet(),
      { items: [], unavailable: true, unsupportedPlan: 'BANK' },
      'regnskap',
    );
    expect(s).toMatchObject({ value: 'Levert', tone: 'ok' });
  });

  it('takes the year from the Enhet when the regnskap endpoint 500s (DNB)', () => {
    // Live shapes: DNB's enhet says 2025, its regnskap call answers 500.
    const dnb: Enhet = dnbEnhet;
    const s = signal(dnb, { items: [], unavailable: true }, 'regnskap');
    expect(s).toMatchObject({ value: '2025', detail: 'levert', tone: 'ok' });
  });

  it('keeps the Enhet year when the regnskap fetch failed outright', () => {
    const s = signal(
      makeEnhet({ sisteInnsendteAarsregnskap: '2025' }),
      undefined,
      'regnskap',
    );
    expect(s).toMatchObject({ value: '2025', tone: 'ok' });
  });

  it('prefers the newer of the Enhet year and the regnskap filing', () => {
    // KOMPLETT ASA: enhet 2025, regnskap API still on 2024.
    expect(
      signal(
        makeEnhet({ sisteInnsendteAarsregnskap: '2025' }),
        regnskapWithYear('2024'),
        'regnskap',
      )?.value,
    ).toBe('2025');
    expect(
      signal(
        makeEnhet({ sisteInnsendteAarsregnskap: '2023' }),
        regnskapWithYear('2024'),
        'regnskap',
      )?.value,
    ).toBe('2024');
  });

  it('ignores a malformed Enhet year', () => {
    const s = signal(
      makeEnhet({ sisteInnsendteAarsregnskap: 'ukjent' }),
      undefined,
      'regnskap',
    );
    expect(s).toBeUndefined();
  });

  it('omits the signal for a bare 500 with nothing else to go on', () => {
    const s = signal(makeEnhet(), { items: [], unavailable: true }, 'regnskap');
    expect(s).toBeUndefined();
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
