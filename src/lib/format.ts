import type { Adresse, Kode } from '../types/brreg.js';

// "Konsulentvirksomhet … (62.020)" — pairs the NACE description with its
// code so the user can cross-reference the official register. Falls back
// to whichever field exists (description-only, or bare code).
export function formatNaering(kode: Kode | undefined): string | undefined {
  if (!kode) return undefined;
  const desc = kode.beskrivelse?.trim();
  const digits = kode.kode?.trim();
  if (desc && digits) return `${desc} (${digits})`;
  return desc || digits || undefined;
}

// Whole-percent string in nb-NO with a non-breaking space before the
// sign ("42 %", "-25 %"). Returns undefined for nullish/NaN so addRow
// skips it. Builds the sign with an ASCII '-' (same convention as
// formatMoney) rather than letting Intl emit a U+2212 minus, so the
// money and % figures share the same minus glyph in the UI.
export function formatPercent(value: number | undefined): string | undefined {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return undefined;
  }
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}${Math.abs(rounded).toLocaleString('nb-NO')}\u00a0%`;
}

export function formatAddress(addr: Adresse | undefined): string | undefined {
  if (!addr) return undefined;
  const lines = [
    ...(addr.adresse ?? []),
    [addr.postnummer, addr.poststed].filter(Boolean).join(' '),
    addr.land,
  ].filter((s): s is string => Boolean(s && s.trim()));
  return lines.length > 0 ? lines.join(', ') : undefined;
}

// Magnitude units, largest first. Two tiers get one decimal ("37,9
// mrd"); tusen and plain amounts are whole numbers.
const MONEY_UNITS = [
  { size: 1e9, word: ' mrd', digits: 1 },
  { size: 1e6, word: ' mill', digits: 1 },
  { size: 1e3, word: ' tusen', digits: 0 },
  { size: 1, word: '', digits: 0 },
] as const;

// "37,9 mrd" / "850 tusen" / "500": the number and magnitude word, no
// currency. Picks the largest unit that keeps the integer part under
// 1000 AFTER rounding — 999 500 must read "1,0 mill", not "1 000 tusen".
function formatMagnitude(value: number | undefined): string | undefined {
  if (value === undefined || value === null || Number.isNaN(value)) return undefined;
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  let i = MONEY_UNITS.findIndex((u) => abs >= u.size);
  if (i === -1) i = MONEY_UNITS.length - 1;
  // toFixed rounds half-up on the exact binary value, like Intl's
  // default, so this predicts the digits Intl is about to print.
  while (i > 0) {
    const u = MONEY_UNITS[i]!;
    if (Number((abs / u.size).toFixed(u.digits)) < 1000) break;
    i--;
  }
  const unit = MONEY_UNITS[i]!;
  const text = (abs / unit.size).toLocaleString('nb-NO', {
    minimumFractionDigits: unit.digits,
    maximumFractionDigits: unit.digits,
  });
  return `${sign}${text}${unit.word}`;
}

// A regnskap's figures are in its `valuta`: NOK for most filers, but
// companies reporting in a functional currency file in USD or EUR
// (Equinor, Aker BP, Mowi). "kr" is right only for NOK; anything else
// gets its ISO code so 67 956 000 000 USD never reads as kroner.
function isNok(valuta: string | undefined): boolean {
  return !valuta || valuta.toUpperCase() === 'NOK';
}

// Compact money string: 37_877_000_000 → "37,9 mrd kr", or with a
// foreign valuta "68,0 mrd USD". Undefined for nullish/NaN so addRow
// skips it.
export function formatMoney(
  value: number | undefined,
  valuta?: string,
): string | undefined {
  const amount = formatMagnitude(value);
  if (amount === undefined) return undefined;
  return `${amount} ${isNok(valuta) ? 'kr' : valuta!.toUpperCase()}`;
}

// formatMoney without the " kr" suffix, for the dense multi-year trend
// table, where every cell is monetary: repeating "kr" 9× adds noise and
// makes "63,4 mrd kr" wrap in a narrow side panel. The magnitude word
// stays, so figures remain unambiguous. A foreign currency keeps its
// code — dropping it would silently relabel USD as kroner.
export function formatMoneyCompact(
  value: number | undefined,
  valuta?: string,
): string | undefined {
  return isNok(valuta) ? formatMagnitude(value) : formatMoney(value, valuta);
}

// brreg dates are date-only ISO strings ("2002-09-12"). `new Date()`
// reads those as UTC midnight, which is the previous calendar day
// anywhere west of UTC — so date-only input becomes LOCAL midnight here.
// Other ISO forms parse as before. Undefined for missing/invalid input.
export function parseIsoDate(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const date = new Date(y, mo, d);
  // new Date(y, m, d) rolls "2002-13-45" over instead of failing.
  if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) {
    return undefined;
  }
  return date;
}

// ISO date ("2002-09-12") → "12. sep. 2002". brreg serialises dates as
// ISO strings; raw ISO in the UI forces the reader to re-parse it.
// Returns undefined for missing/unparsable input so addRow skips it.
export function formatDateNo(iso: string | undefined): string | undefined {
  const date = parseIsoDate(iso);
  if (!date) return undefined;
  return date.toLocaleDateString('nb-NO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ISO date → "26.08.2026": the compact form for a verdict cell, where
// "26. aug. 2026" would be cut off. Undefined for missing/invalid input.
export function formatDateNumeric(iso: string | undefined): string | undefined {
  const date = parseIsoDate(iso);
  if (!date) return undefined;
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${date.getFullYear()}`;
}

// "3 registrerte." / "1 registrert." — or "Viser 100 av 133." when a
// list is a capped page, so it never passes for the full count.
export function formatListCount(shown: number, total: number): string {
  if (total > shown) {
    return `Viser ${formatCount(shown)} av ${formatCount(total)}.`;
  }
  return `${formatCount(shown)} registrert${shown === 1 ? '' : 'e'}.`;
}

// Integer with nb-NO thousands separators ("7 536"). Returns undefined
// for nullish/NaN so addRow skips it.
export function formatCount(value: number | undefined): string | undefined {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return undefined;
  }
  return value.toLocaleString('nb-NO');
}

// "akkurat nå" / "for 3 min siden" / "i dag kl 14:32" / "i går kl 14:32".
// For anything older than yesterday: full date + time. Used by the
// footer's "Oppdatert: ..." label.
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const diffMs = now - timestamp;
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 45) return 'akkurat nå';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `for ${diffMin} min siden`;
  const then = new Date(timestamp);
  const today = new Date(now);
  const hhmm = then.toLocaleTimeString('nb-NO', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const sameDay =
    then.getFullYear() === today.getFullYear() &&
    then.getMonth() === today.getMonth() &&
    then.getDate() === today.getDate();
  if (sameDay) return `i dag kl ${hhmm}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const sameYesterday =
    then.getFullYear() === yesterday.getFullYear() &&
    then.getMonth() === yesterday.getMonth() &&
    then.getDate() === yesterday.getDate();
  if (sameYesterday) return `i går kl ${hhmm}`;
  return then.toLocaleDateString('nb-NO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
