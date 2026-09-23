// Recent changes worth knowing about: a new name or business address in
// the last six months, a new daglig leder or board in the last 90 days.
// Neutral information: a big company's board changes all the time, so
// these never raise the answer's tone. See docs/notes/trust.md
// § endringer.
//
//   navn          Enhet.historiskeNavn, the newest tilDato
//   adresse       the change feed (fetchEndringer): an event that
//                 changes forretningsadresse's street, postcode or place
//   daglig-leder  the DAGL rollegruppe's sistEndret
//   styre         the STYR rollegruppe's sistEndret
//
// The feed is the only extra request. Without it (not asked, or the
// fetch failed) the address item is left out and the rest still shows.

import { formatDateNo, parseIsoDate } from '../format.js';
import type {
  Enhet,
  EnhetOppdatering,
  JsonPatchOp,
  RollerResponse,
} from '../../types/brreg.js';
import type { Endring, EndringKind } from './types.js';

export const NAVN_ADRESSE_WINDOW_DAYS = 183;
export const ROLLER_WINDOW_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

// The `dato` to ask the change feed from: the start of the name/address
// window, as the full ISO timestamp brreg requires.
export function endringerSince(now: Date): string {
  return new Date(now.getTime() - NAVN_ADRESSE_WINDOW_DAYS * DAY_MS).toISOString();
}

// Local calendar date (YYYY-MM-DD) of a brreg date or timestamp.
// historiskeNavn uses "2026-09-01 12:29:08" (local time), roller a bare
// date, the feed a UTC timestamp — which is the next local day when
// published late in the evening.
function localDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const bare = /^(\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.exec(value.trim());
  const date = parseIsoDate(bare ? bare[1] : value);
  if (!date) return undefined;
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}

// Whole days from `date` (YYYY-MM-DD) to today, by calendar date.
function daysAgo(date: string, now: Date): number {
  const then = parseIsoDate(date)!;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Rounded: a DST switch makes a calendar day 23 or 25 hours.
  return Math.round((today.getTime() - then.getTime()) / DAY_MS);
}

// The earliest registration date: a change dated on or before it is the
// company being set up, not a change.
function registeredOn(enhet: Enhet): string | undefined {
  return [
    localDate(enhet.registreringsdatoEnhetsregisteret),
    localDate(enhet.registreringsdatoForetaksregisteret),
  ]
    .filter((d): d is string => d !== undefined)
    .sort()[0];
}

interface Span {
  now: Date;
  registered: string | undefined;
}

// Within `days` (a day of clock skew into the future tolerated) and
// after registration.
function isRecent(date: string, days: number, w: Span): boolean {
  const ago = daysAgo(date, w.now);
  if (ago > days || ago < -1) return false;
  return w.registered === undefined || date > w.registered;
}

function navnEndring(enhet: Enhet, w: Span): Endring | undefined {
  let latest: { date: string; navn: string | undefined } | undefined;
  for (const h of enhet.historiskeNavn ?? []) {
    const date = localDate(h.tilDato);
    if (!date || !isRecent(date, NAVN_ADRESSE_WINDOW_DAYS, w)) continue;
    if (!latest || date > latest.date) latest = { date, navn: h.navn?.trim() || undefined };
  }
  if (!latest) return undefined;
  const when = formatDateNo(latest.date)!;
  return {
    kind: 'navn',
    date: latest.date,
    text: latest.navn ? `Nytt navn ${when} (tidligere ${latest.navn})` : `Nytt navn ${when}`,
  };
}

// A move: the street, postcode or place changed, or the address was
// added. A kommune renumbering alone is not a move, and removing the
// whole address is the deletion event, not a new address.
const ADDRESS_PATH = /^\/forretningsadresse(?:\/(?:adresse|postnummer|poststed)(?:\/|$)|$)/;

function isAddressChange(change: JsonPatchOp): boolean {
  if (!ADDRESS_PATH.test(change.path)) return false;
  return !(change.path === '/forretningsadresse' && change.op === 'remove');
}

function adresseEndring(
  feed: EnhetOppdatering[] | undefined,
  w: Span,
): Endring | undefined {
  let latest: string | undefined;
  for (const event of feed ?? []) {
    if (!event.endringer?.some(isAddressChange)) continue;
    const date = localDate(event.dato);
    if (!date || !isRecent(date, NAVN_ADRESSE_WINDOW_DAYS, w)) continue;
    if (!latest || date > latest) latest = date;
  }
  if (!latest) return undefined;
  return {
    kind: 'adresse',
    date: latest,
    text: `Ny forretningsadresse ${formatDateNo(latest)!}`,
  };
}

function rolleEndring(
  roller: RollerResponse | undefined,
  group: 'DAGL' | 'STYR',
  kind: EndringKind,
  label: string,
  w: Span,
): Endring | undefined {
  const g = roller?.rollegrupper?.find((r) => r.type?.kode === group);
  const date = localDate(g?.sistEndret);
  if (!date || !isRecent(date, ROLLER_WINDOW_DAYS, w)) return undefined;
  return { kind, date, text: `${label} ${formatDateNo(date)!}` };
}

export interface EndringerInput {
  enhet: Enhet;
  // undefined: the roller fetch failed, so no role items.
  roller: RollerResponse | undefined;
  // undefined: the change feed wasn't fetched or failed, so no address
  // item.
  feed: EnhetOppdatering[] | undefined;
  now: Date;
}

// At most one item per kind (the newest), newest first.
export function deriveEndringer({ enhet, roller, feed, now }: EndringerInput): Endring[] {
  const w: Span = { now, registered: registeredOn(enhet) };
  const items = [
    navnEndring(enhet, w),
    adresseEndring(feed, w),
    rolleEndring(roller, 'DAGL', 'daglig-leder', 'Daglig leder endret', w),
    rolleEndring(roller, 'STYR', 'styre', 'Styret endret', w),
  ].filter((e): e is Endring => e !== undefined);
  // Stable: equal dates keep the order above.
  return items.sort((a, b) => b.date.localeCompare(a.date));
}
