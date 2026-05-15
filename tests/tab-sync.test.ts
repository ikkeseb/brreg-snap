import { describe, expect, it } from 'vitest';
import { deriveSync } from '../src/lib/tab-sync.js';

describe('deriveSync', () => {
  it('resolves orgnr from domain and returns hostname', () => {
    const result = deriveSync('https://www.dnb.no/privat', 'DNB');
    expect(result).toEqual({ orgnr: '984851006', host: 'www.dnb.no' });
  });

  it('resolves orgnr from url path even when title is empty', () => {
    // brreg's own canonical orgnr appears in path; resolver picks it up
    const result = deriveSync('https://example.com/foo/950588063', '');
    expect(result).toEqual({ orgnr: '950588063', host: 'example.com' });
  });

  it('returns null when url is undefined', () => {
    expect(deriveSync(undefined, 'DNB')).toBeNull();
  });

  it('returns null when no orgnr can be resolved', () => {
    expect(deriveSync('https://example.com/no-orgnr-here', 'Random')).toBeNull();
  });

  it('returns null on unknown menu target with non-http url', () => {
    // about:blank, file://, etc. — no orgnr resolvable, no domain match
    expect(deriveSync('about:blank', 'New Tab')).toBeNull();
  });

  it('handles malformed url by leaving host undefined when orgnr is in title', () => {
    // Edge case: resolver finds orgnr in title even though URL is junk
    const result = deriveSync('not-a-url', 'DNB BANK ASA orgnr 984851006');
    expect(result).toEqual({ orgnr: '984851006', host: undefined });
  });
});
