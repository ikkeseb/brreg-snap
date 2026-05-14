import { describe, expect, it } from 'vitest';
import {
  extractOrgnrFromText,
  isValidOrgnr,
  resolveOrgnr,
} from '../src/lib/orgnr.js';

describe('isValidOrgnr', () => {
  it('accepts valid 9-digit orgnr with correct mod-11 check digit', () => {
    expect(isValidOrgnr('982463718')).toBe(true); // Telenor
    expect(isValidOrgnr('923609016')).toBe(true); // Equinor
  });

  it('rejects malformed input', () => {
    expect(isValidOrgnr('12345678')).toBe(false);
    expect(isValidOrgnr('1234567890')).toBe(false);
    expect(isValidOrgnr('abcdefghi')).toBe(false);
    expect(isValidOrgnr('')).toBe(false);
  });

  it('rejects 9-digit numbers with invalid check digit', () => {
    expect(isValidOrgnr('982463719')).toBe(false);
  });

  it('rejects numbers whose check digit would be 10', () => {
    // 400000000 → sum 12, 12 % 11 = 1, cd = 10 → invalid by spec
    expect(isValidOrgnr('400000000')).toBe(false);
  });
});

describe('extractOrgnrFromText', () => {
  it('finds a valid orgnr inside surrounding text', () => {
    expect(extractOrgnrFromText('orgnr 982 463 718')).toBeUndefined(); // spaces break regex
    expect(extractOrgnrFromText('Foo 982463718 bar')).toBe('982463718');
  });

  it('returns undefined when no valid orgnr is present', () => {
    expect(extractOrgnrFromText('no numbers here')).toBeUndefined();
    expect(extractOrgnrFromText('123456789')).toBeUndefined();
  });

  it('skips earlier invalid 9-digit runs and returns the first valid one', () => {
    // 123456789 fails mod-11; 982463718 is Telenor and passes.
    expect(extractOrgnrFromText('foo 123456789 bar 982463718 baz')).toBe(
      '982463718',
    );
  });
});

describe('resolveOrgnr', () => {
  it('prefers orgnr from URL when present', () => {
    const result = resolveOrgnr({
      url: 'https://example.com/about/982463718',
      title: 'Telenor',
    });
    expect(result).toBe('982463718');
  });

  it('falls back to domain table when URL has no orgnr', () => {
    const result = resolveOrgnr({
      url: 'https://www.telenor.no/privat',
      title: 'Telenor',
    });
    expect(result).toBe('982463718');
  });

  it('handles subdomains via parent-domain lookup', () => {
    const result = resolveOrgnr({
      url: 'https://shop.telenor.no/abonnement',
      title: '',
    });
    expect(result).toBe('982463718');
  });

  it('returns undefined for unknown domain without orgnr in text', () => {
    const result = resolveOrgnr({
      url: 'https://unknown-company-xyz.example/',
      title: 'Unknown',
    });
    expect(result).toBeUndefined();
  });

  it('gracefully handles malformed URLs', () => {
    const result = resolveOrgnr({ url: 'about:newtab', title: '' });
    expect(result).toBeUndefined();
  });
});
