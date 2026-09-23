import { describe, expect, it } from 'vitest';

import type { CompanyData } from '../src/lib/company-load.js';
import { deriveKonsern } from '../src/lib/konsern.js';
import { MISMATCH_HEADLINE } from '../src/lib/trust/answer.js';
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
import type {
  Enhet,
  EnhetOppdatering,
  RegnskapResponse,
} from '../src/types/brreg.js';
import enhetBbc from './fixtures/brreg/enhet-932324229-bbc.json';
import enhetDnb from './fixtures/brreg/enhet-984851006-dnb.json';
import enhetEquinor from './fixtures/brreg/enhet-923609016-equinor.json';
import enhetKonkurs from './fixtures/brreg/enhet-915330193-konkurs.json';
import enhetNyttNavn from './fixtures/brreg/enhet-914375916-nytt-navn.json';
import enhetPaategning from './fixtures/brreg/enhet-935864879-paategning.json';
import enhetSlettet from './fixtures/brreg/enhet-989566733-slettet.json';
import konsernEquinor from './fixtures/brreg/konsernstruktur-923609016-equinor.json';
import feedNyttNavn from './fixtures/brreg/oppdateringer-914375916-nytt-navn.json';
import regnskapEquinor from './fixtures/brreg/regnskap-923609016-usd.json';
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

describe('buildTrustView — a company on its own registered site (P1)', () => {
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
    expect(text).toMatch(/^omsetning [\d,]+ mrd USD · resultat [\d,]+ mrd USD$/);
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

describe('buildTrustView — a shop pasting a real company’s orgnr (P4)', () => {
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

describe('buildTrustView — a name guess (P3)', () => {
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

describe('buildTrustView — merknader', () => {
  it('the popup carries the count, the panel the registry’s words', () => {
    const c = company(enhetPaategning);
    const popup = view({ company: c });
    const panel = view({ company: c, surface: 'panel' });
    expect(popup.answer.tone).toBe('warn');
    expect(popup.answer.headline).toBe('1 merknad i registeret');
    expect(popup.merknader).toEqual([]);
    expect(panel.answer.headline).not.toBe('1 merknad i registeret');
    expect(panel.merknader).toHaveLength(1);
    expect(panel.merknader[0]!.since?.text).toMatch(/\d{4}$/);
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
    expect(failed.ledelse).toEqual([{ label: 'Roller', lines: ['Kunne ikke hentes'] }]);
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
    expect(v3.identity.avdeling).toMatch(/^Avdeling: .+ \(973\u00a0160\u00a0834\)$/);
  });
});

describe('view helpers', () => {
  it('konsernParts reads exactly like konsernLine', () => {
    const k = deriveKonsern(konsernEquinor, '923609016')!;
    expect(konsernParts(k).map((p) => p.text).join('')).toBe(konsernLine(k));
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
