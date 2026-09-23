import { describe, expect, it } from 'vitest';

import {
  deriveRegistryFlags,
  deriveStatusFlags,
  primaryStatusFlag,
} from '../src/lib/ui/flags.js';
import type { Enhet } from '../src/types/brreg.js';
import konkursEnhet from './fixtures/brreg/enhet-915330193-konkurs.json';
import slettetEnhet from './fixtures/brreg/enhet-989566733-slettet.json';
import tvangEnhet from './fixtures/brreg/enhet-931744682-tvangsopplost.json';

const base: Enhet = { organisasjonsnummer: '910000000', navn: 'Test AS' };

const labels = (enhet: Enhet) => deriveStatusFlags(enhet).map((f) => f.label);

describe('deriveStatusFlags', () => {
  it('no negative signals -> Aktiv (ok)', () => {
    expect(deriveStatusFlags(base)).toEqual([
      { label: 'Aktiv', severity: 'ok' },
    ]);
  });

  // Regression: the /enheter/{orgnr} response for a deleted entity is a
  // minimal SlettetEnhet body (live-verified on 933004708, slettedato
  // 2024-05-31) where konkurs/avvikling booleans are absent. Deriving
  // status from those alone rendered a green "Aktiv" flag.
  it('slettedato -> Slettet (danger, dated), no Aktiv', () => {
    expect(deriveStatusFlags({ ...base, slettedato: '2024-05-31' })).toEqual([
      { label: 'Slettet', severity: 'danger', since: '2024-05-31' },
    ]);
  });

  it('konkurs -> Konkurs (danger), no Aktiv', () => {
    expect(deriveStatusFlags({ ...base, konkurs: true })).toEqual([
      { label: 'Konkurs', severity: 'danger' },
    ]);
  });

  it('underAvvikling -> Under avvikling (warn), no Aktiv', () => {
    expect(deriveStatusFlags({ ...base, underAvvikling: true })).toEqual([
      { label: 'Under avvikling', severity: 'warn' },
    ]);
  });

  it('tvangsavvikling -> Tvangsavvikling (danger), no Aktiv', () => {
    expect(
      deriveStatusFlags({
        ...base,
        underTvangsavviklingEllerTvangsopplosning: true,
      }),
    ).toEqual([{ label: 'Tvangsavvikling', severity: 'danger' }]);
  });

  it('multiple negatives all render, still no Aktiv', () => {
    expect(
      labels({ ...base, slettedato: '2024-05-31', konkurs: true }),
    ).toEqual(['Slettet', 'Konkurs']);
  });

  it('explicit false booleans still count as active', () => {
    expect(
      labels({
        ...base,
        konkurs: false,
        underAvvikling: false,
        underTvangsavviklingEllerTvangsopplosning: false,
      }),
    ).toEqual(['Aktiv']);
  });

  it('empty-string slettedato is not treated as deleted', () => {
    expect(labels({ ...base, slettedato: '' })).toEqual(['Aktiv']);
  });
});

describe('deriveStatusFlags — when and why (live shapes)', () => {
  it('dates a konkurs from konkursdato', () => {
    const konkurs: Enhet = konkursEnhet;
    expect(primaryStatusFlag(konkurs)).toEqual({
      label: 'Konkurs',
      severity: 'danger',
      since: '2026-08-26',
    });
  });

  it('names the reason for a forced dissolution', () => {
    const tvang: Enhet = tvangEnhet;
    expect(primaryStatusFlag(tvang)).toEqual({
      label: 'Tvangsavvikling',
      severity: 'danger',
      since: '2026-06-04',
      reason: 'mangler regnskap',
    });
  });

  it('dates a deleted entity from slettedato', () => {
    const slettet: Enhet = slettetEnhet;
    expect(primaryStatusFlag(slettet)).toMatchObject({
      label: 'Slettet',
      since: '2026-09-15',
    });
  });

  it('dates under avvikling from underAvviklingDato', () => {
    expect(
      primaryStatusFlag({
        ...base,
        underAvvikling: true,
        underAvviklingDato: '2026-03-01',
      }),
    ).toEqual({ label: 'Under avvikling', severity: 'warn', since: '2026-03-01' });
  });

  it('leaves an undated status undated', () => {
    expect(primaryStatusFlag({ ...base, konkurs: true })).toEqual({
      label: 'Konkurs',
      severity: 'danger',
    });
  });
});

describe('primaryStatusFlag', () => {
  it('is Aktiv for a healthy company', () => {
    expect(primaryStatusFlag(base).label).toBe('Aktiv');
  });

  it('picks the most severe status (danger beats warn)', () => {
    expect(
      primaryStatusFlag({ ...base, underAvvikling: true, konkurs: true }),
    ).toEqual({ label: 'Konkurs', severity: 'danger' });
  });

  it('keeps derivation order between equal severities', () => {
    expect(
      primaryStatusFlag({ ...base, slettedato: '2024-05-31', konkurs: true })
        .label,
    ).toBe('Slettet');
  });
});

describe('deriveRegistryFlags', () => {
  it('is empty when no registries are set', () => {
    expect(deriveRegistryFlags(base)).toEqual([]);
  });

  it('lists all four memberships in fixed order', () => {
    expect(
      deriveRegistryFlags({
        ...base,
        registrertIMvaregisteret: true,
        registrertIForetaksregisteret: true,
        registrertIStiftelsesregisteret: true,
        registrertIFrivillighetsregisteret: true,
      }),
    ).toEqual([
      'MVA-registrert',
      'Foretaksregisteret',
      'Stiftelsesregisteret',
      'Frivillighetsregisteret',
    ]);
  });
});
