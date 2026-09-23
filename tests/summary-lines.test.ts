import { describe, expect, it } from 'vitest';

import {
  ansatteLine,
  avdelingNote,
  revenueLine,
} from '../src/lib/ui/summary-lines.js';
import type { Enhet, Regnskap, RegnskapResponse } from '../src/types/brreg.js';
import equinorEnhet from './fixtures/brreg/enhet-923609016-equinor.json';
import konkursEnhet from './fixtures/brreg/enhet-915330193-konkurs.json';
import slettetEnhet from './fixtures/brreg/enhet-989566733-slettet.json';
import smallEmployer from './fixtures/brreg/enhet-999999999-ansatte-1-4.json';
import regnskapEquinor from './fixtures/brreg/regnskap-923609016-usd.json';
import regnskapMowi from './fixtures/brreg/regnskap-964118191-eur.json';
import underenhetAlta from './fixtures/brreg/underenhet-973160834.json';

const items = (json: unknown) => json as Regnskap[];

describe('revenueLine (popup «Omsetning»)', () => {
  it('shows the latest driftsinntekter in the filing’s currency, with the year', () => {
    expect(revenueLine({ items: items(regnskapEquinor) })).toBe(
      '68,0 mrd USD (2025)',
    );
    expect(revenueLine({ items: items(regnskapMowi) })).toBe('1,9 mrd EUR (2025)');
  });

  it('labels a NOK filing «kr»', () => {
    const [filing] = items(regnskapEquinor);
    const nok = { ...filing!, valuta: 'NOK' };
    expect(revenueLine({ items: [nok] })).toBe('68,0 mrd kr (2025)');
  });

  it('picks the newest filing when brreg returns several', () => {
    const [filing] = items(regnskapEquinor);
    const older: Regnskap = {
      ...filing!,
      regnskapsperiode: { fraDato: '2024-01-01', tilDato: '2024-12-31' },
      resultatregnskapResultat: {
        driftsresultat: { driftsinntekter: { sumDriftsinntekter: 1 } },
      },
    };
    expect(revenueLine({ items: [older, filing!] })).toBe('68,0 mrd USD (2025)');
  });

  it.each<[string, RegnskapResponse | undefined]>([
    ['the fetch failed', undefined],
    ['the open API can’t serve it (bank, 500)', { items: [], unavailable: true }],
    ['nothing is filed', { items: [] }],
  ])('is omitted when %s', (_why, regnskap) => {
    expect(revenueLine(regnskap)).toBeUndefined();
  });

  it('is omitted when the filing has no driftsinntekter', () => {
    const [filing] = items(regnskapEquinor);
    const bare: Regnskap = { ...filing!, resultatregnskapResultat: {} };
    expect(revenueLine({ items: [bare] })).toBeUndefined();
  });
});

describe('ansatteLine (verdict cell and Oversikt «Antall ansatte»)', () => {
  it('formats a registered count', () => {
    expect(ansatteLine(equinorEnhet as Enhet)).toBe(
      equinorEnhet.antallAnsatte.toLocaleString('nb-NO'),
    );
  });

  it('reads a flagged employer without a count as 1–4, not none', () => {
    expect(ansatteLine(smallEmployer as Enhet)).toBe('1–4');
  });

  it('says «Ingen» only when the register does', () => {
    expect(ansatteLine(konkursEnhet as Enhet)).toBe('Ingen'); // flag false
    const zero: Enhet = { organisasjonsnummer: '923609016', navn: 'X', antallAnsatte: 0 };
    expect(ansatteLine(zero)).toBe('Ingen');
  });

  it('is omitted when the payload says nothing (deleted entity)', () => {
    expect(ansatteLine(slettetEnhet as Enhet)).toBeUndefined();
    const silent: Enhet = { organisasjonsnummer: '923609016', navn: 'X' };
    expect(ansatteLine(silent)).toBeUndefined();
  });
});

describe('avdelingNote', () => {
  it('names the branch and its orgnr', () => {
    expect(avdelingNote(underenhetAlta)).toBe(
      'Avdeling: DNB BANK ASA AVD ALTA (973160834)',
    );
  });
});
