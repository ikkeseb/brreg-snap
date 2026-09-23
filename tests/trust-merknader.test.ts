import { describe, expect, it } from 'vitest';

import { deriveMerknader, firstSentence } from '../src/lib/trust/merknader.js';
import type { Enhet } from '../src/types/brreg.js';
import equinorEnhet from './fixtures/brreg/enhet-923609016-equinor.json';
import paategningEnhet from './fixtures/brreg/enhet-935864879-paategning.json';
import slettetEnhet from './fixtures/brreg/enhet-989566733-slettet.json';

const base: Enhet = { organisasjonsnummer: '910000000', navn: 'TEST AS' };

describe('deriveMerknader', () => {
  it('quotes a live påtegning verbatim with its date and infotype (SCAN TRANSPORT AS)', () => {
    expect(deriveMerknader(paategningEnhet as Enhet)).toEqual([
      {
        text: 'Foretaksregisteret har grunn til å anta at forretningsadressen er feil. Foretaket har fått pålegg om å melde endring.',
        since: '2026-09-01',
        infotype: 'FADR',
      },
    ]);
  });

  it('is empty for a live company with paategninger: []', () => {
    expect((equinorEnhet as Enhet).paategninger).toEqual([]);
    expect(deriveMerknader(equinorEnhet as Enhet)).toEqual([]);
  });

  it('is empty when the field is absent (SlettetEnhet)', () => {
    expect(deriveMerknader(slettetEnhet as Enhet)).toEqual([]);
  });

  it('skips empty and whitespace-only texts', () => {
    expect(
      deriveMerknader({
        ...base,
        paategninger: [
          { infotype: 'NAVN', tekst: '', innfoertDato: '2026-01-01' },
          { infotype: 'NAVN', tekst: '   ', innfoertDato: '2026-01-02' },
          { infotype: 'FADR', innfoertDato: '2026-01-03' },
        ],
      }),
    ).toEqual([]);
  });

  it('trims the text (live: «… Pålegg om endring »)', () => {
    const [m] = deriveMerknader({
      ...base,
      paategninger: [
        {
          infotype: 'NAVN',
          tekst: 'Foretaksnavnet inneholder feil etternavn. Pålegg om endring ',
          innfoertDato: '2026-09-04',
        },
      ],
    });
    expect(m?.text).toBe('Foretaksnavnet inneholder feil etternavn. Pålegg om endring');
  });

  it('sorts newest first, undated and unparsable dates last', () => {
    const texts = deriveMerknader({
      ...base,
      paategninger: [
        { tekst: 'Eldst.', innfoertDato: '2024-05-08' },
        { tekst: 'Udatert.' },
        { tekst: 'Nyest.', innfoertDato: '2026-09-09' },
        { tekst: 'Ugyldig dato.', innfoertDato: 'i går' },
        { tekst: 'Midt.', innfoertDato: '2025-05-08' },
      ],
    }).map((m) => m.text);
    expect(texts).toEqual(['Nyest.', 'Midt.', 'Eldst.', 'Udatert.', 'Ugyldig dato.']);
  });

  it('leaves out since and infotype when brreg has none', () => {
    expect(deriveMerknader({ ...base, paategninger: [{ tekst: 'Tekst.' }] })).toEqual([
      { text: 'Tekst.' },
    ]);
  });
});

describe('firstSentence', () => {
  it.each([
    [
      'Foretaksregisteret har grunn til å anta at forretningsadressen er feil. Foretaket har fått pålegg om å melde endring.',
      'Foretaksregisteret har grunn til å anta at forretningsadressen er feil.',
    ],
    [
      'Kontaktperson mangler. Virksomheten har fått pålegg om å melde manglende rolle',
      'Kontaktperson mangler.',
    ],
    ['Én setning uten punktum', 'Én setning uten punktum'],
    ['Én setning.', 'Én setning.'],
    ['Oppløst pga. manglende regnskap. Mer tekst.', 'Oppløst pga. manglende regnskap.'],
    ['Står det noe? Ja.', 'Står det noe?'],
    ['  Luft rundt.  Øvrig.', 'Luft rundt.'],
  ])('%s', (text, expected) => {
    expect(firstSentence(text)).toBe(expected);
  });
});
