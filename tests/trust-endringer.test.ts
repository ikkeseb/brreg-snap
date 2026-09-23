import { describe, expect, it } from 'vitest';

import { deriveEndringer, endringerSince } from '../src/lib/trust/endringer.js';
import type { Enhet, EnhetOppdatering, RollerResponse } from '../src/types/brreg.js';
import enkEnhet from './fixtures/brreg/enhet-999999998-enk.json';
import equinorEnhet from './fixtures/brreg/enhet-923609016-equinor.json';
import renamedEnhet from './fixtures/brreg/enhet-914375916-nytt-navn.json';
import slettetEnhet from './fixtures/brreg/enhet-989566733-slettet.json';
import feedEquinor from './fixtures/brreg/oppdateringer-923609016-equinor.json';
import feedRenamed from './fixtures/brreg/oppdateringer-914375916-nytt-navn.json';
import rollerEquinor from './fixtures/brreg/roller-923609016-equinor.json';
import rollerRenamed from './fixtures/brreg/roller-914375916-nytt-navn.json';

// Local noon, so calendar-day math is the same in every time zone.
const NOW = new Date(2026, 8, 24, 12);

const events = (page: { _embedded?: { oppdaterteEnheter?: unknown[] } }) =>
  (page._embedded?.oppdaterteEnheter ?? []) as EnhetOppdatering[];

const base: Enhet = {
  organisasjonsnummer: '910000000',
  navn: 'TEST AS',
  registreringsdatoEnhetsregisteret: '2010-01-01',
};

// A local date `days` before NOW, as YYYY-MM-DD.
function daysBefore(days: number): string {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - days);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n, i) => String(n).padStart(i === 0 ? 4 : 2, '0'))
    .join('-');
}

function roller(groups: Record<string, string>): RollerResponse {
  return {
    rollegrupper: Object.entries(groups).map(([kode, sistEndret]) => ({
      type: { kode },
      sistEndret,
      roller: [],
    })),
  };
}

// The feed stamps events in UTC; local noon of `date` keeps the
// calendar day the same in every time zone.
function stamp(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12).toISOString();
}

function addressEvent(date: string, ...paths: Array<[string, string]>): EnhetOppdatering {
  return {
    dato: stamp(date),
    endringstype: 'Endring',
    endringer: paths.map(([op, path]) => ({ op, path })),
  };
}

describe('deriveEndringer — live shapes', () => {
  it('renamed and moved, new board (live TOLLBUGATA 17 OSLO AS)', () => {
    expect(
      deriveEndringer({
        enhet: renamedEnhet,
        roller: rollerRenamed,
        feed: events(feedRenamed),
        now: NOW,
      }),
    ).toEqual([
      {
        kind: 'navn',
        date: '2026-09-01',
        text: 'Nytt navn 1. sep. 2026 (tidligere OPULENS NÆRING 4 AS)',
      },
      { kind: 'adresse', date: '2026-09-01', text: 'Ny forretningsadresse 1. sep. 2026' },
      { kind: 'styre', date: '2026-09-01', text: 'Styret endret 1. sep. 2026' },
    ]);
  });

  it('without the feed, keeps what the enhet and roller say', () => {
    const kinds = deriveEndringer({
      enhet: renamedEnhet,
      roller: rollerRenamed,
      feed: undefined,
      now: NOW,
    }).map((e) => e.kind);
    expect(kinds).toEqual(['navn', 'styre']);
  });

  it('without roller, keeps what the enhet and the feed say', () => {
    const kinds = deriveEndringer({
      enhet: renamedEnhet,
      roller: undefined,
      feed: events(feedRenamed),
      now: NOW,
    }).map((e) => e.kind);
    expect(kinds).toEqual(['navn', 'adresse']);
  });

  it('ignores the monthly antallAnsatte churn, kapital and regnskap (live Equinor)', () => {
    // Equinor's feed since March: 6 employee-count updates, a kapital
    // change and the 2025 regnskap. Its board changed 4 Sep 2026; its
    // last rename was 2018.
    expect(
      deriveEndringer({
        enhet: equinorEnhet,
        roller: rollerEquinor,
        feed: events(feedEquinor),
        now: NOW,
      }),
    ).toEqual([{ kind: 'styre', date: '2026-09-04', text: 'Styret endret 4. sep. 2026' }]);
  });

  it('dates an ENK rename from historiskeNavn (fictitious live shape)', () => {
    expect(
      deriveEndringer({ enhet: enkEnhet, roller: undefined, feed: undefined, now: NOW }),
    ).toEqual([
      { kind: 'navn', date: '2026-09-01', text: 'Nytt navn 1. sep. 2026 (tidligere KARI EKSEMPEL)' },
    ]);
  });

  it('is empty for a SlettetEnhet with no recent rename', () => {
    expect(
      deriveEndringer({ enhet: slettetEnhet, roller: undefined, feed: [], now: NOW }),
    ).toEqual([]);
  });
});

describe('deriveEndringer — windows', () => {
  it.each([
    [183, true],
    [184, false],
    [0, true],
  ])('a rename %i days ago is recent: %s', (days, recent) => {
    const out = deriveEndringer({
      enhet: {
        ...base,
        historiskeNavn: [{ navn: 'GAMMELT AS', tilDato: `${daysBefore(days)} 12:00:00` }],
      },
      roller: undefined,
      feed: undefined,
      now: NOW,
    });
    expect(out.length).toBe(recent ? 1 : 0);
  });

  it.each([
    [183, true],
    [184, false],
  ])('an address change %i days ago is recent: %s', (days, recent) => {
    const out = deriveEndringer({
      enhet: base,
      roller: undefined,
      feed: [addressEvent(daysBefore(days), ['replace', '/forretningsadresse/postnummer'])],
      now: NOW,
    });
    expect(out.length).toBe(recent ? 1 : 0);
  });

  it.each([
    ['DAGL', 90, 'Daglig leder endret'],
    ['STYR', 90, 'Styret endret'],
  ])('%s changed %i days ago counts, a day older does not', (group, days, text) => {
    const at = (d: number) =>
      deriveEndringer({
        enhet: base,
        roller: roller({ [group]: daysBefore(d) }),
        feed: undefined,
        now: NOW,
      });
    expect(at(days)[0]?.text).toMatch(new RegExp(`^${text} `));
    expect(at(days + 1)).toEqual([]);
  });

  it('reads only DAGL and STYR sistEndret (not REVI, REGN, BOBE)', () => {
    const recent = daysBefore(3);
    expect(
      deriveEndringer({
        enhet: base,
        roller: roller({ REVI: recent, REGN: recent, BOBE: recent }),
        feed: undefined,
        now: NOW,
      }),
    ).toEqual([]);
  });

  it('does not count the company being set up as a change', () => {
    const registered = daysBefore(20);
    const enhet: Enhet = { ...base, registreringsdatoEnhetsregisteret: registered };
    const setUp = deriveEndringer({
      enhet,
      roller: roller({ DAGL: registered, STYR: registered }),
      feed: undefined,
      now: NOW,
    });
    expect(setUp).toEqual([]);
    const later = deriveEndringer({
      enhet,
      roller: roller({ STYR: daysBefore(5) }),
      feed: undefined,
      now: NOW,
    });
    expect(later.map((e) => e.kind)).toEqual(['styre']);
  });
});

describe('deriveEndringer — what counts as a new address', () => {
  const at = (...paths: Array<[string, string]>) =>
    deriveEndringer({
      enhet: base,
      roller: undefined,
      feed: [addressEvent(daysBefore(10), ...paths)],
      now: NOW,
    }).map((e) => e.kind);

  it.each([
    [[['replace', '/forretningsadresse/adresse/0']]],
    [[['remove', '/forretningsadresse/adresse/1']]],
    [[['add', '/forretningsadresse/adresse/-']]],
    [[['replace', '/forretningsadresse/postnummer']]],
    [[['replace', '/forretningsadresse/poststed']]],
    [[['add', '/forretningsadresse']]],
  ] as Array<[Array<[string, string]>]>)('%j is a move', (paths) => {
    expect(at(...paths)).toEqual(['adresse']);
  });

  it.each([
    // A kommune renumbering alone.
    [[['replace', '/forretningsadresse/kommunenummer'], ['replace', '/forretningsadresse/kommune']]],
    // The deletion event removes the whole address.
    [[['remove', '/forretningsadresse']]],
    [[['replace', '/postadresse/adresse/0']]],
    [[['replace', '/antallAnsatte']]],
  ] as Array<[Array<[string, string]>]>)('%j is not', (paths) => {
    expect(at(...paths)).toEqual([]);
  });

  it('ignores events without changes (Ny, Sletting)', () => {
    expect(
      deriveEndringer({
        enhet: base,
        roller: undefined,
        feed: [{ dato: stamp(daysBefore(3)), endringstype: 'Ny' }],
        now: NOW,
      }),
    ).toEqual([]);
  });
});

describe('deriveEndringer — one per kind, newest first', () => {
  it('keeps the newest rename and the newest move', () => {
    const out = deriveEndringer({
      enhet: {
        ...base,
        historiskeNavn: [
          { navn: 'FØRST AS', tilDato: `${daysBefore(100)} 09:00:00` },
          { navn: 'SIST AS', tilDato: `${daysBefore(40)} 09:00:00` },
        ],
      },
      roller: roller({ DAGL: daysBefore(2) }),
      feed: [
        addressEvent(daysBefore(60), ['replace', '/forretningsadresse/postnummer']),
        addressEvent(daysBefore(30), ['replace', '/forretningsadresse/adresse/0']),
      ],
      now: NOW,
    });
    expect(out.map((e) => [e.kind, e.date])).toEqual([
      ['daglig-leder', daysBefore(2)],
      ['adresse', daysBefore(30)],
      ['navn', daysBefore(40)],
    ]);
    expect(out[2]!.text).toContain('(tidligere SIST AS)');
  });

  it('leaves out «tidligere» when the old name is missing', () => {
    const [e] = deriveEndringer({
      enhet: { ...base, historiskeNavn: [{ tilDato: `${daysBefore(1)} 09:00:00` }] },
      roller: undefined,
      feed: undefined,
      now: NOW,
    });
    expect(e?.text).toMatch(/^Nytt navn \d+\. \S+ 2026$/);
  });
});

describe('endringerSince', () => {
  it('is the start of the 183-day window as a full ISO timestamp', () => {
    const now = new Date('2026-09-24T12:00:00.000Z');
    expect(endringerSince(now)).toBe('2026-03-25T12:00:00.000Z');
  });
});
