// The fact rows under the answer headline: status, alder, ansatte and
// regnskap, each derivable from data both surfaces already fetch. The
// fifth row, kobling, comes from kobling.ts.
//
//   STATUS    primary status (Aktiv / Konkurs / Rekonstruksjon / …) with
//             its date or reason when brreg has one
//   ALDER     years since founding (stiftelsesdato), else registration
//   ANSATTE   registered employee count (brreg gives «1–4» as a flag)
//   REGNSKAP  latest filed year (Enhet.sisteInnsendteAarsregnskap,
//             topped up by the regnskap response), judged against the
//             filing deadline
//
// Pure and unit-tested. A signal whose underlying data is unavailable
// is OMITTED, never guessed: a failed regnskap fetch must not render
// as "not filed". See docs/notes/trust.md § signals.

import { formatDateNumeric, parseIsoDate } from '../format.js';
import { sortRegnskapDesc } from '../regnskap.js';
import { primaryStatusFlag, type FlagSpec } from '../ui/flags.js';
import { ansatteLine } from '../ui/summary-lines.js';
import type { Enhet, RegnskapResponse } from '../../types/brreg.js';
import type { Signal, Tone } from './types.js';

// Org forms with an unconditional duty to file annual accounts with
// Regnskapsregisteret. Missing accounts are a caution signal only for
// these. Kept deliberately narrow: a false «Mangler» accusation is worse
// than a muted «Ingen».
const REGNSKAPSPLIKT_FORMS = new Set(['AS', 'ASA', 'SE', 'ASV', 'SPA']);

// Org forms that never send annual accounts to Regnskapsregisteret,
// whatever their size (regnskapsloven § 8-2 exempts
// enkeltpersonforetak). Nothing filed is the expected state, so the
// cell says so instead of a «Ingen» that reads like a failure. Other
// forms (ANS, DA, FLI, …) file only above thresholds; they keep the
// neutral «Ingen · ikke innsendt».
const NO_FILING_DUTY_FORMS: ReadonlyMap<string, string> = new Map([
  ['ENK', 'enkeltpersonforetak'],
]);

// Foreign entities registered in Norway. Their status cell says so,
// with the home country when brreg gives one.
const FOREIGN_FORMS = new Set(['NUF', 'UTLA']);

function formCode(enhet: Enhet): string {
  return enhet.organisasjonsform?.kode?.trim().toUpperCase() ?? '';
}

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

// Whole calendar months between an ISO date and `now` (the day of month
// must have come round); undefined when unparsable, 0 for the future.
export function monthsSince(
  iso: string | undefined,
  now: Date,
): number | undefined {
  const then = parseIsoDate(iso);
  if (!then) return undefined;
  let months =
    (now.getFullYear() - then.getFullYear()) * 12 +
    (now.getMonth() - then.getMonth());
  if (now.getDate() < then.getDate()) months -= 1;
  return months < 0 ? 0 : months;
}

// The newest accounting year whose filing deadline has passed. Annual
// accounts for a calendar year are due 31 July the year after, so from
// August the previous year is expected, before that the one before it.
export function expectedLatestFiledYear(now: Date): number {
  return now.getMonth() >= 7 ? now.getFullYear() - 1 : now.getFullYear() - 2;
}

export interface AgeBasis {
  iso: string;
  word: 'stiftet' | 'reg.';
}

// What the company's age is counted from. The founding date when brreg
// has it; otherwise the earliest registration. Enhetsregisteret starts
// in 1995, so registration alone floors every older company at "31 år
// · reg. 1995" (Equinor was founded in 1972).
export function ageBasis(enhet: Enhet): AgeBasis | undefined {
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

// "siden 26.08.2026" (konkurs/avvikling/rekonstruksjon), "mangler
// regnskap" (a forced dissolution: the reason beats the date),
// "15.09.2026" (slettet).
function statusDetail(flag: FlagSpec): string | undefined {
  if (flag.reason) return flag.reason;
  const date = formatDateNumeric(flag.since);
  if (!date) return undefined;
  return flag.label === 'Slettet' ? date : `siden ${date}`;
}

// «utenlandsk foretak (SK)». The governing-law country when brreg names
// one (UTLA); otherwise the forretningsadresse country, which for a NUF
// is often the Norwegian branch address (NO) or absent, and then says
// nothing about the home country.
function foreignDetail(enhet: Enhet): string | undefined {
  if (!FOREIGN_FORMS.has(formCode(enhet))) return undefined;
  const code = [
    enhet.underlagtLovgivningLandKode,
    enhet.forretningsadresse?.landkode,
  ]
    .map((c) => c?.trim().toUpperCase())
    .find((c) => c && c !== 'NO');
  return code ? `utenlandsk foretak (${code})` : 'utenlandsk foretak';
}

function statusSignal(enhet: Enhet): Signal {
  const primary = primaryStatusFlag(enhet);
  const tone: Tone = primary.severity ?? 'ok';
  const signal: Signal = {
    key: 'status',
    label: 'Status',
    value: primary.label,
    tone,
  };
  const detail =
    statusDetail(primary) ?? (tone === 'ok' ? foreignDetail(enhet) : undefined);
  if (detail) signal.detail = detail;
  return signal;
}

function alderSignal(enhet: Enhet, now: Date): Signal | undefined {
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
function ansatteSignal(enhet: Enhet): Signal | undefined {
  const value = ansatteLine(enhet);
  if (!value) return undefined;
  const signal: Signal = {
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
): Signal | undefined {
  const expected = expectedLatestFiledYear(now);
  const latestYear = latestFiledYear(enhet, regnskap);
  if (latestYear) {
    // Older than the newest year whose deadline has passed: the company
    // is late or has stopped filing — worth an amber.
    const stale = Number(latestYear) < expected;
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

  // Nothing filed.
  const form = formCode(enhet);
  const exempt = NO_FILING_DUTY_FORMS.get(form);
  if (exempt) {
    return {
      key: 'regnskap',
      label: 'Regnskap',
      value: 'Ikke pliktig',
      detail: exempt,
      tone: 'neutral',
    };
  }
  // Amber only when the form has an unconditional filing duty AND a
  // full accounting year's deadline has passed since the company began
  // (its first, partial year gets the benefit of the doubt).
  const basisYear = Number(ageBasis(enhet)?.iso.slice(0, 4));
  const shouldHaveFiled =
    REGNSKAPSPLIKT_FORMS.has(form) &&
    Number.isInteger(basisYear) &&
    basisYear < expected;
  return {
    key: 'regnskap',
    label: 'Regnskap',
    value: shouldHaveFiled ? 'Mangler' : 'Ingen',
    detail: shouldHaveFiled ? 'ingen innsendt' : 'ikke innsendt',
    tone: shouldHaveFiled ? 'warn' : 'neutral',
  };
}

// The signal rows in a stable order: status, alder, ansatte, regnskap
// (each after status only when its data is there).
export function deriveSignals(
  enhet: Enhet,
  regnskap: RegnskapResponse | undefined,
  now: Date = new Date(),
): Signal[] {
  const status = statusSignal(enhet);
  const signals: Signal[] = [status];
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
