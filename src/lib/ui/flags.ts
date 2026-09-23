import type { Enhet } from '../../types/brreg.js';

// Flag pill ("Konkurs", "MVA-registrert", …) shared by the popup result
// view (src/popup/popup.ts) and the sidebar header
// (src/details/render/header.ts) — one definition so the two surfaces
// can't drift on flag markup or on which flags exist.
//
// `kind` drives visual hierarchy: status pills (konkurs/avvikling — the
// thing a user actually scans for) stay filled and coloured, while
// 'registry' membership facts (MVA, Foretaks-, Stiftelses-,
// Frivillighetsregistret) render as quiet outlines so they recede.
//
// The PRIMARY status (most severe) is carried by the verdict strip
// (src/lib/ui/verdict.ts), so renderFlags omits it by default and the
// pill row shows only secondary statuses (rare combos like konkurs +
// under avvikling) plus the registry memberships.
export interface FlagSpec {
  label: string;
  severity?: 'ok' | 'warn' | 'danger';
  // When a negative status took effect (ISO date), if brreg says.
  since?: string;
  // Why, for a forced dissolution ("mangler regnskap").
  reason?: string;
}

// Forced-dissolution reasons. brreg sets one date field per reason; the
// first present one names the status. Order = most common first.
const TVANG_REASONS: ReadonlyArray<[keyof Enhet, string]> = [
  ['tvangsopplostPgaManglendeRegnskapDato', 'mangler regnskap'],
  ['tvangsopplostPgaManglendeDagligLederDato', 'mangler daglig leder'],
  ['tvangsopplostPgaManglendeRevisorDato', 'mangler revisor'],
  ['tvangsopplostPgaMangelfulltStyreDato', 'mangelfullt styre'],
  ['tvangsavvikletPgaManglendeSlettingDato', 'manglende sletting'],
];

function tvangFlag(enhet: Enhet): FlagSpec {
  const flag: FlagSpec = { label: 'Tvangsavvikling', severity: 'danger' };
  for (const [field, reason] of TVANG_REASONS) {
    const date = enhet[field];
    if (typeof date === 'string' && date) {
      flag.since = date;
      flag.reason = reason;
      break;
    }
  }
  return flag;
}

// A flag with its date attached only when brreg has one, so the spec
// stays minimal (and equality-comparable) for undated statuses.
function dated(flag: FlagSpec, since: string | undefined): FlagSpec {
  return since ? { ...flag, since } : flag;
}

// Status-pill derivation shared by both surfaces. Slettet is checked
// first: a deleted entity comes back as a minimal SlettetEnhet body
// where the konkurs/avvikling booleans are absent, so any derivation
// that only looks at those would fall through to "Aktiv".
export function deriveStatusFlags(enhet: Enhet): FlagSpec[] {
  const slettet = Boolean(enhet.slettedato);
  const negativeStatus =
    slettet ||
    enhet.konkurs ||
    enhet.underAvvikling ||
    enhet.underTvangsavviklingEllerTvangsopplosning;
  const flags: FlagSpec[] = [];
  if (!negativeStatus) flags.push({ label: 'Aktiv', severity: 'ok' });
  if (slettet) {
    flags.push(dated({ label: 'Slettet', severity: 'danger' }, enhet.slettedato));
  }
  if (enhet.konkurs) {
    flags.push(dated({ label: 'Konkurs', severity: 'danger' }, enhet.konkursdato));
  }
  if (enhet.underAvvikling) {
    flags.push(
      dated({ label: 'Under avvikling', severity: 'warn' }, enhet.underAvviklingDato),
    );
  }
  if (enhet.underTvangsavviklingEllerTvangsopplosning) flags.push(tvangFlag(enhet));
  return flags;
}

const SEVERITY_RANK: Record<NonNullable<FlagSpec['severity']>, number> = {
  danger: 3,
  warn: 2,
  ok: 1,
};

// The single most severe status — what the verdict strip displays.
// Ties keep derivation order (slettet before konkurs, etc.).
export function primaryStatusFlag(enhet: Enhet): FlagSpec {
  return pickPrimary(deriveStatusFlags(enhet));
}

function pickPrimary(flags: FlagSpec[]): FlagSpec {
  let primary = flags[0]!;
  for (const flag of flags) {
    if (
      SEVERITY_RANK[flag.severity ?? 'ok'] >
      SEVERITY_RANK[primary.severity ?? 'ok']
    ) {
      primary = flag;
    }
  }
  return primary;
}

// Registry memberships in fixed order — quiet outline pills.
export function deriveRegistryFlags(enhet: Enhet): string[] {
  const labels: string[] = [];
  if (enhet.registrertIMvaregisteret) labels.push('MVA-registrert');
  if (enhet.registrertIForetaksregisteret) labels.push('Foretaksregisteret');
  if (enhet.registrertIStiftelsesregisteret)
    labels.push('Stiftelsesregisteret');
  if (enhet.registrertIFrivillighetsregisteret)
    labels.push('Frivillighetsregisteret');
  return labels;
}

export function makeFlag(
  label: string,
  severity?: 'ok' | 'warn' | 'danger',
  kind: 'status' | 'registry' = 'status',
): HTMLElement {
  const el = document.createElement('span');
  el.className = 'flag';
  if (severity) el.dataset.severity = severity;
  if (kind === 'registry') el.dataset.kind = 'registry';
  el.textContent = label;
  return el;
}

export interface RenderFlagsOptions {
  // The verdict strip already shows the primary status, so the pill row
  // drops it by default. Pass false on a surface without a verdict.
  omitPrimaryStatus?: boolean;
}

// One shared pill-row writer: secondary status pills + registry pills.
// Clears the container; hides it when nothing is left to show.
export function renderFlags(
  container: HTMLElement,
  enhet: Enhet,
  opts: RenderFlagsOptions = {},
): void {
  const omitPrimary = opts.omitPrimaryStatus ?? true;
  container.replaceChildren();
  let statusFlags = deriveStatusFlags(enhet);
  if (omitPrimary) {
    // Drop exactly one instance — the same element pickPrimary chose
    // from this very array (identity-safe; a label filter would also
    // work but this can never drift from the picker's tie-breaking).
    const primary = pickPrimary(statusFlags);
    statusFlags = statusFlags.filter((f) => f !== primary);
  }
  for (const flag of statusFlags) {
    container.appendChild(makeFlag(flag.label, flag.severity));
  }
  for (const label of deriveRegistryFlags(enhet)) {
    container.appendChild(makeFlag(label, undefined, 'registry'));
  }
  container.hidden = container.childNodes.length === 0;
}
