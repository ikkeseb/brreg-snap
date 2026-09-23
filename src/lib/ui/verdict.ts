// The verdict strip — the synthesized "kan jeg stole på dette firmaet?"
// answer rendered directly under the company name on both surfaces.
// Four signals, each derivable from data the surfaces already fetch:
//
//   STATUS    primary status (Aktiv / Konkurs / Slettet / …), with its
//             date or reason when brreg has one
//   ALDER     years since founding (stiftelsesdato), else registration
//   ANSATTE   registered employee count (brreg gives «1–4» as a flag)
//   REGNSKAP  latest filed year (Enhet.sisteInnsendteAarsregnskap,
//             topped up by the regnskap response)
//
// Derivation is pure (unit-tested); renderVerdict is the thin DOM
// writer. Signals whose underlying data is unavailable are OMITTED,
// never guessed — a failed regnskap fetch must not render as "not
// filed".

import { formatDateNumeric, parseIsoDate } from '../format.js';
import { sortRegnskapDesc } from '../regnskap.js';
import { primaryStatusFlag, type FlagSpec } from './flags.js';
import { ansatteLine } from './summary-lines.js';
import type { Enhet, RegnskapResponse } from '../../types/brreg.js';

export type VerdictTone = 'ok' | 'warn' | 'danger' | 'neutral';

export interface VerdictSignal {
  key: 'status' | 'alder' | 'ansatte' | 'regnskap';
  label: string;
  value: string;
  detail?: string;
  tone: VerdictTone;
}

// Org forms with an unconditional plikt to file with Regnskapsregisteret.
// ENK and most small partnerships have no (public) filing duty, so a
// missing regnskap is only a caution signal for these forms. Kept
// deliberately narrow — a false "Mangler" accusation is worse than a
// muted "Ingen".
const REGNSKAPSPLIKT_FORMS = new Set(['AS', 'ASA', 'SE', 'ASV', 'SPA']);

// A company younger than this hasn't had a filing deadline yet.
const REGNSKAP_GRACE_YEARS = 2;

// Whole years between an ISO date and `now`; undefined when unparsable.
export function yearsSince(
  iso: string | undefined,
  now: Date,
): number | undefined {
  const then = parseIsoDate(iso);
  if (!then) return undefined;
  let years = now.getFullYear() - then.getFullYear();
  const anniversary = new Date(then);
  anniversary.setFullYear(then.getFullYear() + years);
  if (anniversary > now) years -= 1;
  return years < 0 ? 0 : years;
}

// "Konkurs · siden 26.08.2026", "Tvangsavvikling · mangler regnskap",
// "Slettet · 15.09.2026". A reason beats a date: the date of a forced
// dissolution matters less than why (and Oversikt carries both).
function statusDetail(flag: FlagSpec): string | undefined {
  if (flag.reason) return flag.reason;
  const date = formatDateNumeric(flag.since);
  if (!date) return undefined;
  return flag.label === 'Slettet' ? date : `siden ${date}`;
}

function statusSignal(enhet: Enhet): VerdictSignal {
  const primary = primaryStatusFlag(enhet);
  const tone: VerdictTone =
    primary.severity === 'ok'
      ? 'ok'
      : primary.severity === 'warn'
        ? 'warn'
        : 'danger';
  const signal: VerdictSignal = {
    key: 'status',
    label: 'Status',
    value: primary.label,
    tone,
  };
  const detail = statusDetail(primary);
  if (detail) signal.detail = detail;
  return signal;
}

// What the company's age is counted from. The founding date when brreg
// has it; otherwise the earliest registration. Enhetsregisteret starts
// in 1995, so registration alone floors every older company at "31 år
// · reg. 1995" (Equinor was founded in 1972).
function ageBasis(
  enhet: Enhet,
): { iso: string; word: 'stiftet' | 'reg.' } | undefined {
  if (enhet.stiftelsesdato && parseIsoDate(enhet.stiftelsesdato)) {
    return { iso: enhet.stiftelsesdato, word: 'stiftet' };
  }
  const registered = [
    enhet.registreringsdatoEnhetsregisteret,
    enhet.registreringsdatoForetaksregisteret,
  ]
    .filter((d): d is string => d !== undefined && parseIsoDate(d) !== undefined)
    .sort();
  return registered[0] ? { iso: registered[0], word: 'reg.' } : undefined;
}

function alderSignal(enhet: Enhet, now: Date): VerdictSignal | undefined {
  const basis = ageBasis(enhet);
  const years = yearsSince(basis?.iso, now);
  if (!basis || years === undefined) return undefined;
  const detail = `${basis.word} ${basis.iso.slice(0, 4)}`;
  if (years < 1) {
    // A brand-new company is a genuine caution signal for a trust
    // assessment — not an accusation, so the wording stays factual.
    return {
      key: 'alder',
      label: 'Alder',
      value: 'Under 1 år',
      detail,
      tone: 'warn',
    };
  }
  return {
    key: 'alder',
    label: 'Alder',
    value: `${years} år`,
    detail,
    tone: 'neutral',
  };
}

// Size is stated, never judged: no employees is normal for holdings and
// dormant entities. «Ingen» and «1–4» carry «registrert» because they
// come from the register's yes/no flag, not from a count.
function ansatteSignal(enhet: Enhet): VerdictSignal | undefined {
  const value = ansatteLine(enhet);
  if (!value) return undefined;
  const signal: VerdictSignal = {
    key: 'ansatte',
    label: 'Ansatte',
    value,
    tone: 'neutral',
  };
  if (value === 'Ingen' || value === '1–4') signal.detail = 'registrert';
  return signal;
}

const YEAR = /^\d{4}$/;

// Latest filed year from both sources. The Enhet carries it directly,
// so the cell doesn't hinge on the regnskap endpoint, which answers 500
// for every bank and insurer. The regnskap response can still be newer
// or be the only source; the later year wins.
function latestFiledYear(
  enhet: Enhet,
  regnskap: RegnskapResponse | undefined,
): string | undefined {
  const fromEnhet = enhet.sisteInnsendteAarsregnskap?.trim();
  const fromRegnskap = sortRegnskapDesc(regnskap?.items ?? [])[0]
    ?.regnskapsperiode?.tilDato?.slice(0, 4);
  const years = [fromEnhet, fromRegnskap].filter(
    (y): y is string => y !== undefined && YEAR.test(y),
  );
  return years.sort().at(-1);
}

function regnskapSignal(
  enhet: Enhet,
  regnskap: RegnskapResponse | undefined,
  now: Date,
): VerdictSignal | undefined {
  const latestYear = latestFiledYear(enhet, regnskap);
  if (latestYear) {
    // A filing older than two calendar years suggests the company has
    // stopped filing — worth an amber.
    const stale = Number(latestYear) < now.getFullYear() - 2;
    return {
      key: 'regnskap',
      label: 'Regnskap',
      value: latestYear,
      detail: stale ? 'siste innsendte' : 'levert',
      tone: stale ? 'warn' : 'ok',
    };
  }

  // No year anywhere. Fetch failed → we don't know → no signal, never
  // a false "Ingen".
  if (!regnskap) return undefined;

  if (regnskap.unavailable) {
    // brreg's open API answered 500. A named plan (BANK/FORS) proves a
    // filing exists; a bare 500 proves nothing either way.
    if (!regnskap.unsupportedPlan) return undefined;
    return {
      key: 'regnskap',
      label: 'Regnskap',
      value: 'Levert',
      detail: 'spesialregnskap',
      tone: 'ok',
    };
  }

  // Nothing filed. Only an amber signal when the form has an
  // unconditional filing duty AND the company is old enough to have
  // had a deadline.
  const form = enhet.organisasjonsform?.kode?.toUpperCase() ?? '';
  const age = yearsSince(ageBasis(enhet)?.iso, now);
  const shouldHaveFiled =
    REGNSKAPSPLIKT_FORMS.has(form) &&
    age !== undefined &&
    age >= REGNSKAP_GRACE_YEARS;
  return {
    key: 'regnskap',
    label: 'Regnskap',
    value: shouldHaveFiled ? 'Mangler' : 'Ingen',
    detail: shouldHaveFiled ? 'ingen innsendt' : 'ikke innsendt',
    tone: shouldHaveFiled ? 'warn' : 'neutral',
  };
}

export function deriveVerdict(
  enhet: Enhet,
  regnskap: RegnskapResponse | undefined,
  now: Date = new Date(),
): VerdictSignal[] {
  const status = statusSignal(enhet);
  const signals: VerdictSignal[] = [status];
  const alder = alderSignal(enhet, now);
  if (alder) signals.push(alder);
  const ansatte = ansatteSignal(enhet);
  if (ansatte) signals.push(ansatte);
  const regnskapSig = regnskapSignal(enhet, regnskap, now);
  if (regnskapSig) signals.push(regnskapSig);
  // A green "2024 levert" next to a red "Konkurs" reads as mixed
  // reassurance. Under a danger status, the other cells stay factual
  // but lose their green.
  if (status.tone === 'danger') {
    for (const s of signals) if (s !== status && s.tone === 'ok') s.tone = 'neutral';
  }
  return signals;
}

// DOM writer. Clears the container and paints one cell per signal.
export function renderVerdict(
  container: HTMLElement,
  signals: VerdictSignal[],
): void {
  container.replaceChildren();
  container.classList.add('verdict');
  for (const signal of signals) {
    const cell = document.createElement('div');
    cell.className = 'verdict-cell';
    cell.dataset.tone = signal.tone;

    const label = document.createElement('span');
    label.className = 'verdict-label';
    label.textContent = signal.label;
    cell.appendChild(label);

    const value = document.createElement('span');
    value.className = 'verdict-value';
    value.textContent = signal.value;
    // Ellipsised cells keep the full text reachable on hover.
    value.title = signal.value;
    cell.appendChild(value);

    if (signal.detail) {
      const detail = document.createElement('span');
      detail.className = 'verdict-detail';
      detail.textContent = signal.detail;
      detail.title = signal.detail;
      cell.appendChild(detail);
    }
    container.appendChild(cell);
  }
}
