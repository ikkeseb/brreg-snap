import { describe, expect, it } from 'vitest';
import { findDagligLeder } from '../src/lib/roller.js';
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
