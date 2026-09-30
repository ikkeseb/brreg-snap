// The one-line answer at the top of both surfaces, and the findings
// under it. Priority (docs/notes/trust.md § answer-priority):
//
//   (a) a danger status (konkurs, slettet, tvangsavvikling) heads the
//       view, with the bostyrer as the supporting line when there is one
//   (b) a site that claims the company while the registry lists another
//       website (kobling 'mismatch')
//   (c) warn findings, in this order: status (avvikling,
//       rekonstruksjon), each merknad, an uncertain kobling, a company
//       under a year old, regnskap. One → it is the headline; more →
//       «<n> ting å merke seg»
//   (d) otherwise «Ingen varsler i registeret»
//
// Endringer are neutral information and never raise the tone: a big
// company's board changes all the time. They are not an input here.

import { formatDateNo } from '../format.js';
import { findRoleHolder } from '../roller.js';
import { primaryStatusFlag, type FlagSpec } from '../ui/flags.js';
import type { Enhet, RollerResponse } from '../../types/brreg.js';
import { firstSentence } from './merknader.js';
import { ageBasis, monthsSince } from './signals.js';
import type { Answer, Finding, Kobling, Merknad, Signal } from './types.js';

export const NO_WARNINGS_HEADLINE = 'Ingen varsler i registeret';
export const MISMATCH_HEADLINE = 'Nettstedet er ikke koblet til selskapet';
const ANYONE_CAN_PASTE = 'Hvem som helst kan skrive et org.nr på siden sin.';

// «Konkurs siden 26. aug. 2026», «Slettet 15. sep. 2026»,
// «Tvangsavvikling – mangler regnskap», «Under avvikling siden 3. mars
// 2026», «Under rekonstruksjon siden 2. sep. 2026». Undated forms drop
// «siden».
function statusText(flag: FlagSpec): string {
  const date = formatDateNo(flag.since);
  switch (flag.label) {
    case 'Slettet':
      return date ? `Slettet ${date}` : 'Slettet';
    case 'Tvangsavvikling':
      return flag.reason ? `Tvangsavvikling – ${flag.reason}` : 'Tvangsavvikling';
    case 'Rekonstruksjon':
      return date ? `Under rekonstruksjon siden ${date}` : 'Under rekonstruksjon';
    default:
      return date ? `${flag.label} siden ${date}` : flag.label;
  }
}

function statusFinding(enhet: Enhet): Finding | undefined {
  const primary = primaryStatusFlag(enhet);
  if (primary.severity !== 'danger' && primary.severity !== 'warn') return undefined;
  return { tone: primary.severity, source: 'status', text: statusText(primary) };
}

function mismatchFinding(kobling: Kobling | undefined): Finding | undefined {
  if (kobling?.kind !== 'mismatch') return undefined;
  // kobling.ts owns how loud a mismatch is; it is at least a warning.
  const tone = kobling.tone === 'danger' ? 'danger' : 'warn';
  return { tone, source: 'kobling', text: MISMATCH_HEADLINE };
}

function mismatchSupporting(kobling: Kobling): string {
  return kobling.registeredDomain
    ? `Registrert hjemmeside er ${kobling.registeredDomain}. ${ANYONE_CAN_PASTE}`
    : ANYONE_CAN_PASTE;
}

// A match the resolver couldn't tie to the company's own website.
function uncertainKoblingFinding(kobling: Kobling | undefined): Finding | undefined {
  if (kobling?.kind === 'name-guess') {
    return { tone: 'warn', source: 'kobling', text: `Usikker kobling til ${kobling.host}` };
  }
  if (kobling?.kind === 'other-site') {
    const text = kobling.registeredDomain
      ? `Registrert hjemmeside er ${kobling.registeredDomain}`
      : 'Registrert hjemmeside er et annet nettsted';
    return { tone: 'warn', source: 'kobling', text };
  }
  return undefined;
}

// The registry's words, cut to their first sentence for a one-line
// finding; the full text stays in the merknader list.
function merknadFindings(merknader: Merknad[]): Finding[] {
  return merknader.map((m) => ({
    tone: 'warn',
    source: 'merknad',
    text: firstSentence(m.text),
  }));
}

// «Stiftet for 5 måneder siden» / «Registrert for 1 måned siden».
function alderFinding(
  enhet: Enhet,
  signals: Signal[],
  now: Date,
): Finding | undefined {
  if (signals.find((s) => s.key === 'alder')?.tone !== 'warn') return undefined;
  const basis = ageBasis(enhet);
  const months = monthsSince(basis?.iso, now);
  if (!basis || months === undefined) return undefined;
  const verb = basis.word === 'stiftet' ? 'Stiftet' : 'Registrert';
  const ago =
    months === 0 ? 'under 1 måned' : months === 1 ? '1 måned' : `${months} måneder`;
  return { tone: 'warn', source: 'alder', text: `${verb} for ${ago} siden` };
}

// The regnskap signal is either a stale year («2023 · siste innsendte»)
// or «Mangler» when it warns.
function regnskapFinding(signals: Signal[]): Finding | undefined {
  const s = signals.find((x) => x.key === 'regnskap');
  if (s?.tone !== 'warn') return undefined;
  const text = /^\d{4}$/.test(s.value)
    ? `Siste innsendte regnskap er fra ${s.value}`
    : 'Ingen årsregnskap er sendt inn';
  return { tone: 'warn', source: 'regnskap', text };
}

export interface AnswerInput {
  enhet: Enhet;
  // undefined: the roller fetch failed (no bostyrer line then).
  roller: RollerResponse | undefined;
  // deriveSignals' output: alder and regnskap findings follow its tones,
  // so a signal that was omitted can't produce a finding.
  signals: Signal[];
  // undefined when the company wasn't found from the site (manual
  // search, recents): there is no site to relate it to.
  kobling: Kobling | undefined;
  merknader: Merknad[];
  now: Date;
}

export function deriveAnswer({
  enhet,
  roller,
  signals,
  kobling,
  merknader,
  now,
}: AnswerInput): Answer {
  const status = statusFinding(enhet);
  const danger = status?.tone === 'danger' ? status : undefined;
  const mismatch = mismatchFinding(kobling);
  const warns = [
    status?.tone === 'warn' ? status : undefined,
    ...merknadFindings(merknader),
    uncertainKoblingFinding(kobling),
    alderFinding(enhet, signals, now),
    regnskapFinding(signals),
  ].filter((f): f is Finding => f !== undefined);
  const findings = [danger, mismatch, ...warns].filter(
    (f): f is Finding => f !== undefined,
  );

  if (danger) {
    const answer: Answer = { tone: 'danger', headline: danger.text, findings };
    const bostyrer = roller ? findRoleHolder(roller, 'BOBE') : undefined;
    if (bostyrer) answer.supporting = `Bostyrer: ${bostyrer}`;
    return answer;
  }
  if (mismatch && kobling) {
    return {
      tone: mismatch.tone,
      headline: mismatch.text,
      supporting: mismatchSupporting(kobling),
      findings,
    };
  }
  const [first] = warns;
  if (first && warns.length === 1) {
    return { tone: 'warn', headline: first.text, findings };
  }
  if (first) {
    return {
      tone: 'warn',
      headline: `${warns.length} ting å merke seg`,
      supporting: first.text,
      findings,
    };
  }
  return { tone: 'ok', headline: NO_WARNINGS_HEADLINE, findings: [] };
}
