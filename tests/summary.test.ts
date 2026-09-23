// «Kopier sammendrag» and the orgnr copy formats, against recorded
// live shapes (tests/fixtures/brreg). The answer, signals and kobling
// are written out in the trust vocabulary (src/lib/trust/types.ts) —
// their derivations are tested where they live; this pins the text.

import { describe, expect, it } from 'vitest';

import {
  brregUrl,
  buildSummary,
  formatFetchedAt,
  orgnrFormats,
  type SummaryInput,
} from '../src/lib/trust/summary.js';
import type { Answer, Kobling, Signal } from '../src/lib/trust/types.js';
import type { Enhet, RollerResponse } from '../src/types/brreg.js';
import konkursJson from './fixtures/brreg/enhet-915330193-konkurs.json';
import equinorJson from './fixtures/brreg/enhet-923609016-equinor.json';
import nufJson from './fixtures/brreg/enhet-999288774-nuf-utenlandsk.json';
import konkursRollerJson from './fixtures/brreg/roller-915330193-konkurs.json';
import equinorRollerJson from './fixtures/brreg/roller-923609016-equinor.json';

const equinor = equinorJson as Enhet;
const konkurs = konkursJson as Enhet;
const nuf = nufJson as Enhet;
const equinorRoller = equinorRollerJson as RollerResponse;
const konkursRoller = konkursRollerJson as RollerResponse;

// Local time, so the expected «kl.» is the same in every time zone.
const FETCHED = new Date(2026, 8, 24, 14, 5).getTime();
const SOURCE = 'Kilde: Brønnøysundregistrene (NLOD 2.0), hentet 24.09.2026 kl. 14.05';

const OK: Answer = { tone: 'ok', headline: 'Ingen varsler i registeret', findings: [] };

const EQUINOR_SIGNALS: Signal[] = [
  { key: 'status', label: 'Status', value: 'Aktiv', tone: 'ok' },
  { key: 'alder', label: 'Alder', value: '54 år', detail: 'stiftet 1972', tone: 'neutral' },
  { key: 'ansatte', label: 'Ansatte', value: '21 272', tone: 'neutral' },
  { key: 'regnskap', label: 'Regnskap', value: '2025 levert', tone: 'ok' },
];

function input(overrides: Partial<SummaryInput> = {}): SummaryInput {
  return {
    enhet: equinor,
    answer: OK,
    signals: EQUINOR_SIGNALS,
    roller: equinorRoller,
    fetchedAt: FETCHED,
    ...overrides,
  };
}

describe('buildSummary', () => {
  it('writes the due-diligence snippet, one fact per line', () => {
    expect(buildSummary(input())).toBe(
      [
        'EQUINOR ASA (org.nr 923 609 016)',
        'Ingen varsler i registeret',
        'Status: Aktiv · Alder: 54 år (stiftet 1972) · Ansatte: 21 272 · Regnskap: 2025 levert',
        // Fixture names are fictional (tests/fixtures/brreg/README.md).
        'Daglig leder: Kari Nordmann · Styreleder: Ola Nordmann',
        SOURCE,
        'https://virksomhet.brreg.no/nb/oppslag/enheter/923609016',
      ].join('\n'),
    );
  });

  it('carries the tone in words, and the supporting line under the headline', () => {
    const answer: Answer = {
      tone: 'danger',
      headline: 'Konkurs siden 26. aug. 2026',
      supporting: 'Bostyrer: Adv. Ola Nordmann',
      findings: [{ tone: 'danger', source: 'status', text: 'Konkurs siden 26. aug. 2026' }],
    };
    const lines = buildSummary(
      input({
        enhet: konkurs,
        answer,
        signals: [
          { key: 'status', label: 'Status', value: 'Konkurs', detail: 'siden 26.08.2026', tone: 'danger' },
        ],
        roller: konkursRoller,
      }),
    ).split('\n');
    expect(lines.slice(0, 5)).toEqual([
      '1VASK AS (org.nr 915 330 193)',
      'Advarsel: Konkurs siden 26. aug. 2026',
      'Bostyrer: Adv. Ola Nordmann',
      'Status: Konkurs (siden 26.08.2026)',
      'Daglig leder: Lars Moe · Styreleder: Kari Nordmann',
    ]);
  });

  it('lists every finding when the headline only counts them', () => {
    const answer: Answer = {
      tone: 'danger',
      headline: '2 ting å merke seg',
      findings: [
        { tone: 'danger', source: 'kobling', text: 'Usikker kobling til bbc.co.uk' },
        { tone: 'warn', source: 'alder', text: 'Under 1 år gammel' },
      ],
    };
    const lines = buildSummary(input({ answer })).split('\n');
    expect(lines.slice(1, 4)).toEqual([
      'Advarsel: 2 ting å merke seg',
      '– Advarsel: Usikker kobling til bbc.co.uk',
      '– Obs: Under 1 år gammel',
    ]);
  });

  it('gives the kobling its own line, naming the site — never in the fact row', () => {
    const kobling: Kobling = {
      key: 'kobling',
      kind: 'registered',
      label: 'Kobling',
      value: 'Registrert nettsted',
      tone: 'ok',
      host: 'www.equinor.com',
      registeredDomain: 'equinor.com',
    };
    const lines = buildSummary(
      input({ kobling, signals: [kobling, ...EQUINOR_SIGNALS] }),
    ).split('\n');
    expect(lines[2]).toBe(
      'Status: Aktiv · Alder: 54 år (stiftet 1972) · Ansatte: 21 272 · Regnskap: 2025 levert',
    );
    expect(lines).toContain('Kobling (www.equinor.com): Registrert nettsted');
  });

  it('leaves out what couldn’t be fetched instead of claiming «Ingen»', () => {
    // roller undefined = the fetch failed; no signals = nothing derived.
    const text = buildSummary(input({ roller: undefined, signals: [] }));
    expect(text).toBe(
      [
        'EQUINOR ASA (org.nr 923 609 016)',
        'Ingen varsler i registeret',
        SOURCE,
        'https://virksomhet.brreg.no/nb/oppslag/enheter/923609016',
      ].join('\n'),
    );
  });

  it('skips a role nobody currently holds', () => {
    // Only a resigned board chair: no «Styreleder» line part.
    const roller: RollerResponse = {
      rollegrupper: [
        {
          type: { kode: 'STYR' },
          roller: [
            {
              type: { kode: 'LEDE' },
              person: { navn: { fornavn: 'Per', etternavn: 'Hansen' } },
              avregistrert: true,
            },
          ],
        },
      ],
    } as RollerResponse;
    expect(buildSummary(input({ roller }))).not.toMatch(/Styreleder|Daglig leder/);
  });
});

describe('formatFetchedAt / brregUrl', () => {
  it('formats the fetch time as dd.mm.yyyy kl. hh.mm, local', () => {
    expect(formatFetchedAt(new Date(2026, 0, 5, 9, 3).getTime())).toBe('05.01.2026 kl. 09.03');
  });

  it('links the company page on virksomhet.brreg.no', () => {
    expect(brregUrl('923609016')).toBe('https://virksomhet.brreg.no/nb/oppslag/enheter/923609016');
  });
});

describe('orgnrFormats', () => {
  it('a VAT-registered company gets digits, spaced, the MVA form and an invoice block', () => {
    expect(orgnrFormats(equinor)).toEqual({
      digits: '923609016',
      spaced: '923 609 016',
      mva: 'NO 923 609 016 MVA',
      invoiceBlock: ['EQUINOR ASA', 'Org.nr. 923 609 016', 'Forusbeen 50', '4035 STAVANGER'].join(
        '\n',
      ),
    });
  });

  it('no MVA form for a company outside Merverdiavgiftsregisteret', () => {
    const formats = orgnrFormats(konkurs);
    expect(konkurs.registrertIMvaregisteret).toBe(false);
    expect(formats).not.toHaveProperty('mva');
    expect(formats.invoiceBlock).toBe(
      ['1VASK AS', 'Org.nr. 915 330 193', 'Eksempelveien 1', '6887 LÆRDAL'].join('\n'),
    );
  });

  it('a foreign forretningsadresse (NUF) keeps its postcode in poststed and names the country', () => {
    // Live shape: no postnummer, «DE-92711 Parkstein» as poststed.
    expect(orgnrFormats(nuf)).toEqual({
      digits: '999288774',
      spaced: '999 288 774',
      mva: 'NO 999 288 774 MVA',
      invoiceBlock: [
        'WIOSS WITRON ON SITE SERVICES GMBH NUF',
        'Org.nr. 999 288 774',
        'Neustädter 17',
        'DE-92711 Parkstein',
        'Tyskland',
      ].join('\n'),
    });
  });

  it('no address lines when brreg has no forretningsadresse', () => {
    const bare: Enhet = { organisasjonsnummer: '923609016', navn: 'EQUINOR ASA' };
    expect(orgnrFormats(bare).invoiceBlock).toBe('EQUINOR ASA\nOrg.nr. 923 609 016');
  });
});
