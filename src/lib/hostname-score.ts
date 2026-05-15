// Pure scoring + utilities for hostname → brreg resolution. No network
// access, no storage — depends only on the candidate shape returned
// from brreg's /enheter endpoint. See docs/notes/resolution.md for the
// pipeline overview.

// Fold Nordic letters to ASCII: Ø→O, Å→A, Æ→AE (and lowercase). Brreg
// stores names with Nordic letters; hostnames cannot carry them. The
// label is therefore always ASCII. Without folding, "elkjop" would
// never match "ELKJØP NORGE AS".
export function foldNordic(s: string): string {
  return s
    .replace(/Ø/g, 'O')
    .replace(/ø/g, 'o')
    .replace(/Å/g, 'A')
    .replace(/å/g, 'a')
    .replace(/Æ/g, 'AE')
    .replace(/æ/g, 'ae');
}

// Hostnames are ASCII; brreg search does NOT auto-fold Nordic letters
// (?navn=elkjop returns 0, ?navn=elkjøp returns ELKJØP NORGE AS).
// Generate variants by substituting one "o"→"ø" or "a"→"å" per
// position, plus "ae"→"æ" / "aa"→"å" when present. Capped at one
// substitution per position so the set stays small.
export function generateNordicVariants(label: string): string[] {
  const out = new Set<string>([label]);
  for (let i = 0; i < label.length; i++) {
    if (label[i] === 'o') {
      out.add(label.slice(0, i) + 'ø' + label.slice(i + 1));
    }
    if (label[i] === 'a') {
      out.add(label.slice(0, i) + 'å' + label.slice(i + 1));
    }
  }
  if (label.includes('ae')) out.add(label.replace(/ae/g, 'æ'));
  if (label.includes('aa')) out.add(label.replace(/aa/g, 'å'));
  return [...out];
}

// Pull the brandable part out of a hostname for use as a search label.
// `www.yara.com` → `yara`, `shop.mestergruppen.no` → `mestergruppen`,
// `nrk.no` → `nrk`. Strips `www.` and the TLD segment, then takes the
// rightmost remaining label. Returns undefined if the result is empty
// or shorter than 2 chars (would match too much).
export function hostnameLabel(hostname: string): string | undefined {
  const stripped = hostname.replace(/^www\./i, '').toLowerCase();
  const parts = stripped.split('.');
  if (parts.length < 2) return undefined;
  const base = parts[parts.length - 2];
  if (!base || base.length < 2) return undefined;
  return base;
}
