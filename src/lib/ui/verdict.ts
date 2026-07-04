// The verdict strip — the synthesized "kan jeg stole på dette firmaet?"
// answer rendered directly under the company name on both surfaces.
// Four signals, each derivable from data the surfaces already fetch:
//
//   STATUS    primary status (Aktiv / Konkurs / Slettet / …)
//   ALDER     years since Enhetsregisteret registration
//   ANSATTE   registered employee count
//   REGNSKAP  latest filed year in Regnskapsregisteret
//
// Derivation is pure (unit-tested); renderVerdict is the thin DOM
// writer. Signals whose underlying data is unavailable are OMITTED,
// never guessed — a failed regnskap fetch must not render as "not
// filed".

import { formatCount } from '../format.js';
import { sortRegnskapDesc } from '../regnskap.js';
import { primaryStatusFlag } from './flags.js';
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
  if (!iso) return undefined;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return undefined;
  let years = now.getFullYear() - then.getFullYear();
  const anniversary = new Date(then);
  anniversary.setFullYear(then.getFullYear() + years);
  if (anniversary > now) years -= 1;
  return years < 0 ? 0 : years;
}

function statusSignal(enhet: Enhet): VerdictSignal {
  const primary = primaryStatusFlag(enhet);
  const tone: VerdictTone =
    primary.severity === 'ok'
      ? 'ok'
      : primary.severity === 'warn'
        ? 'warn'
        : 'danger';
  return { key: 'status', label: 'Status', value: primary.label, tone };
}

function alderSignal(enhet: Enhet, now: Date): VerdictSignal | undefined {
  const reg = enhet.registreringsdatoEnhetsregisteret;
  const years = yearsSince(reg, now);
  if (years === undefined) return undefined;
  const regYear = reg!.slice(0, 4);
  if (years < 1) {
    // A brand-new registration is a genuine caution signal for a trust
    // assessment — not an accusation, so the wording stays factual.
    return {
      key: 'alder',
      label: 'Alder',
      value: 'Under 1 år',
      detail: `reg. ${regYear}`,
      tone: 'warn',
    };
  }
  return {
    key: 'alder',
    label: 'Alder',
    value: `${years} år`,
    detail: `reg. ${regYear}`,
    tone: 'neutral',
  };
}

function ansatteSignal(enhet: Enhet): VerdictSignal {
  const count = enhet.antallAnsatte;
  if (typeof count !== 'number' || count <= 0) {
    // Zero employees is normal for holdings and dormant entities —
    // stated, not judged.
    return {
      key: 'ansatte',
      label: 'Ansatte',
      value: 'Ingen',
      detail: 'registrert',
      tone: 'neutral',
    };
  }
  return {
    key: 'ansatte',
    label: 'Ansatte',
    value: formatCount(count)!,
    tone: 'neutral',
  };
}

function regnskapSignal(
  enhet: Enhet,
  regnskap: RegnskapResponse | undefined,
  now: Date,
): VerdictSignal | undefined {
  // Fetch failed → we don't know → no signal, never a false "Ingen".
  if (!regnskap) return undefined;

  if (regnskap.unsupportedPlan) {
    // Banks/insurance DID file; the public API just can't serialise the
    // specialised oppstillingsplan. That's a positive filing signal.
    return {
      key: 'regnskap',
      label: 'Regnskap',
      value: 'Levert',
      detail: 'spesialregnskap',
      tone: 'ok',
    };
  }

  const sorted = sortRegnskapDesc(regnskap.items);
  const latestYear = sorted[0]?.regnskapsperiode?.tilDato?.slice(0, 4);
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

  // Nothing filed. Only an amber signal when the form has an
  // unconditional filing duty AND the company is old enough to have
  // had a deadline.
  const form = enhet.organisasjonsform?.kode?.toUpperCase() ?? '';
  const age = yearsSince(enhet.registreringsdatoEnhetsregisteret, now);
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
  const signals: VerdictSignal[] = [statusSignal(enhet)];
  const alder = alderSignal(enhet, now);
  if (alder) signals.push(alder);
  signals.push(ansatteSignal(enhet));
  const regnskapSig = regnskapSignal(enhet, regnskap, now);
  if (regnskapSig) signals.push(regnskapSig);
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
      cell.appendChild(detail);
    }
    container.appendChild(cell);
  }
}
