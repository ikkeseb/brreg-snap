import { describe, expect, it } from 'vitest';
import { findDagligLeder, findRoleHolder } from '../src/lib/roller.js';
import type { RollerResponse } from '../src/types/brreg.js';

// Fixture is a trimmed real response from
// data.brreg.no/enhetsregisteret/api/enheter/984851006/roller (DNB).
// Shape match is the contract this helper depends on — if Brreg ever
// renames `rollegrupper`, `type.kode`, or `person.navn.*`, this test
// fails before the UI silently drops "Daglig leder".
const DNB_ROLLER: RollerResponse = {
  rollegrupper: [
    {
      type: { kode: 'DAGL', beskrivelse: 'Daglig leder' },
      sistEndret: '2019-09-05',
      roller: [
        {
          type: { kode: 'DAGL', beskrivelse: 'Daglig leder' },
          person: {
            navn: {
              fornavn: 'Kjerstin Elisabeth',
              mellomnavn: 'Rasmussen',
              etternavn: 'Braathen',
            },
          },
          fratraadt: false,
        },
      ],
    },
    {
      type: { kode: 'STYR', beskrivelse: 'Styre' },
      roller: [
        {
          type: { kode: 'LEDE', beskrivelse: 'Styrets leder' },
          person: { navn: { fornavn: 'Eimund', etternavn: 'Nygaard' } },
          fratraadt: false,
        },
      ],
    },
  ],
};

describe('findDagligLeder', () => {
  it('extracts active daglig leder from a real-shaped response', () => {
    expect(findDagligLeder(DNB_ROLLER)).toBe(
      'Kjerstin Elisabeth Rasmussen Braathen',
    );
  });

  it('returns undefined when no DAGL group is present', () => {
    const onlyStyre: RollerResponse = {
      rollegrupper: [DNB_ROLLER.rollegrupper![1]!],
    };
    expect(findDagligLeder(onlyStyre)).toBeUndefined();
  });

  it('returns undefined when daglig leder has fratraadt', () => {
    const fratraadt: RollerResponse = {
      rollegrupper: [
        {
          type: { kode: 'DAGL', beskrivelse: 'Daglig leder' },
          roller: [
            {
              type: { kode: 'DAGL', beskrivelse: 'Daglig leder' },
              person: { navn: { fornavn: 'Olaf', etternavn: 'Hansen' } },
              fratraadt: true,
            },
          ],
        },
      ],
    };
    expect(findDagligLeder(fratraadt)).toBeUndefined();
  });

  it('skips fratraadt and returns next active person in same DAGL group', () => {
    const mixed: RollerResponse = {
      rollegrupper: [
        {
          type: { kode: 'DAGL', beskrivelse: 'Daglig leder' },
          roller: [
            {
              type: { kode: 'DAGL', beskrivelse: 'Daglig leder' },
              person: { navn: { fornavn: 'Old', etternavn: 'Leader' } },
              fratraadt: true,
            },
            {
              type: { kode: 'DAGL', beskrivelse: 'Daglig leder' },
              person: { navn: { fornavn: 'New', etternavn: 'Leader' } },
              fratraadt: false,
            },
          ],
        },
      ],
    };
    expect(findDagligLeder(mixed)).toBe('New Leader');
  });

  it('returns undefined for an empty response', () => {
    expect(findDagligLeder({})).toBeUndefined();
    expect(findDagligLeder({ rollegrupper: [] })).toBeUndefined();
  });

  it('handles missing mellomnavn cleanly', () => {
    const noMiddle: RollerResponse = {
      rollegrupper: [
        {
          type: { kode: 'DAGL', beskrivelse: 'Daglig leder' },
          roller: [
            {
              type: { kode: 'DAGL', beskrivelse: 'Daglig leder' },
              person: { navn: { fornavn: 'Kari', etternavn: 'Nordmann' } },
              fratraadt: false,
            },
          ],
        },
      ],
    };
    expect(findDagligLeder(noMiddle)).toBe('Kari Nordmann');
  });
});

describe('findRoleHolder', () => {
  it('finds styreleder (LEDE) nested under the STYR group', () => {
    expect(findRoleHolder(DNB_ROLLER, 'LEDE')).toBe('Eimund Nygaard');
  });

  it('finds daglig leder (DAGL) — same result as findDagligLeder', () => {
    expect(findRoleHolder(DNB_ROLLER, 'DAGL')).toBe(
      'Kjerstin Elisabeth Rasmussen Braathen',
    );
  });

  it('returns an entity name when the role holder is a firm (e.g. revisor)', () => {
    const withRevisor: RollerResponse = {
      rollegrupper: [
        {
          type: { kode: 'REVISOR', beskrivelse: 'Revisor' },
          roller: [
            {
              type: { kode: 'REVI', beskrivelse: 'Revisor' },
              enhet: {
                organisasjonsnummer: '976389387',
                navn: ['ERNST & YOUNG AS'],
              },
              fratraadt: false,
            },
          ],
        },
      ],
    };
    expect(findRoleHolder(withRevisor, 'REVI')).toBe('ERNST & YOUNG AS');
  });

  it('skips a fratrådt holder and returns the next active one', () => {
    const regn: RollerResponse = {
      rollegrupper: [
        {
          type: { kode: 'REGNSKAP', beskrivelse: 'Regnskapsfører' },
          roller: [
            {
              type: { kode: 'REGN', beskrivelse: 'Regnskapsfører' },
              enhet: { organisasjonsnummer: '111111111', navn: ['GAMMEL AS'] },
              fratraadt: true,
            },
            {
              type: { kode: 'REGN', beskrivelse: 'Regnskapsfører' },
              enhet: { organisasjonsnummer: '222222222', navn: ['NY AS'] },
              fratraadt: false,
            },
          ],
        },
      ],
    };
    expect(findRoleHolder(regn, 'REGN')).toBe('NY AS');
  });

  it('returns undefined when the role code is absent', () => {
    expect(findRoleHolder(DNB_ROLLER, 'REVI')).toBeUndefined();
    expect(findRoleHolder({}, 'LEDE')).toBeUndefined();
  });
});
