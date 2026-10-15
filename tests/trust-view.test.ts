import { describe, expect, it } from 'vitest';

import type { CompanyData } from '../src/lib/company-load.js';
import { deriveKonsern } from '../src/lib/konsern.js';
import { deriveAnswer, MISMATCH_HEADLINE } from '../src/lib/trust/answer.js';
import { deriveStatusFlags } from '../src/lib/ui/flags.js';
import { reportHref } from '../src/lib/view/copy.js';
import {
  buildTrustView,
  konsernParts,
  siteName,
  stampOf,
  titleCasePlace,
  type TrustViewInput,
} from '../src/lib/view/trust-view.js';
import { konsernLine } from '../src/lib/konsern.js';
import { sameText } from '../src/lib/view/dossier-view.js';
import type {
  Enhet,
  EnhetOppdatering,
  RegnskapResponse,
} from '../src/types/brreg.js';
import enhetBbc from './fixtures/brreg/enhet-932324229-bbc.json';
import enhetDnb from './fixtures/brreg/enhet-984851006-dnb.json';
import enhetEnk from './fixtures/brreg/enhet-999999998-enk.json';
import enhetEquinor from './fixtures/brreg/enhet-923609016-equinor.json';
import enhetKonkurs from './fixtures/brreg/enhet-915330193-konkurs.json';
import enhetNyttNavn from './fixtures/brreg/enhet-914375916-nytt-navn.json';
import enhetPaategning from './fixtures/brreg/enhet-935864879-paategning.json';
import enhetSlettet from './fixtures/brreg/enhet-989566733-slettet.json';
import enhetTvang from './fixtures/brreg/enhet-931744682-tvangsopplost.json';
import konsernEquinor from './fixtures/brreg/konsernstruktur-923609016-equinor.json';
import feedNyttNavn from './fixtures/brreg/oppdateringer-914375916-nytt-navn.json';
import regnskapEquinor from './fixtures/brreg/regnskap-923609016-usd.json';
import rollerEnk from './fixtures/brreg/roller-999999998-enk.json';
import rollerEquinor from './fixtures/brreg/roller-923609016-equinor.json';
import rollerKonkurs from './fixtures/brreg/roller-915330193-konkurs.json';
import rollerNyttNavn from './fixtures/brreg/roller-914375916-nytt-navn.json';
import yearsEquinor from './fixtures/brreg/aarsregnskap-aar-923609016.json';
import underenhetAlta from './fixtures/brreg/underenhet-973160834.json';

const NOW = new Date('2026-09-24T12:00:00');
const ENV = { version: '1.4.0', browser: 'Firefox' };

function company(enhet: unknown, extra: Partial<CompanyData> = {}): CompanyData {
  return {
    enhet: enhet as Enhet,
    roller: undefined,
    regnskap: undefined,
    underenheter: undefined,
    endringer: undefined,
    aarsregnskapYears: undefined,
    konsern: undefined,
    fetchedAt: NOW.getTime() - 120_000,
    ...extra,
  };
}

function view(input: Partial<TrustViewInput> & { company: CompanyData }) {
  return buildTrustView({
    method: undefined,
    host: undefined,
    now: NOW,
    surface: 'popup',
    env: ENV,
    ...input,
  });
}

const equinor = () =>
  company(enhetEquinor, {
    roller: rollerEquinor,
    regnskap: { items: regnskapEquinor } as unknown as RegnskapResponse,
    konsern: deriveKonsern(konsernEquinor, '923609016'),
    // fetchAarsregnskapYears returns newest first; the raw body is oldest first.
    aarsregnskapYears: [...(yearsEquinor)].sort().reverse(),
  });

describe('buildTrustView — a company on its own registered site', () => {
  const v = view({ company: equinor(), method: 'host-auto', host: 'www.equinor.com' });

  it('answers quietly and keeps the kobling first in the ledger', () => {
    expect(v.answer).toMatchObject({ tone: 'ok', headline: 'Ingen varsler i registeret', actions: [] });
    expect(v.answer.stamp).toBeUndefined();
    expect(v.ledger.map((r) => r.key)).toEqual(['kobling', 'status', 'alder', 'ansatte', 'regnskap']);
    expect(v.ledger[0]).toMatchObject({
      value: 'equinor.com er registrert hjemmeside',
      tone: 'ok',
      inline: true,
      actions: [{ kind: 'reject' }],
    });
  });

  it('shows the regnskap year with its money in the filing currency', () => {
    const regnskap = v.ledger.find((r) => r.key === 'regnskap')!;
    expect(regnskap.value).toBe('2025 levert');
    const text = regnskap.figures!.map((g) => g.map((p) => p.text).join('')).join(' · ');
    // The fixture is the live shape: the group's consolidated rows come
    // first (106,5 mrd), the company's own after. Only the latter shows.
    expect(text).toBe('omsetning 68,0 mrd USD · resultat 5,7 mrd USD');
  });

  it('puts form · city over the name and the leaders under it', () => {
    expect(v.identity).toMatchObject({
      name: 'EQUINOR ASA',
      over: 'Allmennaksjeselskap · Stavanger',
      claim: false,
    });
    expect(v.identity.eyebrow).toBeUndefined();
    expect(v.identity.orgnr).toEqual({ digits: '923609016', spaced: '923\u00a0609\u00a0016' });
    expect(v.identity.leaders.map((l) => l.label)).toEqual(['Daglig leder', 'Styreleder']);
  });

  it('carries the konsern line with its count in bold', () => {
    const parts = v.konsern!.parts;
    expect(parts.map((p) => p.text).join('')).toMatch(/^Morselskap i et konsern med \d+ selskaper$/);
    expect(parts.find((p) => p.strong)?.text).toMatch(/^\d+$/);
  });

  it('badges the tab with the answer and offers «Feil bedrift?»', () => {
    expect(v.canReject).toBe(true);
    expect(v.badgeTone).toBe('ok');
    expect(v.forgetSite).toBeUndefined();
    expect(v.backToSite).toBeUndefined();
  });

  it('has no dossier in the popup and the summary names the company', () => {
    expect(v.dossier).toBeUndefined();
    expect(v.summary.split('\n')[0]).toBe('EQUINOR ASA (org.nr 923 609 016)');
  });
});

describe('buildTrustView — a shop pasting a real company’s orgnr', () => {
  const v = view({
    company: equinor(),
    method: 'title',
    host: 'trygg-handel-billig.shop',
  });

  it('stamps the mismatch and names the provenance above the claimed name', () => {
    expect(v.answer.tone).toBe('danger');
    expect(v.answer.stamp).toEqual({ pre: 'Nettstedet er', word: 'ikke koblet', rest: 'til selskapet' });
    expect(v.answer.supporting).toContain('equinor.com');
    expect(v.identity).toMatchObject({
      claim: true,
      eyebrow: 'Org.nr funnet i sidetittelen',
      meta: 'Allmennaksjeselskap · Stavanger',
    });
    expect(v.identity.over).toBeUndefined();
  });

  it('offers the real site and the search for the right company inside the stamp', () => {
    expect(v.answer.actions).toEqual([
      { kind: 'goto', text: 'Gå til equinor.com', href: 'https://equinor.com' },
      { kind: 'reject', text: 'Søk etter riktig selskap' },
    ]);
  });

  it('keeps only the kobling row, short, and moves the company facts to prose', () => {
    expect(v.ledger).toHaveLength(1);
    expect(v.ledger[0]).toMatchObject({
      value: 'Ikke equinor.com',
      tone: 'danger',
      inline: true,
      actions: [{ kind: 'report' }],
    });
    const facts = v.facts!.map((p) => p.text).join('');
    expect(facts).toMatch(/^Aktiv · \d+ år, stiftet 1972 · [\d\s ]+ ansatte · regnskap for 2025 levert$/);
    expect(v.badgeTone).toBe('danger');
  });
});

describe('buildTrustView — a name guess', () => {
  const v = view({ company: company(enhetBbc), method: 'host-auto', host: 'www.bbc.co.uk' });

  it('puts the way out inside the warn band, the short evidence in the row', () => {
    expect(v.answer.tone).toBe('warn');
    expect(v.answer.actions).toEqual([{ kind: 'reject', text: 'Feil bedrift? Velg en annen' }]);
    expect(v.ledger[0]).toMatchObject({
      value: 'Gjettet fra navnet «bbc»',
      detail: 'ingen hjemmeside registrert',
      tone: 'warn',
      actions: [{ kind: 'report' }],
    });
    // The row carries «Rapporter feil treff», so the footer does not.
    expect(v.footReportHref).toBeUndefined();
    const calm = view({ company: equinor(), method: 'host-auto', host: 'www.equinor.com' });
    expect(calm.footReportHref).toBe(calm.reportHref);
  });

  it('fills the popup’s fifth row with næring when a signal is missing', () => {
    expect(v.ledger.length).toBeLessThanOrEqual(5);
    if (v.ledger.length === 5 && v.ledger.at(-1)!.key === 'naering') {
      expect(v.ledger.at(-1)!.tone).toBe('neutral');
    }
  });
});

describe('buildTrustView — danger statuses', () => {
  it('stamps a konkurs with the bostyrer and points the status row at kunngjøringer', () => {
    const v = view({
      company: company(enhetKonkurs, { roller: rollerKonkurs }),
      method: 'manual',
      host: 'www.example.com',
    });
    expect(v.answer.stamp?.word).toBe('Konkurs');
    expect(v.answer.stamp?.rest).toMatch(/^siden /);
    expect(v.answer.supporting).toMatch(/^Bostyrer: /);
    const status = v.ledger.find((r) => r.key === 'status')!;
    expect(status).toMatchObject({ dangerValue: true, value: 'Konkurs' });
    expect(status.actions[0]).toMatchObject({ kind: 'link', text: 'Kunngjøringer' });
    // A manual pick: no kobling, no badge, but a way back to the site.
    expect(v.ledger.some((r) => r.key === 'kobling')).toBe(false);
    expect(v.badgeTone).toBeUndefined();
    expect(v.canReject).toBe(false);
    expect(v.backToSite).toBe('example.com');
  });

  it('a konkurs on a site the company is not registered for still offers «Feil bedrift?»', () => {
    const v = view({
      company: company({ ...enhetKonkurs, hjemmeside: 'www.annet-sted.no' }, { roller: rollerKonkurs }),
      method: 'url-param',
      host: 'example.no',
    });
    expect(v.answer.stamp?.word).toBe('Konkurs');
    expect(v.canReject).toBe(true);
    expect(v.answer.actions).toEqual([]);
    const kobling = v.ledger.find((r) => r.key === 'kobling')!;
    expect(kobling.tone).toBe('danger');
    expect(kobling.actions).toEqual([{ kind: 'reject' }, { kind: 'report' }]);
  });

  it('stamps a deleted entity «Slettet»', () => {
    const v = view({ company: company(enhetSlettet), method: 'manual', host: undefined });
    expect(v.answer.tone).toBe('danger');
    expect(v.answer.stamp?.word).toBe('Slettet');
    expect(v.backToSite).toBeUndefined();
  });

  it('splits every stamp headline into one readable sentence', () => {
    expect(stampOf(MISMATCH_HEADLINE)).toEqual({
      pre: 'Nettstedet er',
      word: 'ikke koblet',
      rest: 'til selskapet',
    });
    const s = stampOf(MISMATCH_HEADLINE);
    expect([s.pre, s.word, s.rest].join(' ')).toBe(MISMATCH_HEADLINE);
    expect(stampOf('Tvangsavvikling – mangler regnskap')).toEqual({
      word: 'Tvangsavvikling',
      rest: '– mangler regnskap',
    });
    expect(stampOf('Slettet')).toEqual({ word: 'Slettet' });
  });
});

describe('stampOf — pinned against the danger headlines the answer builder produces', () => {
  // Real status shapes, dated and undated, built on the fixtures. The
  // headlines come out of deriveAnswer, never from a list in this test.
  const withoutDates = (e: object): Enhet => {
    const copy: Record<string, unknown> = { ...e };
    for (const key of Object.keys(copy)) if (/dato$/i.test(key)) delete copy[key];
    return copy as unknown as Enhet;
  };
  const DANGER_ENHETER: Enhet[] = [
    enhetKonkurs,
    { ...(enhetKonkurs as object), konkursdato: undefined } as unknown as Enhet,
    enhetSlettet,
    enhetTvang,
    { ...withoutDates(enhetTvang), underTvangsavviklingEllerTvangsopplosning: true },
  ];

  function dangerAnswer(enhet: Enhet) {
    return deriveAnswer({
      enhet,
      roller: undefined,
      signals: [],
      kobling: undefined,
      merknader: [],
      now: NOW,
    });
  }

  it('sets the key word of every danger status headline in red, whole words only', () => {
    for (const enhet of DANGER_ENHETER) {
      const answer = dangerAnswer(enhet);
      expect(answer.tone, answer.headline).toBe('danger');
      const label = deriveStatusFlags(enhet).find((f) => f.severity === 'danger')?.label;
      expect(label).toBeDefined();
      const stamp = stampOf(answer.headline);
      // The key word is the status label itself, not the whole headline
      // (a headline that is just the label has no rest, and that is fine).
      expect(stamp.word, answer.headline).toBe(label);
      expect(stamp.pre).toBeUndefined();
      expect([stamp.word, stamp.rest].filter(Boolean).join(' '), answer.headline).toBe(
        answer.headline,
      );
      expect(answer.headline.startsWith(`${stamp.word} `) || answer.headline === stamp.word).toBe(
        true,
      );
    }
  });

  it('covers every danger status the current Enhet status fields raise', () => {
    // All status booleans and dates on at once: a new danger label on one
    // of these fields cannot slip past the matrix. A status driven by a
    // field not listed here can: extend this object when one is added.
    const everything = {
      ...(enhetKonkurs as object),
      slettedato: '2026-01-01',
      underAvvikling: true,
      underTvangsavviklingEllerTvangsopplosning: true,
      underRekonstruksjonsforhandlingDato: '2026-01-01',
    } as unknown as Enhet;
    const dangerLabels = deriveStatusFlags(everything)
      .filter((f) => f.severity === 'danger')
      .map((f) => f.label)
      .sort();
    const covered = DANGER_ENHETER.map(
      (e) => deriveStatusFlags(e).find((f) => f.severity === 'danger')!.label,
    );
    expect([...new Set(covered)].sort()).toEqual(dangerLabels);
    // And each label alone, undated: it is the headline and still the stamp.
    for (const label of dangerLabels) expect(stampOf(label)).toEqual({ word: label });
  });

  it('leaves warn-toned status headlines unstamped (they never reach stampOf)', () => {
    // buildTrustView calls stampOf for tone danger only; avvikling and
    // rekonstruksjon are warn, so they are deliberately not stamp words.
    for (const e of [{ underAvvikling: true }, { underRekonstruksjonsforhandlingDato: '2026-09-02' }]) {
      const answer = dangerAnswer({ ...(enhetEquinor as object), ...e } as unknown as Enhet);
      expect(answer.tone).toBe('warn');
    }
  });
});

describe('buildTrustView — what could not be fetched is named, never absent', () => {
  it('lists the failed parts and puts the line under the popup\'s ok band', () => {
    const v = view({ company: company(enhetDnb), method: 'host-auto', host: 'www.dnb.no' });
    expect(v.failed).toEqual(['roller', 'regnskap', 'konsern']);
    expect(v.answer.tone).toBe('ok');
    expect(v.answer.note).toBe('Noe kunne ikke hentes: roller, regnskapstall, konsern');
    // Nothing failed: no list, no line.
    const ok = view({ company: equinor(), method: 'host-auto', host: 'www.equinor.com' });
    expect(ok.failed).toEqual([]);
    expect(ok.answer.note).toBeUndefined();
  });

  it('konsern counts as failed only when the company is in a group; endringer only on the panel', () => {
    const noGroup = view({ company: company(enhetKonkurs, { roller: rollerKonkurs, konsern: null }) });
    expect(noGroup.failed).toEqual(['regnskap']);
    const asked = view({ company: company(enhetDnb, { konsern: null }) });
    expect(asked.failed).toEqual(['roller', 'regnskap']);
    const panel = view({ company: company(enhetDnb, { konsern: null }), surface: 'panel' });
    expect(panel.failed).toEqual(['roller', 'regnskap', 'endringer']);
    expect(panel.answer.note).toBeUndefined();
    expect(panel.dossier!.enheter.konsernFailed).toBeUndefined();
    const tree = view({ company: company(enhetDnb), surface: 'panel' });
    expect(tree.dossier!.enheter.konsernFailed).toBe(true);
  });

  it('the warn band carries the line; a stamp has no room for it', () => {
    const warn = view({ company: company(enhetBbc), method: 'host-auto', host: 'www.bbc.co.uk' });
    expect(warn.answer.tone).toBe('warn');
    expect(warn.answer.note).toMatch(/^Noe kunne ikke hentes: /);
    const danger = view({ company: company(enhetKonkurs), method: 'url-param', host: 'example.no' });
    expect(danger.answer.tone).toBe('danger');
    expect(danger.failed).toContain('roller');
    expect(danger.answer.note).toBeUndefined();
  });
});

describe('buildTrustView — merknader', () => {
  it('both surfaces head the answer with the count; only the panel quotes the registry’s words', () => {
    const c = company(enhetPaategning);
    const popup = view({ company: c });
    const panel = view({ company: c, surface: 'panel' });
    expect(popup.answer.tone).toBe('warn');
    expect(popup.answer.headline).toBe('1 merknad i registeret');
    expect(popup.merknader).toEqual([]);
    // The panel quotes the merknad in full right under the ledger, so
    // the headline must not say it a second time.
    expect(panel.answer.headline).toBe('1 merknad i registeret');
    expect(panel.merknader).toHaveLength(1);
    expect(panel.merknader[0]!.text).toMatch(/^Foretaksregisteret har grunn til å anta/);
    expect(panel.merknader[0]!.since?.text).toMatch(/\d{4}$/);
    // The plain-text summary keeps the registry's sentence: it has no notes block.
    expect(panel.summary).toContain('Obs: Foretaksregisteret har grunn til å anta');
  });
});

describe('buildTrustView — money under the regnskap row', () => {
  // Equinor with the påtegning of the warn fixture: a warn answer over a
  // company whose accounts carry figures.
  const warned = () =>
    company(
      { ...enhetEquinor, paategninger: (enhetPaategning as { paategninger: unknown }).paategninger },
      { roller: rollerEquinor, regnskap: { items: regnskapEquinor } as unknown as RegnskapResponse },
    );
  const regnskapRow = (v: ReturnType<typeof view>) => v.ledger.find((r) => r.key === 'regnskap')!;

  it('the popup shows it only in the calm state; the panel keeps it under a warn band', () => {
    expect(regnskapRow(view({ company: equinor() })).figures).toBeDefined();
    const popup = view({ company: warned() });
    expect(popup.answer.tone).toBe('warn');
    expect(regnskapRow(popup).figures).toBeUndefined();
    expect(regnskapRow(view({ company: warned(), surface: 'panel' })).figures).toBeDefined();
  });
});

describe('buildTrustView — the regnskap row says what is and is not there', () => {
  const regnskapRow = (v: ReturnType<typeof view>) => v.ledger.find((r) => r.key === 'regnskap')!;
  // The open API a year behind the Enhet: figures for 2024, 2025 filed.
  const behind = (regnskapEquinor as Array<{ regnskapsperiode: { tilDato: string } }>).filter(
    (r) => r.regnskapsperiode.tilDato < '2025',
  );

  it('a late filing names the year that is missing; the headline does too', () => {
    const late = view({
      company: company({ ...enhetEquinor, sisteInnsendteAarsregnskap: '2023' }, { regnskap: { items: [] } }),
    });
    expect(late.answer).toMatchObject({ tone: 'warn', headline: 'Regnskap for 2025 er ikke levert' });
    expect(regnskapRow(late)).toMatchObject({
      tone: 'warn',
      value: '2025 ikke levert',
      aux: '· siste er 2023',
    });
  });

  it('a form without an unconditional duty keeps the neutral «siste innsendte»', () => {
    const enk = view({
      company: company({
        ...enhetEquinor,
        organisasjonsform: { kode: 'ENK', beskrivelse: 'Enkeltpersonforetak' },
        sisteInnsendteAarsregnskap: '2023',
      }),
    });
    expect(regnskapRow(enk)).toMatchObject({ tone: 'neutral', value: '2023', aux: '· siste innsendte' });
  });

  it('a filed year without figures says the figures are not in the open data', () => {
    const bank = view({
      // A bank's 500: special accounts, known from its næringskode.
      company: company(enhetDnb, { regnskap: { items: [], unavailable: true } }),
    });
    expect(regnskapRow(bank)).toMatchObject({ value: '2025 levert', detail: 'tall ikke i åpne data' });
    const lagging = view({
      company: company(enhetEquinor, { regnskap: { items: behind } as unknown as RegnskapResponse }),
    });
    expect(regnskapRow(lagging)).toMatchObject({ value: '2025 levert', detail: 'tall ikke i åpne data' });
    expect(regnskapRow(lagging).figures).toBeUndefined();
  });

  it('a failed lookup and a 500 outside special accounts say nothing about the figures', () => {
    expect(regnskapRow(view({ company: company(enhetDnb) })).detail).toBeUndefined();
    const bare = view({ company: company(enhetEquinor, { regnskap: { items: [], unavailable: true } }) });
    expect(regnskapRow(bare).detail).toBeUndefined();
    // With the money on the row there is nothing to explain.
    expect(regnskapRow(view({ company: equinor() })).detail).toBeUndefined();
  });

  it('Økonomi names the newer filed year over older figures, and which year it shows', () => {
    const d = view({
      company: company(enhetEquinor, {
        regnskap: { items: behind } as unknown as RegnskapResponse,
        aarsregnskapYears: ['2025', '2024'],
      }),
      surface: 'panel',
    }).dossier!;
    const f = d.okonomi.figures;
    expect(f.kind).toBe('figures');
    if (f.kind !== 'figures') return;
    expect(f.title).toBe('Årsregnskap 2024');
    expect(f.status).toEqual({
      tone: 'neutral',
      text: '2025 er levert. Tallene er ikke i åpne data ennå.',
    });
    // A trend held (2023–2024): it sets the span; the newer year stays
    // in the status line and turns «Eldre år» into «Andre år».
    expect(d.okonomi.trend?.years).toEqual(['2023', '2024']);
    expect(d.okonomi.honest).toBe('Åpne data dekker 2023–2024. Andre år finnes som PDF.');
    const noCopies = view({
      company: company(enhetEquinor, {
        regnskap: { items: behind } as unknown as RegnskapResponse,
        aarsregnskapYears: [],
      }),
      surface: 'panel',
    }).dossier!;
    expect(noCopies.okonomi.honest).toBe('Åpne data dekker 2023–2024.');
    // One year held: the one-year wording names it.
    const oneYear = view({
      company: company(enhetEquinor, {
        regnskap: {
          items: behind.filter((r) => r.regnskapsperiode.tilDato.startsWith('2024')),
        } as unknown as RegnskapResponse,
        aarsregnskapYears: ['2025', '2024'],
      }),
      surface: 'panel',
    }).dossier!;
    expect(oneYear.okonomi.trend).toBeUndefined();
    expect(oneYear.okonomi.honest).toBe('Viser tallene for 2024. Andre år finnes som PDF.');
  });
});

describe('buildTrustView — accounts the open data does not carry', () => {
  // Said in the register's own words: no «brreg sitt», no «API».
  const linesOf = (enhet: unknown) => {
    const f = view({
      company: company(enhet, { regnskap: { items: [], unavailable: true } as unknown as RegnskapResponse }),
      surface: 'panel',
    }).dossier!.okonomi.figures;
    return f.kind === 'text' ? f.lines : [];
  };

  it('a bank files special accounts that are not in the open data', () => {
    expect(linesOf(enhetDnb)[0]).toBe(
      'Banker og forsikringsselskaper leverer særskilte årsregnskap som ikke finnes i Brønnøysundregistrenes åpne data.',
    );
  });

  it('any other company: the register answered with an error', () => {
    expect(linesOf(enhetEquinor)[0]).toBe('Brønnøysundregistrene ga feil for dette regnskapet.');
    expect([...linesOf(enhetDnb), ...linesOf(enhetEquinor)].join(' ')).not.toMatch(/API|brreg sitt/i);
  });
});

describe('buildTrustView — the Økonomi trend', () => {
  const selskap = (tilDato: string, driftsinntekter: number, aarsresultat: number, valuta = 'NOK') => ({
    regnskapstype: 'SELSKAP',
    regnskapsperiode: { tilDato },
    valuta,
    resultatregnskapResultat: { driftsresultat: { driftsinntekter: { sumDriftsinntekter: driftsinntekter } }, aarsresultat },
  });
  const okonomiOf = (items: unknown[]) =>
    view({
      company: company(enhetEquinor, { regnskap: { items } as unknown as RegnskapResponse, aarsregnskapYears: [] }),
      surface: 'panel',
    }).dossier!.okonomi;

  it("holds the company's own years oldest first, never the group's, one unit per row", () => {
    const o = okonomiOf(regnskapEquinor);
    expect(o.figures.kind).toBe('figures');
    if (o.figures.kind !== 'figures') return;
    expect(o.figures.title).toBe('Årsregnskap 2025');
    // The figures head names USD, so the trend doesn't repeat it.
    expect(o.trend).toEqual({
      title: 'Utvikling 2023–2025',
      years: ['2023', '2024', '2025'],
      rows: [
        {
          label: 'Driftsinntekter',
          unit: 'mrd',
          name: 'Driftsinntekter, milliarder USD',
          cells: [{ amount: '72,4' }, { amount: '72,5' }, { amount: '68,0' }],
        },
        {
          label: 'Årsresultat',
          unit: 'mrd',
          name: 'Årsresultat, milliarder USD',
          cells: [{ amount: '11,7' }, { amount: '8,1' }, { amount: '5,7' }],
        },
      ],
      read: ['Driftsinntekter ned 6\u00a0%.', 'Årsresultat ned 51\u00a0%.'],
    });
    expect(o.honest).toBe('Åpne data dekker 2023–2025.');
  });

  it('one year: no trend, and the honest line is unchanged', () => {
    const o = okonomiOf([selskap('2025-12-31', 10, 1)]);
    expect(o.trend).toBeUndefined();
    expect(o.honest).toBe('Viser bare siste års tall.');
  });

  it('a middle-year loss is named, not hidden by first-to-last (24FITNESS: 768 → −476 → 860 tusen)', () => {
    const o = okonomiOf([
      selskap('2023-12-31', 31_124_422, 768_000),
      selskap('2024-12-31', 36_300_000, -475_672),
      selskap('2025-12-31', 42_599_757, 860_445),
    ]);
    expect(o.trend?.read).toEqual([
      'Driftsinntekter opp 37\u00a0%.',
      'Årsresultat opp 12\u00a0%, men underskudd i 2024.',
    ]);
    expect(o.trend?.rows[1]).toEqual({
      label: 'Årsresultat',
      unit: 'tusen',
      name: 'Årsresultat, tusen NOK',
      cells: [{ amount: '768' }, { amount: '-476', negative: true }, { amount: '860' }],
    });
  });

  it('an unchanged loss reads «like stort», not «mindre sist»', () => {
    const o = okonomiOf([selskap('2024-12-31', 1000, -100_000), selskap('2025-12-31', 1000, -100_000)]);
    expect(o.trend?.read).toEqual(['Driftsinntekter uendret.', 'Årsresultat i underskudd begge år, like stort.']);
  });

  it('a missing end year gives that row no sentence, never a silently shorter period', () => {
    const o = okonomiOf([
      selskap('2023-12-31', 100, 100),
      selskap('2024-12-31', 200, 200),
      { regnskapstype: 'SELSKAP', regnskapsperiode: { tilDato: '2025-12-31' }, resultatregnskapResultat: { driftsresultat: { driftsinntekter: { sumDriftsinntekter: 300 } } } },
    ]);
    expect(o.trend?.title).toBe('Utvikling 2023–2025');
    expect(o.trend?.rows[1]?.cells).toEqual([{ amount: '100' }, { amount: '200' }, undefined]);
    expect(o.trend?.read).toEqual(['Driftsinntekter opp 200\u00a0%.']);
  });

  it('a latest filing without figures still shows the years before it', () => {
    const o = okonomiOf([
      selskap('2023-12-31', 10_000_000, 1_000_000),
      selskap('2024-12-31', 12_000_000, 1_500_000),
      { regnskapstype: 'SELSKAP', regnskapsperiode: { tilDato: '2025-12-31' }, valuta: 'NOK' },
    ]);
    expect(o.figures).toEqual({ kind: 'text', lines: ['Regnskap registrert, men uten utdrag.'] });
    expect(o.trend?.years).toEqual(['2023', '2024']);
    // No figures head above it, so the trend names its own currency.
    expect(o.trend?.currency).toBe('Beløp i NOK');
    expect(o.trend?.read).toEqual(['Driftsinntekter opp 20\u00a0%.', 'Årsresultat opp 50\u00a0%.']);
    expect(o.honest).toBe('Åpne data dekker 2023–2024.');
  });

  it('a duplicate year keeps one column (the later tilDato)', () => {
    const o = okonomiOf([
      selskap('2024-06-30', 50, 5),
      selskap('2024-12-31', 100, 10),
      selskap('2025-12-31', 110, 11),
    ]);
    expect(o.trend?.years).toEqual(['2024', '2025']);
    expect(o.trend?.read).toEqual(['Driftsinntekter opp 10\u00a0%.', 'Årsresultat opp 10\u00a0%.']);
  });

  it('a widely spread row stays short: a value too small for the unit reads «<0,1» and keeps its exact amount', () => {
    const o = okonomiOf([selskap('2023-12-31', 1, -2), selskap('2024-12-31', 2, 5), selskap('2025-12-31', 1_000_000_000, 7)]);
    expect(o.trend?.rows[0]).toEqual({
      label: 'Driftsinntekter',
      unit: 'mrd',
      name: 'Driftsinntekter, milliarder NOK',
      cells: [{ amount: '<0,1', exact: '1 kr' }, { amount: '<0,1', exact: '2 kr' }, { amount: '1,0' }],
    });
    // Plain kroner: no unit word, the name says the currency alone.
    expect(o.trend?.rows[1]?.name).toBe('Årsresultat, NOK');
  });

  it('more than three years: the last three', () => {
    const o = okonomiOf([2021, 2022, 2023, 2024, 2025].map((y) => selskap(`${y}-12-31`, y, 1)));
    expect(o.trend?.years).toEqual(['2023', '2024', '2025']);
  });

  it('a year filed in another currency stays off the line', () => {
    const o = okonomiOf([selskap('2023-12-31', 10, 1, 'NOK'), selskap('2024-12-31', 10, 1, 'USD'), selskap('2025-12-31', 12, 2, 'USD')]);
    expect(o.trend?.years).toEqual(['2024', '2025']);
    expect(o.trend?.currency).toBeUndefined();
  });
});

describe('buildTrustView — one person in both roles', () => {
  const roller = (dagl: string, lede: string) =>
    ({
      rollegrupper: [
        { type: { kode: 'DAGL' }, roller: [{ type: { kode: 'DAGL' }, person: { navn: { fornavn: dagl, etternavn: 'Moe' } } }] },
        { type: { kode: 'STYR' }, roller: [{ type: { kode: 'LEDE' }, person: { navn: { fornavn: lede, etternavn: 'Moe' } } }] },
      ],
    }) as unknown as CompanyData['roller'];

  it('gets one line, not the name twice', () => {
    expect(view({ company: company(enhetEquinor, { roller: roller('Ola', 'Ola') }) }).identity.leaders).toEqual([
      { label: 'Daglig leder og styreleder', name: 'Ola Moe' },
    ]);
    expect(
      view({ company: company(enhetEquinor, { roller: roller('Ola', 'Kari') }) }).identity.leaders.map((l) => l.label),
    ).toEqual(['Daglig leder', 'Styreleder']);
  });
});

describe('buildTrustView — a sole proprietorship names its owner', () => {
  // The live ENK shape: an INNH group, no DAGL / LEDE, an accountant.
  const enk = (surface: 'popup' | 'panel') =>
    view({ company: company(enhetEnk, { roller: rollerEnk as unknown as CompanyData['roller'] }), surface });

  it('the popup\'s leaders line carries «Innehaver»', () => {
    expect(enk('popup').identity.leaders).toEqual([{ label: 'Innehaver', name: 'Kari Eksempel' }]);
  });

  it('Ledelse lists the owner first, before the accountant', () => {
    expect(enk('panel').dossier!.ledelse).toEqual([
      { label: 'Innehaver', lines: ['Kari Eksempel'] },
      { label: 'Regnskapsfører', drill: { text: 'EKSEMPEL REGNSKAP AS', orgnr: '999999997' } },
    ]);
  });
});

describe('buildTrustView — undo', () => {
  it('offers «Glem valget» where the site has a remembered choice', () => {
    const v = view({
      company: equinor(),
      method: 'host-pick',
      host: 'nettbank.equinor.com',
      remembered: { kind: 'choice', orgnr: '923609016' },
    });
    expect(v.forgetSite).toBe('equinor.com');
    expect(v.ledger[0]!.actions).toEqual([{ kind: 'reject' }, { kind: 'forget' }]);
  });
});

describe('buildTrustView — the panel dossier', () => {
  const v = view({ company: equinor(), method: 'host-auto', host: 'www.equinor.com', surface: 'panel' });
  const d = v.dossier!;

  it('lists the free registry fields under Registrering', () => {
    const labels = d.registrering.map((r) => r.label);
    expect(labels).toContain('Organisasjonsform');
    expect(labels).toContain('Stiftet');
    expect(labels).toContain('Næring');
    expect(labels).toContain('Formål');
    expect(d.registrering.find((r) => r.label === 'Næring')?.sub).toMatch(/^\d{2}\.\d{3}$/);
    // Long free text is clamped by the component.
    expect(d.registrering.find((r) => r.label === 'Formål')?.clamp).toBe(true);
  });

  it('shows Formål only when it differs from Aktivitet (case, punctuation and whitespace aside)', () => {
    const rows = (aktivitet: string[] | undefined, formaal: string[] | undefined) =>
      view({
        company: company({ ...enhetEquinor, aktivitet, vedtektsfestetFormaal: formaal }),
        surface: 'panel',
      })
        .dossier!.registrering.filter((r) => r.label === 'Aktivitet' || r.label === 'Formål')
        .map((r) => [r.label, r.lines?.[0]]);
    expect(rows(['Budbil transport.'], ['Budbil  transport'])).toEqual([['Aktivitet', 'Budbil transport.']]);
    expect(rows(['Budbil transport.'], ['BUDBIL TRANSPORT.'])).toEqual([['Aktivitet', 'Budbil transport.']]);
    expect(rows(['Budbil transport.'], ['Transport og lagring.'])).toEqual([
      ['Aktivitet', 'Budbil transport.'],
      ['Formål', 'Transport og lagring.'],
    ]);
    expect(rows(undefined, ['Transport og lagring.'])).toEqual([['Formål', 'Transport og lagring.']]);
    expect(rows(['Budbil transport.'], undefined)).toEqual([['Aktivitet', 'Budbil transport.']]);
    expect(sameText(undefined, undefined)).toBe(false);
  });

  it('shows the latest filing honestly, with the PDF years and kunngjøringer', () => {
    const f = d.okonomi.figures;
    expect(f.kind).toBe('figures');
    if (f.kind !== 'figures') return;
    expect(f.title).toBe('Årsregnskap 2025');
    expect(f.currency).toBe('Beløp i USD');
    expect(f.status).toEqual({ tone: 'ok', text: 'Levert til Regnskapsregisteret' });
    expect(f.groups.map((g) => g.title)).toEqual(['Resultat', 'Balanse']);
    expect(f.equity?.share).toBeGreaterThan(0);
    expect(d.okonomi.honest).toContain('Eldre år finnes som PDF.');
    expect(d.okonomi.pdf?.years[0]).toEqual({
      year: '2025',
      href: 'https://data.brreg.no/regnskapsregisteret/regnskap/aarsregnskap/kopi/923609016/2025',
    });
    expect(d.okonomi.kunngjoringer).toContain('orgnr=923609016');
  });

  it('builds the konsern section from the tree: path, then children', () => {
    const k = d.enheter.konsern!;
    expect(k.path).toHaveLength(1);
    expect(k.path[0]).toMatchObject({ orgnr: '923609016', self: true });
    expect(k.children.length).toBeGreaterThan(20);
    expect(k.size).toBe(55);
  });

  it('says the roller fetch failed instead of «none»', () => {
    const failed = view({ company: company(enhetEquinor), surface: 'panel' }).dossier!;
    expect(failed.personer).toBe('failed');
    expect(failed.ledelse).toBe('failed');
    expect(failed.okonomi.figures).toEqual({
      kind: 'failed',
      text: 'Kunne ikke hente regnskapstallene. Prøv igjen senere.',
    });
    expect(failed.okonomi.pdf).toBeUndefined();
    expect(failed.enheter.underenheter).toEqual({ kind: 'failed' });
  });

  it('explains a bank’s missing figures and still links the PDFs', () => {
    const dnb = view({
      company: company(enhetDnb, {
        // The live 500 body (regnskapDnb500) maps to «not in the open API».
        regnskap: { items: [], unavailable: true },
        aarsregnskapYears: ['2025', '2024'],
      }),
      surface: 'panel',
    }).dossier!;
    expect(dnb.okonomi.figures.kind).toBe('text');
    expect(dnb.okonomi.pdf?.years).toHaveLength(2);
  });

  it('lists a recent name change with the old name', () => {
    const v2 = view({
      company: company(enhetNyttNavn, {
        roller: rollerNyttNavn,
        endringer: feedNyttNavn._embedded.oppdaterteEnheter as unknown as EnhetOppdatering[],
      }),
      surface: 'panel',
    });
    const navn = v2.endringer.find((e) => e.title === 'Nytt navn');
    expect(navn?.sub).toMatch(/^tidligere /);
  });

  it('names the branch when the orgnr was an underenhet', () => {
    const v3 = view({
      company: company(enhetEquinor, { avdeling: underenhetAlta }),
    });
    expect(v3.identity.avdeling).toEqual({ name: underenhetAlta.navn, orgnr: '973\u00a0160\u00a0834' });
  });
});

describe('view helpers', () => {
  it('konsernParts reads exactly like konsernLine', () => {
    const k = deriveKonsern(konsernEquinor, '923609016')!;
    expect(konsernParts(k).map((p) => p.text).join('')).toBe(konsernLine(k));
  });

  it('konsernParts keeps the group count and «selskaper» on one line', () => {
    const k = deriveKonsern(konsernEquinor, '923609016')!;
    expect(k.role).toBe('top');
    const parts = konsernParts(k);
    expect(parts.filter((p) => p.nowrap).map((p) => p.text)).toEqual([
      (k.groupSize + 1).toLocaleString('nb-NO'),
      ' selskaper',
    ]);
    expect(parts[0]!.nowrap).toBeUndefined();
  });

  it('title-cases an all-caps place and leaves mixed case alone', () => {
    expect(titleCasePlace('STAVANGER')).toBe('Stavanger');
    expect(titleCasePlace('MO I RANA')).toBe('Mo i Rana');
    expect(titleCasePlace('DE-92711 Parkstein')).toBe('DE-92711 Parkstein');
  });

  it('shows a site without www.', () => {
    expect(siteName('www.nrk.no')).toBe('nrk.no');
    expect(siteName('nettbank.dnb.no')).toBe('dnb.no');
  });

  it('reportHref carries the host, orgnr, method and version — never a path', () => {
    const href = reportHref({
      host: 'www.nrk.no',
      orgnr: '923609016',
      method: 'host-pick',
      version: '1.4.0',
      browser: 'Chrome',
    });
    expect(href.startsWith('mailto:sebastian@nuez.no?subject=')).toBe(true);
    const body = new URLSearchParams(href.split('?')[1]).get('body')!;
    expect(body).toContain('Nettsted: www.nrk.no');
    expect(body).toContain('Org.nr vist: 923609016');
    expect(body).toContain('brreg-snap 1.4.0 · Chrome');
    expect(href).not.toContain('+');
  });
});
