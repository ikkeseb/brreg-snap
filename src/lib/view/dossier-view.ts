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
  postalLine,
} from '../format.js';
import type { KonsernChild, KonsernRef } from '../konsern.js';
import {
  egenkapitalandelTone,
  companyRegnskapByYear,
  keyFigures,
  regnskapGap,
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
  // A long free-text value (Aktivitet, Formål): the component clamps it
  // to a few lines with «Vis mer» when it runs past them.
  clamp?: boolean;
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

export type FigCell = Pick<FigRow, 'amount' | 'unit' | 'negative'>;

// Driftsinntekter and årsresultat over the years brreg served, oldest
// first, with one plain sentence per row reading the direction (first
// year to last) and a sign change. Absent with fewer than two years.
export interface TrendView {
  title: string;
  years: string[];
  // A cell is undefined when that year lacks the figure.
  rows: Array<{ label: string; cells: Array<FigCell | undefined> }>;
  read: string[];
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
      trend?: TrendView;
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
  // The company is in a group (erIKonsern) but the tree couldn't be
  // fetched: the section says so instead of vanishing.
  konsernFailed?: true;
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

function longText(label: string, value: string | undefined): DefRow | undefined {
  const row = text(label, value);
  if (row) row.clamp = true;
  return row;
}

// Whether two free-text fields say the same thing: case, punctuation
// and whitespace aside. Many companies register the same sentence as
// both aktivitet and vedtektsfestet formål, sometimes with a trailing
// period on one of them.
export function sameText(a: string | undefined, b: string | undefined): boolean {
  const norm = (t: string | undefined): string =>
    (t ?? '')
      .toLowerCase()
      .replace(/[\p{P}\p{S}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const na = norm(a);
  return na !== '' && na === norm(b);
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
  );
  // Formål only when it adds something to Aktivitet.
  const aktivitet = enhet.aktivitet?.join(' ');
  const formaal = enhet.vedtektsfestetFormaal?.join(' ');
  rows.push(longText('Aktivitet', aktivitet));
  if (!sameText(aktivitet, formaal)) rows.push(longText('Formål', formaal));
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
  const postal = postalLine(addr);
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

// The Enhet names a filed year newer than the latest figures the open
// API gave (it can lag a year behind): that year, else undefined.
function newerFiledYear(latest: KeyFigures, regnskapSignal: Signal | undefined): string | undefined {
  const year = regnskapSignal?.value;
  return year && /^\d{4}$/.test(year) && /^\d{4}$/.test(latest.year) && year > latest.year
    ? year
    : undefined;
}

// How a figure moved from the first held year to the last, in words.
// Driftsinntekter is never negative in practice, so it reads as a
// percentage; årsresultat also names a sign change, which is what a
// reader wants from three years (a loss turned to profit, or the
// reverse). Under one percent either way is «omtrent uendret».
function trendRead(label: string, first: number, last: number, signed: boolean): string {
  if (signed && first < 0 !== last < 0 && first !== 0 && last !== 0) {
    return COPY.trendTurned(label, last < 0);
  }
  if (signed && first < 0 && last < 0) {
    return COPY.trendLoss(label, Math.abs(last) > Math.abs(first));
  }
  if (first === 0) return COPY.trendMoved(label, last > 0 ? 'up' : last < 0 ? 'down' : 'flat');
  const pct = ((last - first) / Math.abs(first)) * 100;
  if (Math.abs(pct) < 1) return COPY.trendMoved(label, 'flat');
  return COPY.trendMoved(label, pct > 0 ? 'up' : 'down', formatPercent(Math.abs(pct)));
}

function trendOf(years: KeyFigures[]): TrendView | undefined {
  if (years.length < 2) return undefined;
  const rows: TrendView['rows'] = [];
  const read: string[] = [];
  const series: Array<[string, (k: KeyFigures) => number | undefined, boolean]> = [
    [COPY.driftsinntekter, (k) => k.driftsinntekter, false],
    [COPY.aarsresultat, (k) => k.aarsresultat, true],
  ];
  for (const [label, pick, signed] of series) {
    const values = years.map(pick);
    const held = values.filter((v): v is number => typeof v === 'number');
    if (held.length < 2) continue;
    rows.push({
      label,
      cells: values.map((v) => {
        const parts = formatAmountParts(v);
        if (!parts) return undefined;
        const cell: FigCell = { amount: parts.amount, unit: parts.unit };
        if (typeof v === 'number' && v < 0) cell.negative = true;
        return cell;
      }),
    });
    read.push(trendRead(label, held[0]!, held[held.length - 1]!, signed));
  }
  if (rows.length === 0) return undefined;
  const from = years[0]!.year;
  const to = years[years.length - 1]!.year;
  return { title: COPY.trendTitle(from, to), years: years.map((k) => k.year), rows, read };
}

function figuresOf(
  years: KeyFigures[],
  regnskapSignal: Signal | undefined,
): OkonomiFigures {
  const latest = years[years.length - 1]!;
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
  const newer = newerFiledYear(latest, regnskapSignal);
  const out: OkonomiFigures = {
    kind: 'figures',
    title: COPY.aarsregnskap(latest.year),
    currency: COPY.amountsIn((latest.valuta ?? 'NOK').toUpperCase()),
    status:
      regnskapSignal && regnskapSignal.value === latest.year && regnskapSignal.detail === 'levert'
        ? { tone: 'ok', text: COPY.filedOk }
        : {
            tone: filedOk ? 'neutral' : (regnskapSignal?.tone ?? 'neutral'),
            // «Siste innsendte» would contradict the ledger's newer year.
            text: newer ? COPY.filedNewer(newer) : COPY.filedLatest,
          },
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
  // Only years in the latest filing's currency sit on one line.
  const sameCurrency = years.filter((k) => (k.valuta ?? 'NOK').toUpperCase() === (latest.valuta ?? 'NOK').toUpperCase());
  const trend = trendOf(sameCurrency);
  if (trend) out.trend = trend;
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
    const held = companyRegnskapByYear(regnskap.items).map(keyFigures);
    const key = held[held.length - 1];
    if (!key) {
      figures = { kind: 'text', lines: [COPY.regnskapNone] };
    } else {
      figures = figuresOf(held, regnskapSignal);
      // Say which years the view holds (one, or the span the trend
      // reads; and which, when a newer one is filed), and point at the
      // copies where the others live.
      const trend = figures.kind === 'figures' ? figures.trend : undefined;
      honest = newerFiledYear(key, regnskapSignal)
        ? `${COPY.honestShowingYear(key.year)}${years && years.length > 0 ? COPY.honestOtherPdf : ''}`
        : trend
          ? `${COPY.honestYears(trend.years[0]!, key.year)}${pdfNote}`
          : `${COPY.honestSingleYear}${pdfNote}`;
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
  if (konsern === undefined && enhet.erIKonsern === true) view.konsernFailed = true;
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
