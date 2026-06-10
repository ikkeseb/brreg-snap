// Mod-11 check digit for Norwegian organisasjonsnummer.
//
// Standalone module: consumed by orgnr.ts (URL/title resolution) and
// details.ts (validating ?orgnr= URL params). Zero-dep keeps the
// graph trivial — no risk of an import cycle when more callers land.

const WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2] as const;

export function isValidOrgnr(candidate: string): boolean {
  // First digit must be 8 or 9. Empirically every registered orgnr
  // starts with 8 or 9 (verified against the live API 2026-06-10:
  // lowest enhet 810034882, lowest underenhet 811545082, across all
  // 1,164,034 enheter) — an artifact of the 1995 conversion from
  // 7-digit numbers. Brreg's docs do NOT formally guarantee this
  // (they only document 9 digits + mod-11), so if Brreg ever opens a
  // new series this check must be relaxed. Failure mode is graceful:
  // extraction misses → hostname/name-search fallback takes over.
  // The payoff: ~9% of arbitrary 9-digit runs pass mod-11, and this
  // prefix check rejects most of that chance-valid junk (ids,
  // timestamps), since junk digits are uniform across 1-9.
  if (!/^[89]\d{8}$/.test(candidate)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += Number(candidate[i]) * WEIGHTS[i]!;
  }
  const remainder = sum % 11;
  const checkDigit = remainder === 0 ? 0 : 11 - remainder;
  if (checkDigit === 10) return false;
  return checkDigit === Number(candidate[8]);
}
