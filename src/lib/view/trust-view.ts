// The one view model both surfaces paint: buildTrustView turns a loaded
// company (company-load.ts), how it was found (ResolutionMethod) and the
// site on screen into a plain object — every string, tone and action
// the popup and the panel show. Pure and unit-tested: the components in
// ./components/ only write this into the DOM, and the controllers only
// decide which view to build. The panel's tab content is built in
// ./dossier-view.ts and attached as `dossier`.
//
// The loudness rule (docs/notes/ui.md § loudness): the answer's tone
// decides the form — ok is a quiet band, warn a firmer band with the way
// out inside it, danger a stamp. Everything else follows from that.

import { aarsregnskapPdfUrl, kunngjoringerUrl } from '../aarsregnskap.js';
import type { CompanyData } from '../company-load.js';
import { formatDateNo, formatMoney, formatOrgnr } from '../format.js';
import type { RememberedChoice } from '../hostname-search.js';
import { hjemmesideDomains, hostnameLabel, registrableDomain } from '../hostname-score.js';
import { konsernLine, type Konsern } from '../konsern.js';
import { keyFigures, sortRegnskapDesc } from '../regnskap.js';
import { isHostDerived, type ResolutionMethod } from '../resolution-method.js';
import { findRoleHolder } from '../roller.js';
import { deriveAnswer, MISMATCH_HEADLINE } from '../trust/answer.js';
import { deriveEndringer } from '../trust/endringer.js';
import { deriveKobling } from '../trust/kobling.js';
import { deriveMerknader } from '../trust/merknader.js';
import { deriveSignals } from '../trust/signals.js';
import { brregUrl, buildSummary } from '../trust/summary.js';
import type { Answer, Kobling, Signal, Tone } from '../trust/types.js';
import { deriveRegistryFlags, deriveStatusFlags, primaryStatusFlag } from '../ui/flags.js';
import type { Enhet, RegnskapResponse } from '../../types/brreg.js';
import { COPY, reportHref } from './copy.js';
import { buildDossier, type DossierView } from './dossier-view.js';

export type Surface = 'popup' | 'panel';
export type AnswerTone = Answer['tone'];

// A run of text; `strong` → <b>, `negative` → the danger colour
// (negative money), `nowrap` keeps a figure and its label together.
export interface TextPart {
  text: string;
  strong?: boolean;
  negative?: boolean;
  nowrap?: boolean;
}

export interface OrgnrText {
  digits: string;
  // «923 609 016» with no-break spaces, for display.
  spaced: string;
}

export interface IdentityView {
  name: string;
  // The site's claim, not its identity (spoof): the name one step down.
  claim: boolean;
  // «Allmennaksjeselskap · Stavanger» above the name…
  over?: string;
  // …or, when the org.nr came from the page, the provenance instead,
  // with form · city moved to the org.nr line.
  eyebrow?: string;
  meta?: string;
  orgnr: OrgnrText;
  brregUrl: string;
  // Popup: «Daglig leder X · Styreleder Y».
  leaders: Array<{ label: string; name: string }>;
  // Panel: quiet registry flags + secondary statuses, «·»-joined.
  flags: string;
  // The orgnr looked up was an underenhet; this is its parent.
  avdeling?: string;
}

export type AnswerAction =
  // «Feil bedrift? Velg en annen» (warn band) / «Søk etter riktig
  // selskap» (spoof stamp): the reject flow.
  | { kind: 'reject'; text: string }
  | { kind: 'goto'; text: string; href: string };

export interface StampText {
  pre?: string;
  word: string;
  rest?: string;
}

export interface AnswerView {
  tone: AnswerTone;
  headline: string;
  supporting?: string;
  // Danger only: the headline split around the stamp word.
  stamp?: StampText;
  actions: AnswerAction[];
}

export type RowAction =
  | { kind: 'reject' }
  | { kind: 'forget' }
  | { kind: 'report' }
  | { kind: 'link'; text: string; href: string };

export interface LedgerRow {
  key: string;
  label: string;
  tone: Tone;
  value: string;
  // Same line, lighter: «· stiftet 1972».
  aux?: string;
  // Own line, lighter (inline for --inline rows).
  detail?: string;
  // Money under the regnskap value, groups joined by « · ».
  figures?: TextPart[][];
  inline?: boolean;
  dangerValue?: boolean;
  actions: RowAction[];
}

export interface KonsernView {
  parts: TextPart[];
}

export interface MerknadView {
  text: string;
  since?: { iso: string; text: string };
}

export interface EndringView {
  iso: string;
  date: string;
  title: string;
  sub?: string;
}

export interface TrustView {
  surface: Surface;
  // The enhet shown (for an underenhet: its parent).
  orgnr: string;
  identity: IdentityView;
  answer: AnswerView;
  ledger: LedgerRow[];
  // Spoof: the company's own facts as one prose line, under a caption
  // that says they are about the company, not the site.
  facts?: TextPart[];
  konsern?: KonsernView;
  merknader: MerknadView[];
  endringer: EndringView[];
  // «Feil bedrift?»: the result was derived from the site.
  canReject: boolean;
  // «Glem valget for <site>»: the user told us something about it.
  forgetSite?: string;
  // «Tilbake til treffet for <site>»: a manual pick while a site is on
  // screen.
  backToSite?: string;
  fetchedAt: number;
  reportHref: string;
  summary: string;
  // The tone to set on the resolved tab's toolbar button, only when the
  // company on screen is the tab's own (host-derived).
  badgeTone?: AnswerTone;
  dossier?: DossierView;
}

export interface ViewEnv {
  version: string;
  browser: string;
}

export interface TrustViewInput {
  company: CompanyData;
  method: ResolutionMethod | undefined;
  // The site on screen (the tab's hostname). Kept for a manual pick,
  // where it only offers the way back; kobling ignores it then.
  host: string | undefined;
  now: Date;
  surface: Surface;
  // getRememberedChoice(host), for «Glem valget».
  remembered?: RememberedChoice;
  env: ViewEnv;
}

const NBSP = ' ';

export function orgnrText(digits: string): OrgnrText {
  return { digits, spaced: formatOrgnr(digits).replace(/ /g, NBSP) };
}

// The display form of a site: www. and trailing dots dropped.
export function siteName(host: string): string {
  return registrableDomain(host) ?? host.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '');
}

// «STAVANGER» → «Stavanger», «MO I RANA» → «Mo i Rana». Only rewrites
// an all-caps name; anything already mixed case is left as brreg has it.
const SMALL_WORDS = new Set(['i', 'på', 'og', 'ved', 'under', 'over']);
export function titleCasePlace(place: string): string {
  if (place !== place.toUpperCase()) return place;
  return place
    .toLowerCase()
    .split(' ')
    .map((word, i) =>
      i > 0 && SMALL_WORDS.has(word)
        ? word
        : word.replace(/(^|-)(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase()),
    )
    .join(' ');
}

function formCity(enhet: Enhet): string | undefined {
  const form = enhet.organisasjonsform?.beskrivelse?.trim();
  const place =
    enhet.forretningsadresse?.poststed?.trim() ??
    enhet.postadresse?.poststed?.trim() ??
    enhet.forretningsadresse?.kommune?.trim();
  const city = place ? titleCasePlace(place) : undefined;
  const parts = [form, city].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function eyebrowFor(method: ResolutionMethod | undefined, host: string | undefined): string | undefined {
  if (!host) return undefined;
  if (method === 'url-param' || method === 'url-path') return COPY.eyebrowUrl;
  if (method === 'title') return COPY.eyebrowTitle;
  return undefined;
}

// The headline split around its stamp word, so the DOM stays one
// sentence («Nettstedet er ikke koblet til selskapet») while the word
// is set in the stamp's caps.
const MISMATCH_PRE = 'Nettstedet er';
const MISMATCH_WORD = 'ikke koblet';
const MISMATCH_REST = 'til selskapet';
const STAMP_WORDS = ['Konkurs', 'Slettet', 'Tvangsavvikling'];

export function stampOf(headline: string): StampText {
  if (headline === MISMATCH_HEADLINE) {
    return { pre: MISMATCH_PRE, word: MISMATCH_WORD, rest: MISMATCH_REST };
  }
  for (const word of STAMP_WORDS) {
    if (headline.startsWith(word)) {
      const rest = headline.slice(word.length).trim();
      return rest ? { word, rest } : { word };
    }
  }
  return { word: headline };
}

// The popup has no room for the registry's quote: a merknad in the
// answer is carried as a count («1 merknad i registeret»). The panel
// quotes it under the ledger.
function compactMerknad(answer: Answer, merknadCount: number): Answer {
  if (merknadCount === 0 || answer.tone === 'ok') return answer;
  const merknadTexts = new Set(
    answer.findings.filter((f) => f.source === 'merknad').map((f) => f.text),
  );
  const count = COPY.merknadCount(merknadCount);
  const out: Answer = { ...answer };
  if (merknadTexts.has(answer.headline)) out.headline = count;
  if (answer.supporting && merknadTexts.has(answer.supporting)) out.supporting = count;
  return out;
}

function koblingStated(answer: Answer, kobling: Kobling): boolean {
  if (kobling.kind === 'mismatch') return answer.headline === MISMATCH_HEADLINE;
  return answer.findings[0]?.source === 'kobling';
}

function koblingRow(
  kobling: Kobling,
  answer: Answer,
  opts: { canReject: boolean; rejectInBand: boolean; forget: boolean },
): LedgerRow {
  const row: LedgerRow = {
    key: 'kobling',
    label: kobling.label,
    tone: kobling.tone,
    value: kobling.value,
    actions: [],
  };
  if (kobling.detail) row.detail = kobling.detail;
  const stated = koblingStated(answer, kobling);
  const site = siteName(kobling.host);
  switch (kobling.kind) {
    case 'registered':
      // Under a stamp the site is already in the masthead and the
      // answer is about the company, not the site: short.
      if (answer.tone === 'danger') row.value = COPY.registeredShort;
      row.inline = true;
      break;
    case 'mismatch':
      if (stated && kobling.registeredDomain) {
        row.value = COPY.notSite(kobling.registeredDomain);
        delete row.detail;
        row.inline = true;
      }
      break;
    case 'name-guess':
      row.value = COPY.guessedFrom(hostnameLabel(kobling.host) ?? site);
      break;
    case 'other-site':
      if (stated) {
        row.value = COPY.foundViaName;
        row.detail = COPY.notRegisteredFor(site);
      }
      break;
    default:
      break;
  }
  if (opts.canReject && !opts.rejectInBand && kobling.kind !== 'mismatch') {
    row.actions.push({ kind: 'reject' });
  }
  if (opts.forget) row.actions.push({ kind: 'forget' });
  // Wherever the kobling itself is in doubt, the way to tell us sits
  // right under it (it is in the footer everywhere else).
  if (kobling.tone === 'warn' || kobling.tone === 'danger') row.actions.push({ kind: 'report' });
  return row;
}

function moneyGroup(label: string, value: number | undefined, valuta: string | undefined): TextPart[] | undefined {
  const money = formatMoney(value, valuta);
  if (!money) return undefined;
  return [
    { text: label, nowrap: true },
    { text: money, nowrap: true, negative: typeof value === 'number' && value < 0 },
  ];
}

// The latest filing's money, when it is the year the signal names.
function regnskapFigures(
  regnskap: RegnskapResponse | undefined,
  year: string,
): TextPart[][] | undefined {
  if (!regnskap || regnskap.unavailable) return undefined;
  const latest = sortRegnskapDesc(regnskap.items)[0];
  if (!latest) return undefined;
  const f = keyFigures(latest);
  if (f.year !== year) return undefined;
  const groups = [
    moneyGroup(COPY.omsetning, f.driftsinntekter, f.valuta),
    moneyGroup(COPY.resultat, f.aarsresultat, f.valuta),
  ].filter((g): g is TextPart[] => g !== undefined);
  return groups.length > 0 ? groups : undefined;
}

function signalRow(
  signal: Signal,
  company: CompanyData,
  kunngjoringer: string,
  answerTone: AnswerTone,
): LedgerRow {
  const row: LedgerRow = {
    key: signal.key,
    label: signal.label,
    tone: signal.tone,
    value: signal.value,
    actions: [],
  };
  switch (signal.key) {
    case 'status':
      if (signal.tone === 'danger') {
        // The stamp already carries the date: the row points at the
        // registry's own announcements instead, on the value's line.
        row.dangerValue = true;
        row.inline = true;
        row.actions.push({ kind: 'link', text: COPY.kunngjoringer, href: kunngjoringer });
      } else if (signal.detail) {
        row.aux = `· ${signal.detail}`;
      }
      break;
    case 'alder':
      if (signal.detail) row.aux = `· ${signal.detail}`;
      break;
    case 'ansatte':
      if (signal.detail === 'registrert') row.value = `${signal.value} registrert`;
      else if (signal.detail) row.aux = `· ${signal.detail}`;
      break;
    case 'regnskap': {
      if (signal.detail === 'levert') row.value = `${signal.value} levert`;
      else if (signal.detail) row.aux = `· ${signal.detail}`;
      // Under a stamp the row names the year only (P2): the money
      // lives in the panel's Økonomi tab, and the popup keeps its
      // 600 px.
      const figures =
        answerTone !== 'danger' && /^\d{4}$/.test(signal.value)
          ? regnskapFigures(company.regnskap, signal.value)
          : undefined;
      if (figures) row.figures = figures;
      break;
    }
    default:
      break;
  }
  return row;
}

// The spoof's «Om selskapet» line: true facts, no tone, no glyphs.
function factsLine(signals: Signal[]): TextPart[] {
  const groups: TextPart[][] = [];
  for (const s of signals) {
    switch (s.key) {
      case 'status':
        groups.push([{ text: s.value, strong: true }]);
        break;
      case 'alder':
        groups.push([{ text: s.value, strong: true }, ...(s.detail ? [{ text: `, ${s.detail}` }] : [])]);
        break;
      case 'ansatte':
        groups.push([{ text: s.value, strong: true }, { text: ' ansatte' }]);
        break;
      case 'regnskap':
        if (/^\d{4}$/.test(s.value)) {
          groups.push(
            s.detail === 'levert'
              ? [{ text: 'regnskap for ' }, { text: s.value, strong: true }, { text: ' levert' }]
              : [{ text: 'siste regnskap ' }, { text: s.value, strong: true }],
          );
        } else {
          groups.push([{ text: 'regnskap: ' }, { text: s.value.toLowerCase(), strong: true }]);
        }
        break;
      default:
        break;
    }
  }
  const out: TextPart[] = [];
  groups.forEach((g, i) => {
    if (i > 0) out.push({ text: ' · ' });
    out.push(...g);
  });
  return out;
}

// «Morselskap i et konsern med <b>55</b> selskaper», «Del av konsern:
// <b>EQUINOR ASA</b> (100 %)». Same words as konsernLine.
export function konsernParts(k: Konsern): TextPart[] {
  const line = konsernLine(k);
  const strong =
    k.role === 'top' ? (k.groupSize + 1).toLocaleString('nb-NO') : k.top.navn;
  const at = line.indexOf(strong);
  if (at < 0) return [{ text: line }];
  const parts: TextPart[] = [];
  if (at > 0) parts.push({ text: line.slice(0, at) });
  parts.push({ text: strong, strong: true });
  if (at + strong.length < line.length) parts.push({ text: line.slice(at + strong.length) });
  return parts;
}

const ENDRING_TITLE: Record<string, string> = {
  navn: 'Nytt navn',
  adresse: 'Ny forretningsadresse',
  'daglig-leder': 'Ny daglig leder',
  styre: 'Endret styre',
};

function registeredHref(domain: string): string {
  return `https://${domain}`;
}

export function buildTrustView(input: TrustViewInput): TrustView {
  const { company, method, host, now, surface, remembered, env } = input;
  const { enhet, roller, regnskap } = company;
  const orgnr = enhet.organisasjonsnummer;

  const kobling = deriveKobling({ method, host, enhet });
  const signals = deriveSignals(enhet, regnskap, now);
  const merknader = deriveMerknader(enhet);
  const answer = deriveAnswer({ enhet, roller, signals, kobling, merknader, now });
  const shownAnswer = surface === 'popup' ? compactMerknad(answer, merknader.length) : answer;

  const hostDerived = isHostDerived(method) && host !== undefined;
  const canReject = hostDerived;
  const spoof = kobling?.kind === 'mismatch' && answer.headline === MISMATCH_HEADLINE;
  const forgetSite = host && remembered ? siteName(host) : undefined;
  const backToSite = host && method === 'manual' ? siteName(host) : undefined;

  // --- answer
  const answerActions: AnswerAction[] = [];
  const koblingDoubt =
    shownAnswer.tone === 'warn' && answer.findings.some((f) => f.source === 'kobling');
  if (spoof && kobling) {
    const domain = kobling.registeredDomain ?? hjemmesideDomains(enhet.hjemmeside)[0];
    if (domain) {
      answerActions.push({ kind: 'goto', text: COPY.gotoSite(domain), href: registeredHref(domain) });
    }
    if (canReject) answerActions.push({ kind: 'reject', text: COPY.searchRightCompany });
  } else if (koblingDoubt && canReject) {
    answerActions.push({ kind: 'reject', text: COPY.rejectInBand });
  }
  const answerView: AnswerView = {
    tone: shownAnswer.tone,
    headline: shownAnswer.headline,
    actions: answerActions,
  };
  if (shownAnswer.supporting) answerView.supporting = shownAnswer.supporting;
  if (shownAnswer.tone === 'danger') answerView.stamp = stampOf(shownAnswer.headline);

  // --- ledger
  const kunngjoringer = kunngjoringerUrl(orgnr);
  const ledger: LedgerRow[] = [];
  if (kobling) {
    ledger.push(
      koblingRow(kobling, answer, {
        canReject,
        rejectInBand: answerActions.some((a) => a.kind === 'reject'),
        forget: forgetSite !== undefined,
      }),
    );
  }
  let facts: TextPart[] | undefined;
  if (spoof) {
    facts = factsLine(signals);
  } else {
    for (const s of signals) ledger.push(signalRow(s, company, kunngjoringer, shownAnswer.tone));
    // The popup keeps five rows: when a signal was omitted, næring
    // fills the gap (the panel has it under Registrering).
    const naering = enhet.naeringskode1?.beskrivelse?.trim();
    if (surface === 'popup' && ledger.length < 5 && naering) {
      ledger.push({ key: 'naering', label: COPY.naering, tone: 'neutral', value: naering, actions: [] });
    }
  }

  // --- identity
  const eyebrow = eyebrowFor(method, host);
  const identity: IdentityView = {
    name: enhet.navn,
    claim: spoof,
    orgnr: orgnrText(orgnr),
    brregUrl: brregUrl(orgnr),
    leaders: [],
    flags: '',
  };
  const fc = formCity(enhet);
  if (eyebrow) {
    identity.eyebrow = eyebrow;
    if (fc) identity.meta = fc;
  } else if (fc) {
    identity.over = fc;
  }
  // The popup's leaders line is a normal company's line (P1). Under a
  // stamp it would read as reassurance next to a konkurs, and on a
  // spoof the company is the site's claim, not its identity (P2, P4
  // carry no leaders; the bostyrer is in the stamp).
  if (surface === 'popup' && roller && answerView.tone !== 'danger') {
    const dagl = findRoleHolder(roller, 'DAGL');
    const lede = findRoleHolder(roller, 'LEDE');
    if (dagl) identity.leaders.push({ label: COPY.dagligLeder, name: dagl });
    if (lede) identity.leaders.push({ label: COPY.styreleder, name: lede });
  }
  if (surface === 'panel') {
    const primary = primaryStatusFlag(enhet);
    const secondary = deriveStatusFlags(enhet)
      .filter((f) => f !== primary && f.label !== primary.label)
      .map((f) => f.label);
    identity.flags = [...secondary, ...deriveRegistryFlags(enhet)].join(' · ');
  }
  if (company.avdeling) {
    identity.avdeling = COPY.avdeling(
      company.avdeling.navn,
      orgnrText(company.avdeling.organisasjonsnummer).spaced,
    );
  }

  // --- konsern, notes
  // On a spoof the group line would read as the site's credentials
  // (P4 carries none); the facts line already says what the company is.
  const konsern =
    company.konsern && !spoof ? { parts: konsernParts(company.konsern) } : undefined;
  const merknadViews: MerknadView[] = merknader.map((m) => {
    const since = formatDateNo(m.since);
    return since && m.since ? { text: m.text, since: { iso: m.since, text: since } } : { text: m.text };
  });
  const endringer: EndringView[] =
    surface === 'panel'
      ? deriveEndringer({ enhet, roller, feed: company.endringer, now }).map((e) => {
          const prev = /\(tidligere (.+)\)$/.exec(e.text)?.[1];
          const view: EndringView = {
            iso: e.date,
            date: formatDateNo(e.date) ?? e.date,
            title: ENDRING_TITLE[e.kind] ?? e.text,
          };
          if (prev) view.sub = `tidligere ${prev}`;
          return view;
        })
      : [];

  const view: TrustView = {
    surface,
    orgnr,
    identity,
    answer: answerView,
    ledger,
    merknader: surface === 'panel' ? merknadViews : [],
    endringer,
    canReject,
    fetchedAt: company.fetchedAt,
    reportHref: reportHref({
      host,
      orgnr,
      method,
      version: env.version,
      browser: env.browser,
    }),
    summary: buildSummary({
      enhet,
      answer,
      signals,
      ...(kobling ? { kobling } : {}),
      ...(roller ? { roller } : {}),
      fetchedAt: company.fetchedAt,
    }),
  };
  if (facts) view.facts = facts;
  if (konsern) view.konsern = konsern;
  if (forgetSite) view.forgetSite = forgetSite;
  if (backToSite) view.backToSite = backToSite;
  if (hostDerived) view.badgeTone = answer.tone;
  if (surface === 'panel') {
    view.dossier = buildDossier({
      company,
      signals,
      now,
      pdfUrl: aarsregnskapPdfUrl,
      kunngjoringer,
    });
  }
  return view;
}
