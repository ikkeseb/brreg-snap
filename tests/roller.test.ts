import { describe, expect, it } from 'vitest';
import {
  findDagligLeder,
  findRoleHolder,
  isResigned,
  roleSubjectName,
} from '../src/lib/roller.js';
import type { Rolle, RollerResponse } from '../src/types/brreg.js';
import equinorRoller from './fixtures/brreg/roller-923609016-equinor.json';
import konkursRoller from './fixtures/brreg/roller-915330193-konkurs.json';

// Live shapes (see tests/fixtures/brreg/README.md). If brreg renames
// `rollegrupper`, `type.kode`, `person.navn.*`, `avregistrert` or
// `bostyrer`, these fail before the UI silently shows a departed board
// member as current or drops a name.
const EQUINOR: RollerResponse = equinorRoller;
const KONKURS: RollerResponse = konkursRoller;

// Deep copy with one role's avregistrert flipped, so edge cases stay on
// the live shape instead of a hand-written one.
function withResigned(
  roller: RollerResponse,
  groupKode: string,
  index: number,
): RollerResponse {
  const copy = structuredClone(roller);
  const role = copy.rollegrupper!.find((g) => g.type.kode === groupKode)!
    .roller![index]!;
  role.avregistrert = true;
  return copy;
}

describe('isResigned', () => {
  it('reads the live avregistrert flag', () => {
    const styre = EQUINOR.rollegrupper!.find((g) => g.type.kode === 'STYR')!;
    const flags = styre.roller!.map(isResigned);
    // The capture has exactly one board member who has left.
    expect(flags.filter(Boolean)).toHaveLength(1);
    expect(isResigned(styre.roller![1]!)).toBe(true);
  });

  it('still honours the removed fratraadt field', () => {
    const role: Rolle = { type: { kode: 'DAGL' }, fratraadt: true };
    expect(isResigned(role)).toBe(true);
    expect(isResigned({ type: { kode: 'DAGL' } })).toBe(false);
  });
});

describe('findDagligLeder', () => {
  it('extracts the current daglig leder from a live-shaped response', () => {
    expect(findDagligLeder(EQUINOR)).toBe('Kari Nordmann');
  });

  it('returns undefined when no DAGL group is present', () => {
    const onlyStyre: RollerResponse = {
      rollegrupper: EQUINOR.rollegrupper!.filter((g) => g.type.kode === 'STYR'),
    };
    expect(findDagligLeder(onlyStyre)).toBeUndefined();
  });

  it('returns undefined when the daglig leder is avregistrert', () => {
    expect(findDagligLeder(withResigned(EQUINOR, 'DAGL', 0))).toBeUndefined();
  });

  it('returns undefined for an empty response', () => {
    expect(findDagligLeder({})).toBeUndefined();
    expect(findDagligLeder({ rollegrupper: [] })).toBeUndefined();
  });

  it('joins fornavn, mellomnavn and etternavn', () => {
    const roller: RollerResponse = {
      rollegrupper: [
        {
          type: { kode: 'DAGL', beskrivelse: 'Daglig leder' },
          roller: [
            {
              type: { kode: 'DAGL', beskrivelse: 'Daglig leder' },
              person: {
                navn: { fornavn: 'Per', mellomnavn: 'Olav', etternavn: 'Hansen' },
              },
              avregistrert: false,
            },
          ],
        },
      ],
    };
    expect(findDagligLeder(roller)).toBe('Per Olav Hansen');
  });
});

describe('findRoleHolder', () => {
  it('finds styreleder (LEDE) nested under the STYR group', () => {
    expect(findRoleHolder(EQUINOR, 'LEDE')).toBe('Ola Nordmann');
  });

  it('skips an avregistrert board member and returns the next current one', () => {
    // The first MEDL in the capture has left the board.
    expect(findRoleHolder(EQUINOR, 'MEDL')).toBe('Anne Berg');
  });

  it('returns an entity name when the role holder is a firm (revisor)', () => {
    expect(findRoleHolder(EQUINOR, 'REVI')).toBe('ERNST & YOUNG AS');
  });

  it('returns the bostyrer name for a company in konkurs', () => {
    expect(findRoleHolder(KONKURS, 'BOBE')).toBe('Adv. Ola Nordmann');
  });

  it('skips a holder carrying only the old fratraadt flag', () => {
    const regn: RollerResponse = {
      rollegrupper: [
        {
          type: { kode: 'REGN', beskrivelse: 'Regnskapsfører' },
          roller: [
            {
              type: { kode: 'REGN', beskrivelse: 'Regnskapsfører' },
              enhet: { organisasjonsnummer: '111111111', navn: ['GAMMEL AS'] },
              fratraadt: true,
            },
            {
              type: { kode: 'REGN', beskrivelse: 'Regnskapsfører' },
              enhet: { organisasjonsnummer: '222222222', navn: ['NY AS'] },
            },
          ],
        },
      ],
    };
    expect(findRoleHolder(regn, 'REGN')).toBe('NY AS');
  });

  it('returns undefined when the role code is absent', () => {
    expect(findRoleHolder(EQUINOR, 'REGN')).toBeUndefined();
    expect(findRoleHolder(EQUINOR, 'BOBE')).toBeUndefined();
    expect(findRoleHolder({}, 'LEDE')).toBeUndefined();
  });
});

describe('roleSubjectName', () => {
  it('names a bostyrer, whose navn is a flat string', () => {
    const bobe = KONKURS.rollegrupper!.find((g) => g.type.kode === 'BOBE')!
      .roller![0]!;
    expect(roleSubjectName(bobe)).toBe('Adv. Ola Nordmann');
  });

  it('is undefined for a role with no usable subject', () => {
    expect(roleSubjectName({ type: { kode: 'BOBE' }, bostyrer: {} })).toBeUndefined();
  });
});
