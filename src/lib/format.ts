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
