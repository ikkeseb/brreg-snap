// Mod-11 check digit for Norwegian organisasjonsnummer.
//
// Standalone module: consumed by orgnr.ts (URL/title resolution) and
// details.ts (validating ?orgnr= URL params). Zero-dep keeps the
// graph trivial — no risk of an import cycle when more callers land.

const WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2] as const;

export function isValidOrgnr(candidate: string): boolean {
  if (!/^\d{9}$/.test(candidate)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += Number(candidate[i]) * WEIGHTS[i]!;
  }
  const remainder = sum % 11;
  const checkDigit = remainder === 0 ? 0 : 11 - remainder;
  if (checkDigit === 10) return false;
  return checkDigit === Number(candidate[8]);
}
