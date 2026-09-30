import type { Enhet } from '../../types/brreg.js';

// Status flags («Konkurs», «Under avvikling», …) and registry
// memberships («MVA-registrert», …) derived from an Enhet. Pure: the
// trust signals (src/lib/trust/signals.ts) take the primary status
// from here, the identity's quiet flags line (trust-view.ts) the rest.
export interface FlagSpec {
  label: string;
  severity?: 'ok' | 'warn' | 'danger';
  // When a negative status took effect (ISO date), if brreg says.
  since?: string;
  // Why, for a forced dissolution ("mangler regnskap").
  reason?: string;
}

// Forced-dissolution reasons. brreg sets one date field per reason, so
// the field that is present says why; if several are, the first wins.
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
  // brreg marks rekonstruksjonsforhandling with a date field only.
  const rekonstruksjon = Boolean(enhet.underRekonstruksjonsforhandlingDato);
  const negativeStatus =
    slettet ||
    enhet.konkurs ||
    enhet.underAvvikling ||
    enhet.underTvangsavviklingEllerTvangsopplosning ||
    rekonstruksjon;
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
  if (rekonstruksjon) {
    flags.push(
      dated(
        { label: 'Rekonstruksjon', severity: 'warn' },
        enhet.underRekonstruksjonsforhandlingDato,
      ),
    );
  }
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
