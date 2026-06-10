import { describe, expect, it } from 'vitest';

import { decodePunycode } from '../src/lib/punycode.js';

// Ground truth generated with Node's own IDN machinery, e.g.
//   node -e "console.log(new URL('https://blåbær.no').hostname)"
//   → xn--blbr-roah.no
// — i.e. these are the exact payloads hostname-score.ts will see after
// stripping the "xn--" prefix from a real `new URL().hostname` label.

describe('decodePunycode', () => {
  it('decodes Nordic brand labels', () => {
    expect(decodePunycode('blbr-roah')).toBe('blåbær');
    expect(decodePunycode('st-kka')).toBe('øst');
    expect(decodePunycode('hndverker-52a')).toBe('håndverker');
  });

  it('decodes labels with multiple inserted code points', () => {
    expect(decodePunycode('blbrsyltety-y8ao3x')).toBe('blåbærsyltetøy');
    expect(decodePunycode('bcher-kva')).toBe('bücher');
  });

  it('decodes labels with no basic part (no hyphen — fully encoded)', () => {
    expect(decodePunycode('5cab8c')).toBe('æøå');
  });

  it('returns the empty string for empty input', () => {
    // Vacuously valid per RFC 3492. hostname-score's caller treats an
    // empty label as no-label and abstains — pinned there, not here.
    expect(decodePunycode('')).toBe('');
  });

  it('returns undefined for invalid digit characters', () => {
    expect(decodePunycode('blbr-ro!h')).toBeUndefined();
  });

  it('returns undefined for a truncated delta sequence', () => {
    // 'b' is digit 1 with threshold t=1, so the decoder expects more
    // digits — input ends instead.
    expect(decodePunycode('a-b')).toBeUndefined();
  });

  it('returns undefined instead of looping/throwing on overflow', () => {
    expect(decodePunycode('a-99999999999999999999')).toBeUndefined();
  });

  it('returns undefined for non-ASCII before the delimiter', () => {
    // The basic part must already be ASCII — a Nordic char there means
    // the label was never punycode to begin with.
    expect(decodePunycode('blå-roah')).toBeUndefined();
  });
});
