// The panel's tab content (Oversikt · Personer · Økonomi · Enheter) as
// plain data, built alongside the trust view (trust-view.ts) and painted
// by ./components/{oversikt,personer,okonomi,enheter}.ts. Same house
// rules: what couldn't be fetched says so, never «Ingen».

import type { CompanyData } from '../company-load.js';
import {
  formatAddress,
  formatAmountParts,
  formatCount,
  formatDateNo,
  formatPercent,
} from '../format.js';
import type { KonsernChild, KonsernRef } from '../konsern.js';
import {
  egenkapitalandelTone,
  keyFigures,
  regnskapGap,
  sortRegnskapDesc,
  type KeyFigures,
} from '../regnskap.js';
import { isResigned, roleSubjectName } from '../roller.js';
import type { Signal, Tone } from '../trust/types.js';
import { deriveStatusFlags } from '../ui/flags.js';
import type { Adresse, Enhet, Rolle, RollerResponse, Underenhet } from '../../types/brreg.js';
import { COPY } from './copy.js';

const NBSP = ' ';
const spaced = (digits: string): string =>
  /^\d{9}$/.test(digits)
    ? `${digits.slice(0, 3)}${NBSP}${digits.slice(3, 6)}${NBSP}${digits.slice(6)}`
    : digits;

export interface DefRow {
  label: string;
  // Plain text, one entry per line.
  lines?: string[];
  // Lighter text after the value (the næring code, a date).
  sub?: string;
  link?: { text: string; href: string; external: boolean };
  // A registered entity the user can open in the panel.
  drill?: { text: string; orgnr: string };
}

export type PersonItem =
  | { kind: 'person'; name: string; role: string; gone: boolean }
  | { kind: 'entity'; name: string; orgnr: string; role: string };

export interface PersonGroup {
  title: string;
  count: number;
  items: PersonItem[];
}

export interface FigRow {
  label: string;
  amount: string;
  unit: string;
  total?: boolean;
  negative?: boolean;
  tone?: 'warn';
}

export type OkonomiFigures =
  | { kind: 'failed'; text: string }
  | { kind: 'text'; lines: string[] }
  | {
      kind: 'figures';
      title: string;
      currency: string;
      status: { tone: Tone; text: string };
      groups: Array<{ title: string; rows: FigRow[] }>;
      // Egenkapitalandel as a bar: 0–100, and the legend under it.
      equity?: { share: number; left: string; right: string };
    };

export interface OkonomiView {
  figures: OkonomiFigures;
  honest?: string;
  // undefined: the year list couldn't be fetched.
  pdf?: { years: Array<{ year: string; href: string }> };
  kunngjoringer: string;
}

export interface KonsernSection {
  size: number;
  // Top → the company shown (inclusive), each with what it is to it.
  path: Array<KonsernRef & { note: string; self: boolean }>;
  children: Array<KonsernChild & { note: string }>;
}

export interface UnitView {
  orgnr: string;
  spaced: string;
  name: string;
  meta: string;
  gone: boolean;
}

export interface EnheterView {
  konsern?: KonsernSection;
  underenheter:
    | { kind: 'failed' }
    | { kind: 'list'; items: UnitView[]; shown: number; total: number; allHref: string };
}

export interface DossierView {
  registrering: DefRow[];
  ledelse: DefRow[];
  kontakt: DefRow[];
  personer: PersonGroup[] | 'failed';
  personCount?: number;
  okonomi: OkonomiView;
  enheter: EnheterView;
  unitCount?: number;
}

export interface DossierInput {
  company: CompanyData;
  signals: Signal[];
  now: Date;
  pdfUrl: (orgnr: string, year: string) => string;
  kunngjoringer: string;
}

function text(label: string, value: string | undefined, sub?: string): DefRow | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  const row: DefRow = { label, lines: [v] };
  if (sub) row.sub = sub;
  return row;
}

function present<T>(rows: Array<T | undefined>): T[] {
  return rows.filter((r): r is T => r !== undefined);
}

const STATUS_LABEL: Record<string, string> = {
  Konkurs: 'Konkurs åpnet',
  'Under avvikling': 'Avvikling fra',
  Rekonstruksjon: 'Rekonstruksjon fra',
};

function registrering(enhet: Enhet): DefRow[] {
  const naering = enhet.naeringskode1;
  const rows: Array<DefRow | undefined> = [
    text('Organisasjonsform', enhet.organisasjonsform?.beskrivelse),
    text('Stiftet', formatDateNo(enhet.stiftelsesdato)),
    text('Registrert', formatDateNo(enhet.registreringsdatoEnhetsregisteret)),
  ];
  for (const flag of deriveStatusFlags(enhet)) {
    const date = formatDateNo(flag.since);
    if (!date) continue;
    rows.push(text(STATUS_LABEL[flag.label] ?? flag.label, flag.reason ? `${date} (${flag.reason})` : date));
  }
  rows.push(
    naering?.beskrivelse
      ? text('Næring', naering.beskrivelse, naering.kode)
      : text('Næring', naering?.kode),
    text('Aktivitet', enhet.aktivitet?.join(' ')),
    text('Formål', enhet.vedtektsfestetFormaal?.join(' ')),
  );
  const previous = [...(enhet.historiskeNavn ?? [])]
    .filter((h) => h.navn?.trim())
    .sort((a, b) => (b.tilDato ?? '').localeCompare(a.tilDato ?? ''))[0];
  if (previous?.navn) {
    const until = formatDateNo(previous.tilDato?.slice(0, 10));
    rows.push(text('Tidligere navn', previous.navn, until ? `til ${until}` : undefined));
  }
  if (enhet.overordnetEnhet) {
    rows.push({
      label: 'Overordnet enhet',
      drill: { text: `Org.nr ${spaced(enhet.overordnetEnhet)}`, orgnr: enhet.overordnetEnhet },
    });
  }
  return present(rows);
}

// The first current holder of a role, as the Rolle itself (so an
// entity keeps its orgnr for the drill-in).
function currentRole(roller: RollerResponse, kode: string): Rolle | undefined {
  for (const group of roller.rollegrupper ?? []) {
    for (const role of group.roller ?? []) {
      if (role.type.kode === kode && !isResigned(role) && roleSubjectName(role)) return role;
    }
  }
  return undefined;
}

function roleRow(label: string, role: Rolle | undefined): DefRow | undefined {
  if (!role) return undefined;
  const name = roleSubjectName(role)!;
  const orgnr = role.enhet?.organisasjonsnummer;
  if (orgnr && !role.enhet?.erSlettet) return { label, drill: { text: name, orgnr } };
  return { label, lines: [name] };
}

function ledelse(roller: RollerResponse | undefined): DefRow[] {
  if (!roller) return [{ label: 'Roller', lines: ['Kunne ikke hentes'] }];
  return present([
    roleRow('Daglig leder', currentRole(roller, 'DAGL')),
    roleRow('Styreleder', currentRole(roller, 'LEDE')),
    roleRow('Revisor', currentRole(roller, 'REVI')),
    roleRow('Regnskapsfører', currentRole(roller, 'REGN')),
    roleRow('Bostyrer', currentRole(roller, 'BOBE')),
  ]);
}

export function addressLines(addr: Adresse | undefined): string[] {
  if (!addr) return [];
  const lines = (addr.adresse ?? []).map((l) => l.trim()).filter(Boolean);
  const postal = [addr.postnummer, addr.poststed].map((p) => p?.trim()).filter(Boolean).join(' ');
  if (postal) lines.push(postal);
  if (addr.landkode && addr.landkode !== 'NO' && addr.land) lines.push(addr.land);
  return lines;
}

function hjemmesideHref(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function kontakt(enhet: Enhet): DefRow[] {
  const business = addressLines(enhet.forretningsadresse);
  const postal = addressLines(enhet.postadresse);
  const rows: Array<DefRow | undefined> = [
    business.length > 0 ? { label: 'Forretningsadresse', lines: business } : undefined,
    postal.length > 0 && postal.join('|') !== business.join('|')
      ? { label: 'Postadresse', lines: postal }
      : undefined,
    text('Telefon', enhet.telefon),
    text('Mobil', enhet.mobil),
  ];
  if (enhet.epostadresse) {
    rows.push({
      label: 'E-post',
      link: { text: enhet.epostadresse, href: `mailto:${enhet.epostadresse}`, external: false },
    });
  }
  if (enhet.hjemmeside) {
    rows.push({
      label: 'Hjemmeside',
      link: {
        text: enhet.hjemmeside.replace(/^https?:\/\//i, '').replace(/\/$/, ''),
        href: hjemmesideHref(enhet.hjemmeside),
        external: true,
      },
    });
  }
  return present(rows);
}

function birthYear(role: Rolle): string | undefined {
  const year = role.person?.fodselsdato?.slice(0, 4);
  return year && /^\d{4}$/.test(year) ? `f. ${year}` : undefined;
}

function personer(roller: RollerResponse | undefined): PersonGroup[] | 'failed' {
  if (!roller) return 'failed';
  const groups: PersonGroup[] = [];
  for (const group of roller.rollegrupper ?? []) {
    const title = group.type.beskrivelse ?? group.type.kode;
    const items: PersonItem[] = [];
    for (const role of group.roller ?? []) {
      const name = roleSubjectName(role);
      if (!name) continue;
      const gone = isResigned(role);
      const roleText = role.type.beskrivelse ?? role.type.kode;
      const orgnr = role.enhet?.organisasjonsnummer;
      if (orgnr && !role.enhet?.erSlettet && !gone) {
        items.push({ kind: 'entity', name, orgnr, role: COPY.entityOpen(spaced(orgnr)) });
        continue;
      }
      let label = gone ? COPY.avregistrert : roleText === title ? (birthYear(role) ?? '') : roleText;
      if (role.person?.erDoed || role.bostyrer?.erDoed) label = label ? `${label} · død` : 'død';
      if (role.enhet?.erSlettet) label = label ? `${label} · slettet` : 'slettet';
      if (role.bostyrer) {
        const addr = formatAddress(role.bostyrer.postadresse);
        if (addr) label = label ? `${label} · ${addr}` : addr;
      }
      items.push({ kind: 'person', name, role: label, gone });
    }
    if (items.length > 0) {
      groups.push({
        title,
        count: items.filter((i) => i.kind === 'entity' || !i.gone).length,
        items,
      });
    }
  }
  return groups;
}

function figRow(
  label: string,
  value: number | undefined,
  opts: { total?: boolean } = {},
): FigRow | undefined {
  const parts = formatAmountParts(value);
  if (!parts) return undefined;
  const row: FigRow = { label, amount: parts.amount, unit: parts.unit };
  if (opts.total) row.total = true;
  if (typeof value === 'number' && value < 0) row.negative = true;
  return row;
}

function amountText(value: number | undefined): string | undefined {
  const p = formatAmountParts(value);
  return p ? `${p.amount}${p.unit ? ` ${p.unit}` : ''}` : undefined;
}

function figuresOf(latest: KeyFigures, regnskapSignal: Signal | undefined): OkonomiFigures {
  const resultat = present([
    figRow('Driftsinntekter', latest.driftsinntekter),
    figRow('Driftsresultat', latest.driftsresultat),
    figRow('Resultat før skatt', latest.resultatFoerSkatt),
    figRow('Årsresultat', latest.aarsresultat, { total: true }),
  ]);
  const share = formatPercent(latest.egenkapitalandel);
  const balanse = present([
    figRow('Sum eiendeler', latest.sumEiendeler),
    figRow('Egenkapital', latest.egenkapital),
    share
      ? {
          label: 'Egenkapitalandel',
          amount: share,
          unit: '',
          total: true,
          ...(typeof latest.egenkapitalandel === 'number' && latest.egenkapitalandel < 0
            ? { negative: true }
            : {}),
          ...(egenkapitalandelTone(latest.egenkapitalandel) ? { tone: 'warn' as const } : {}),
        }
      : undefined,
  ]);
  const groups = [
    { title: COPY.resultatGroup, rows: resultat },
    { title: COPY.balanseGroup, rows: balanse },
  ].filter((g) => g.rows.length > 0);
  if (groups.length === 0) return { kind: 'text', lines: [COPY.regnskapNoFigures] };
  const filedOk = regnskapSignal?.tone === 'ok' || regnskapSignal?.tone === 'neutral';
  const out: OkonomiFigures = {
    kind: 'figures',
    title: COPY.aarsregnskap(latest.year),
    currency: COPY.amountsIn((latest.valuta ?? 'NOK').toUpperCase()),
    status:
      regnskapSignal && regnskapSignal.value === latest.year && regnskapSignal.detail === 'levert'
        ? { tone: 'ok', text: COPY.filedOk }
        : { tone: filedOk ? 'neutral' : (regnskapSignal?.tone ?? 'neutral'), text: COPY.filedLatest },
    groups,
  };
  const eq = amountText(latest.egenkapital);
  const debt = amountText(latest.gjeld);
  if (typeof latest.egenkapitalandel === 'number' && eq && debt) {
    out.equity = {
      share: Math.max(0, Math.min(100, Math.round(latest.egenkapitalandel))),
      left: COPY.egenkapitalLegend(eq),
      right: COPY.gjeldLegend(debt),
    };
  }
  return out;
}

function okonomi(input: DossierInput): OkonomiView {
  const { company, signals, pdfUrl, kunngjoringer } = input;
  const { enhet, regnskap } = company;
  const regnskapSignal = signals.find((s) => s.key === 'regnskap');
  let figures: OkonomiFigures;
  let honest: string | undefined;
  const years = company.aarsregnskapYears;
  const pdfNote = years && years.length > 0 ? COPY.honestPdf : '';
  if (!regnskap) {
    figures = { kind: 'failed', text: COPY.regnskapFailed };
  } else if (regnskap.unavailable) {
    const gap = regnskapGap(enhet.naeringskode1?.kode, regnskap.unsupportedPlan);
    const lines: string[] = [gap === 'special-accounts' ? COPY.specialAccounts : COPY.apiError];
    if (enhet.sisteInnsendteAarsregnskap) lines.push(COPY.lastFiled(enhet.sisteInnsendteAarsregnskap));
    figures = { kind: 'text', lines };
  } else {
    const latest = sortRegnskapDesc(regnskap.items)[0];
    if (!latest) {
      figures = { kind: 'text', lines: [COPY.regnskapNone] };
    } else {
      figures = figuresOf(keyFigures(latest), regnskapSignal);
      // brreg's open API returns the latest year only: say so, and
      // point at the copies where older years live.
      honest = `${COPY.honestSingleYear}${pdfNote}`;
    }
  }
  const view: OkonomiView = { figures, kunngjoringer };
  if (honest) view.honest = honest;
  if (years) {
    view.pdf = { years: years.map((year) => ({ year, href: pdfUrl(enhet.organisasjonsnummer, year) })) };
  }
  return view;
}

function unitMeta(u: Underenhet): { meta: string; gone: boolean } {
  const gone = u.slettedato ?? u.nedleggelsesdato;
  if (gone) {
    const date = formatDateNo(gone) ?? gone;
    return { meta: u.slettedato ? COPY.slettet(date) : COPY.nedlagt(date), gone: true };
  }
  const addr = addressLines(u.beliggenhetsadresse).join(', ');
  const count = typeof u.antallAnsatte === 'number' && u.antallAnsatte > 0
    ? COPY.ansatte(formatCount(u.antallAnsatte)!.replace(/ /g, NBSP))
    : undefined;
  return { meta: [addr, count].filter(Boolean).join(' · '), gone: false };
}

function enheter(company: CompanyData): EnheterView {
  const { enhet, underenheter, konsern } = company;
  const orgnr = enhet.organisasjonsnummer;
  const view: EnheterView = {
    underenheter: underenheter
      ? {
          kind: 'list',
          items: underenheter.items.map((u) => ({
            orgnr: u.organisasjonsnummer,
            spaced: spaced(u.organisasjonsnummer),
            name: u.navn,
            ...unitMeta(u),
          })),
          shown: underenheter.items.length,
          total: underenheter.total,
          allHref: `https://virksomhet.brreg.no/nb/oppslag/enheter/${orgnr}`,
        }
      : { kind: 'failed' },
  };
  if (konsern) {
    const parentOrgnr = konsern.parent?.orgnr;
    view.konsern = {
      size: konsern.groupSize + 1,
      path: konsern.path.map((ref, i) => {
        const self = ref.orgnr === orgnr;
        const notes: string[] = [];
        if (self) notes.push(COPY.thisCompany);
        else if (i === 0) notes.push(COPY.topCompany);
        if (ref.orgnr === parentOrgnr && konsern.parent?.grunnlag) {
          notes.push(COPY.ownerStake(konsern.parent.grunnlag));
        }
        if (!self) notes.unshift(`Org.nr ${spaced(ref.orgnr)}`);
        return { ...ref, self, note: notes.join(' · ') };
      }),
      children: konsern.children.map((c) => ({
        ...c,
        note: [c.grunnlag, c.childCount > 0 ? COPY.childCount(c.childCount) : undefined]
          .filter(Boolean)
          .join(' · '),
      })),
    };
  }
  return view;
}

export function buildDossier(input: DossierInput): DossierView {
  const { company } = input;
  const personerView = personer(company.roller);
  const view: DossierView = {
    registrering: registrering(company.enhet),
    ledelse: ledelse(company.roller),
    kontakt: kontakt(company.enhet),
    personer: personerView,
    okonomi: okonomi(input),
    enheter: enheter(company),
  };
  if (personerView !== 'failed') {
    view.personCount = personerView.reduce((n, g) => n + g.count, 0);
  }
  if (company.underenheter) view.unitCount = company.underenheter.total;
  return view;
}
