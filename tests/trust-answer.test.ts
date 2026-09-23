import { describe, expect, it } from 'vitest';

import {
  deriveAnswer,
  MISMATCH_HEADLINE,
  NO_WARNINGS_HEADLINE,
  type AnswerInput,
} from '../src/lib/trust/answer.js';
import { deriveEndringer } from '../src/lib/trust/endringer.js';
import { deriveMerknader } from '../src/lib/trust/merknader.js';
import { deriveSignals } from '../src/lib/trust/signals.js';
import type { Kobling, KoblingKind } from '../src/lib/trust/types.js';
import type { Enhet, RegnskapResponse, RollerResponse } from '../src/types/brreg.js';
import equinorEnhet from './fixtures/brreg/enhet-923609016-equinor.json';
import konkursEnhet from './fixtures/brreg/enhet-915330193-konkurs.json';
import paategningEnhet from './fixtures/brreg/enhet-935864879-paategning.json';
import rekonstruksjonEnhet from './fixtures/brreg/enhet-983830196-rekonstruksjon.json';
import slettetEnhet from './fixtures/brreg/enhet-989566733-slettet.json';
import tvangEnhet from './fixtures/brreg/enhet-931744682-tvangsopplost.json';
import feedEquinor from './fixtures/brreg/oppdateringer-923609016-equinor.json';
import rollerEquinor from './fixtures/brreg/roller-923609016-equinor.json';
import rollerKonkurs from './fixtures/brreg/roller-915330193-konkurs.json';
import type { EnhetOppdatering } from '../src/types/brreg.js';

const NOW = new Date(2026, 8, 24, 12);

const PLAIN: Enhet = {
  organisasjonsnummer: '910000000',
  navn: 'TEST AS',
  organisasjonsform: { kode: 'AS' },
  stiftelsesdato: '2010-01-01',
  sisteInnsendteAarsregnskap: '2025',
  harRegistrertAntallAnsatte: true,
};

function kobling(kind: KoblingKind, extra: Partial<Kobling> = {}): Kobling {
  return {
    key: 'kobling',
    label: 'Kobling',
    value: kind,
    tone: 'neutral',
    kind,
    host: 'www.eksempel.no',
    ...extra,
  };
}

interface Case {
  enhet: Enhet;
  roller?: RollerResponse;
  regnskap?: RegnskapResponse;
  kobling?: Kobling;
}

// Runs the real derivations end to end, as a surface would.
function answer({ enhet, roller, regnskap, kobling: k }: Case) {
  const input: AnswerInput = {
    enhet,
    roller,
    signals: deriveSignals(enhet, regnskap, NOW),
    kobling: k,
    merknader: deriveMerknader(enhet),
    now: NOW,
  };
  return deriveAnswer(input);
}

const FADR =
  'Foretaksregisteret har grunn til å anta at forretningsadressen er feil. Foretaket har fått pålegg om å melde endring.';

describe('deriveAnswer — headline and tone', () => {
  it.each<[string, Case, { tone: string; headline: string; supporting?: string }]>([
    // (d) nothing to report
    ['a healthy company', { enhet: PLAIN }, { tone: 'ok', headline: NO_WARNINGS_HEADLINE }],
    [
      'live Equinor on its registered site',
      { enhet: equinorEnhet as Enhet, kobling: kobling('registered') },
      { tone: 'ok', headline: NO_WARNINGS_HEADLINE },
    ],
    ...(['site-claims', 'chosen', 'directory', 'registered'] as const).map(
      (kind): [string, Case, { tone: string; headline: string }] => [
        `kobling ${kind} is no finding`,
        { enhet: PLAIN, kobling: kobling(kind) },
        { tone: 'ok', headline: NO_WARNINGS_HEADLINE },
      ],
    ),

    // (a) danger status
    [
      'konkurs, with the bostyrer (live 1VASK AS)',
      { enhet: konkursEnhet as Enhet, roller: rollerKonkurs as RollerResponse },
      {
        tone: 'danger',
        headline: 'Konkurs siden 26. aug. 2026',
        supporting: 'Bostyrer: Adv. Ola Nordmann',
      },
    ],
    [
      'konkurs without roller: no bostyrer line',
      { enhet: konkursEnhet as Enhet },
      { tone: 'danger', headline: 'Konkurs siden 26. aug. 2026' },
    ],
    [
      'undated konkurs',
      { enhet: { ...PLAIN, konkurs: true } },
      { tone: 'danger', headline: 'Konkurs' },
    ],
    [
      'slettet (live SlettetEnhet)',
      { enhet: slettetEnhet as Enhet },
      { tone: 'danger', headline: 'Slettet 15. sep. 2026' },
    ],
    ['undated slettet', { enhet: { ...PLAIN, slettedato: 'ukjent' } }, { tone: 'danger', headline: 'Slettet' }],
    [
      'tvangsavvikling with its reason (live 1779 HOLDING AS)',
      { enhet: tvangEnhet as Enhet },
      { tone: 'danger', headline: 'Tvangsavvikling – mangler regnskap' },
    ],
    [
      'tvangsavvikling without a reason',
      { enhet: { ...PLAIN, underTvangsavviklingEllerTvangsopplosning: true } },
      { tone: 'danger', headline: 'Tvangsavvikling' },
    ],
    [
      'danger beats a mismatch',
      { enhet: konkursEnhet as Enhet, kobling: kobling('mismatch', { registeredDomain: 'x.no' }) },
      { tone: 'danger', headline: 'Konkurs siden 26. aug. 2026' },
    ],

    // (b) mismatch
    [
      'mismatch with a registered site',
      { enhet: PLAIN, kobling: kobling('mismatch', { tone: 'warn', registeredDomain: 'equinor.com' }) },
      {
        tone: 'warn',
        headline: MISMATCH_HEADLINE,
        supporting:
          'Registrert hjemmeside er equinor.com. Hvem som helst kan skrive et org.nr på siden sin.',
      },
    ],
    [
      'mismatch that kobling.ts rates danger',
      { enhet: PLAIN, kobling: kobling('mismatch', { tone: 'danger', registeredDomain: 'equinor.com' }) },
      {
        tone: 'danger',
        headline: MISMATCH_HEADLINE,
        supporting:
          'Registrert hjemmeside er equinor.com. Hvem som helst kan skrive et org.nr på siden sin.',
      },
    ],
    [
      'mismatch without a registered domain',
      { enhet: PLAIN, kobling: kobling('mismatch') },
      {
        tone: 'warn',
        headline: MISMATCH_HEADLINE,
        supporting: 'Hvem som helst kan skrive et org.nr på siden sin.',
      },
    ],
    [
      'mismatch beats warn findings',
      { enhet: { ...PLAIN, underAvvikling: true }, kobling: kobling('mismatch') },
      {
        tone: 'warn',
        headline: MISMATCH_HEADLINE,
        supporting: 'Hvem som helst kan skrive et org.nr på siden sin.',
      },
    ],

    // (c) exactly one warn finding: it is the headline
    [
      'rekonstruksjon (live RUTA ENTREPRENØR AS)',
      { enhet: rekonstruksjonEnhet as Enhet },
      { tone: 'warn', headline: 'Under rekonstruksjon siden 2. sep. 2026' },
    ],
    [
      'under avvikling, dated',
      { enhet: { ...PLAIN, underAvvikling: true, underAvviklingDato: '2026-03-03' } },
      { tone: 'warn', headline: 'Under avvikling siden 3. mars 2026' },
    ],
    [
      'under avvikling, undated',
      { enhet: { ...PLAIN, underAvvikling: true } },
      { tone: 'warn', headline: 'Under avvikling' },
    ],
    [
      'a påtegning, first sentence (live SCAN TRANSPORT AS)',
      { enhet: paategningEnhet as Enhet },
      {
        tone: 'warn',
        headline: 'Foretaksregisteret har grunn til å anta at forretningsadressen er feil.',
      },
    ],
    [
      'a name-only guess',
      { enhet: PLAIN, kobling: kobling('name-guess', { host: 'bbc.co.uk' }) },
      { tone: 'warn', headline: 'Usikker kobling til bbc.co.uk' },
    ],
    [
      'registered site elsewhere',
      { enhet: PLAIN, kobling: kobling('other-site', { host: 'komplett.no', registeredDomain: 'komplettgroup.com' }) },
      { tone: 'warn', headline: 'Registrert hjemmeside er komplettgroup.com' },
    ],
    [
      'registered site elsewhere, domain unknown',
      { enhet: PLAIN, kobling: kobling('other-site') },
      { tone: 'warn', headline: 'Registrert hjemmeside er et annet nettsted' },
    ],
    [
      'founded 5 months ago',
      { enhet: { ...PLAIN, stiftelsesdato: '2026-04-20', sisteInnsendteAarsregnskap: undefined } },
      { tone: 'warn', headline: 'Stiftet for 5 måneder siden' },
    ],
    [
      'founded a month ago',
      { enhet: { ...PLAIN, stiftelsesdato: '2026-08-24', sisteInnsendteAarsregnskap: undefined } },
      { tone: 'warn', headline: 'Stiftet for 1 måned siden' },
    ],
    [
      'founded this week',
      { enhet: { ...PLAIN, stiftelsesdato: '2026-09-20', sisteInnsendteAarsregnskap: undefined } },
      { tone: 'warn', headline: 'Stiftet for under 1 måned siden' },
    ],
    [
      'registered (no stiftelsesdato) 3 months ago',
      {
        enhet: {
          ...PLAIN,
          stiftelsesdato: undefined,
          registreringsdatoEnhetsregisteret: '2026-06-10',
          sisteInnsendteAarsregnskap: undefined,
        },
      },
      { tone: 'warn', headline: 'Registrert for 3 måneder siden' },
    ],
    [
      'latest filing older than the deadline allows',
      { enhet: { ...PLAIN, sisteInnsendteAarsregnskap: '2023' } },
      { tone: 'warn', headline: 'Siste innsendte regnskap er fra 2023' },
    ],
    [
      'an old AS with nothing filed',
      { enhet: { ...PLAIN, sisteInnsendteAarsregnskap: undefined }, regnskap: { items: [] } },
      { tone: 'warn', headline: 'Ingen årsregnskap er sendt inn' },
    ],
    [
      'nothing filed but the regnskap fetch failed: no finding',
      { enhet: { ...PLAIN, sisteInnsendteAarsregnskap: undefined } },
      { tone: 'ok', headline: NO_WARNINGS_HEADLINE },
    ],

    // (c) two or more
    [
      'avvikling + påtegning',
      {
        enhet: {
          ...(paategningEnhet as Enhet),
          underAvvikling: true,
          underAvviklingDato: '2026-09-10',
        },
      },
      {
        tone: 'warn',
        headline: '2 ting å merke seg',
        supporting: 'Under avvikling siden 10. sep. 2026',
      },
    ],
  ])('%s', (_name, input, expected) => {
    const a = answer(input);
    expect({ tone: a.tone, headline: a.headline, supporting: a.supporting }).toEqual({
      supporting: undefined,
      ...expected,
    });
  });
});

describe('deriveAnswer — findings', () => {
  it('lists every warn finding in priority order', () => {
    const enhet: Enhet = {
      ...PLAIN,
      stiftelsesdato: '2026-04-20',
      sisteInnsendteAarsregnskap: '2023',
      underRekonstruksjonsforhandlingDato: '2026-09-02',
      paategninger: [
        { infotype: 'FADR', tekst: FADR, innfoertDato: '2026-09-01' },
        { infotype: 'DAGL', tekst: 'Kontaktperson mangler. Mer.', innfoertDato: '2026-09-09' },
      ],
    };
    const a = answer({ enhet, kobling: kobling('name-guess', { host: 'eksempel.no' }) });
    expect(a.headline).toBe('6 ting å merke seg');
    expect(a.supporting).toBe('Under rekonstruksjon siden 2. sep. 2026');
    expect(a.findings).toEqual([
      { tone: 'warn', source: 'status', text: 'Under rekonstruksjon siden 2. sep. 2026' },
      { tone: 'warn', source: 'merknad', text: 'Kontaktperson mangler.' },
      {
        tone: 'warn',
        source: 'merknad',
        text: 'Foretaksregisteret har grunn til å anta at forretningsadressen er feil.',
      },
      { tone: 'warn', source: 'kobling', text: 'Usikker kobling til eksempel.no' },
      { tone: 'warn', source: 'alder', text: 'Stiftet for 5 måneder siden' },
      { tone: 'warn', source: 'regnskap', text: 'Siste innsendte regnskap er fra 2023' },
    ]);
  });

  it('puts the danger status first, then the mismatch, then the warns', () => {
    const a = answer({
      enhet: { ...(konkursEnhet as Enhet), paategninger: [{ tekst: 'Merknad.' }] },
      kobling: kobling('mismatch', { tone: 'warn' }),
    });
    expect(a.findings.map((f) => [f.tone, f.source])).toEqual([
      ['danger', 'status'],
      ['warn', 'kobling'],
      ['warn', 'merknad'],
      // 1VASK AS last filed 2024; by September 2026 the 2025 accounts
      // were due.
      ['warn', 'regnskap'],
    ]);
  });

  it('keeps the full påtegning text in merknader, only the finding is cut', () => {
    const enhet = paategningEnhet as Enhet;
    expect(deriveMerknader(enhet)[0]?.text).toBe(FADR);
    expect(answer({ enhet }).findings[0]?.text).not.toBe(FADR);
  });

  it('is empty when ok', () => {
    expect(answer({ enhet: PLAIN }).findings).toEqual([]);
  });

  it('skips a bostyrer who has left the role', () => {
    const roller: RollerResponse = {
      rollegrupper: [
        {
          type: { kode: 'BOBE' },
          roller: [{ type: { kode: 'BOBE' }, bostyrer: { navn: 'Adv. Kari Nordmann' }, avregistrert: true }],
        },
      ],
    };
    expect(answer({ enhet: konkursEnhet as Enhet, roller }).supporting).toBeUndefined();
  });

  it('names the bostyrer of a forced dissolution too', () => {
    const roller: RollerResponse = {
      rollegrupper: [
        {
          type: { kode: 'BOBE' },
          roller: [{ type: { kode: 'BOBE' }, bostyrer: { navn: 'Adv. Kari Nordmann' } }],
        },
      ],
    };
    expect(answer({ enhet: tvangEnhet as Enhet, roller }).supporting).toBe(
      'Bostyrer: Adv. Kari Nordmann',
    );
  });
});

describe('deriveAnswer — endringer never raise the tone', () => {
  it('live Equinor: a board change in September, and still «Ingen varsler»', () => {
    const enhet = equinorEnhet as Enhet;
    const roller = rollerEquinor as RollerResponse;
    const endringer = deriveEndringer({
      enhet,
      roller,
      feed: (feedEquinor._embedded?.oppdaterteEnheter ?? []) as EnhetOppdatering[],
      now: NOW,
    });
    expect(endringer.map((e) => e.kind)).toEqual(['styre']);
    const a = answer({ enhet, roller, kobling: kobling('registered') });
    expect(a).toEqual({ tone: 'ok', headline: NO_WARNINGS_HEADLINE, findings: [] });
  });
});
