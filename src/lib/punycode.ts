// Minimal RFC 3492 punycode DECODER — decode only, no encode. Zero-dep
// by design (see CLAUDE.md): the shipped bundle carries no npm packages.
//
// Why it exists: `new URL().hostname` returns IDN labels in ACE form
// (blåbær.no → xn--blbr-roah.no). Feeding the raw "xn--…" label into
// brreg name search can never match — ironic, since the Nordic-variant
// machinery exists exactly for æ/ø/å brands. hostname-score.ts decodes
// xn-- labels through this module before building search queries.
//
// All malformed input (bad digit, truncated sequence, overflow) returns
// undefined instead of throwing, so callers can abstain cleanly.

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const MAX_CODE_POINT = 0x10ffff;
// Generous arithmetic bound — RFC 3492 §6.4 requires overflow detection;
// any intermediate value past this is malformed input, not a real label.
const MAX_INT = 0x7fffffff;

// Bias adaptation, RFC 3492 §6.1.
function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > Math.floor(((BASE - T_MIN) * T_MAX) / 2)) {
    delta = Math.floor(delta / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * delta) / (delta + SKEW));
}

// Digit value of a basic code point: a-z → 0-25, 0-9 → 26-35
// (case-insensitive). -1 for anything else.
function digitValue(code: number): number {
  if (code >= 0x61 && code <= 0x7a) return code - 0x61; // a-z
  if (code >= 0x41 && code <= 0x5a) return code - 0x41; // A-Z
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 26; // 0-9
  return -1;
}

// Decode one punycode payload — the part AFTER the "xn--" prefix
// ("blbr-roah" → "blåbær"). Returns undefined on malformed input.
export function decodePunycode(input: string): string | undefined {
  const output: number[] = [];

  // Basic (ASCII) code points sit before the LAST hyphen; the encoded
  // deltas after it. No hyphen at all → the whole payload is encoded.
  const lastDelim = input.lastIndexOf('-');
  let pos = 0;
  if (lastDelim >= 0) {
    for (let j = 0; j < lastDelim; j++) {
      const code = input.charCodeAt(j);
      if (code >= 0x80) return undefined; // non-ASCII before delimiter
      output.push(code);
    }
    pos = lastDelim + 1;
  }

  // Main decode loop, RFC 3492 §6.2.
  let n = INITIAL_N;
  let i = 0;
  let bias = INITIAL_BIAS;
  while (pos < input.length) {
    const oldI = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (pos >= input.length) return undefined; // truncated sequence
      const digit = digitValue(input.charCodeAt(pos++));
      if (digit < 0) return undefined;
      i += digit * w;
      if (i > MAX_INT) return undefined; // overflow
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
      if (w > MAX_INT) return undefined; // overflow
    }
    const numPoints = output.length + 1;
    bias = adapt(i - oldI, numPoints, oldI === 0);
    n += Math.floor(i / numPoints);
    i %= numPoints;
    if (n > MAX_CODE_POINT) return undefined; // beyond Unicode
    output.splice(i, 0, n);
    i++;
  }

  return String.fromCodePoint(...output);
}
