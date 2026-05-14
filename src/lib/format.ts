import type { Adresse } from '../types/brreg.js';

export function formatAddress(addr: Adresse | undefined): string | undefined {
  if (!addr) return undefined;
  const lines = [
    ...(addr.adresse ?? []),
    [addr.postnummer, addr.poststed].filter(Boolean).join(' '),
    addr.land,
  ].filter((s): s is string => Boolean(s && s.trim()));
  return lines.length > 0 ? lines.join(', ') : undefined;
}

// Format an NOK amount as a compact human-friendly string. Brreg
// reports figures in plain kroner, so 37_877_000_000 → "37,9 mrd kr".
// Picks the largest unit that keeps the integer portion under 1000
// to avoid showing "37 877 mill kr" which is wider and harder to scan.
export function formatNok(value: number | undefined): string | undefined {
  if (value === undefined || value === null || Number.isNaN(value)) return undefined;
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const fmt = (n: number, digits: number): string =>
    n.toLocaleString('nb-NO', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  if (abs >= 1e9) return `${sign}${fmt(abs / 1e9, 1)} mrd kr`;
  if (abs >= 1e6) return `${sign}${fmt(abs / 1e6, 1)} mill kr`;
  if (abs >= 1e3) return `${sign}${fmt(abs / 1e3, 0)} tusen kr`;
  return `${sign}${fmt(abs, 0)} kr`;
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
