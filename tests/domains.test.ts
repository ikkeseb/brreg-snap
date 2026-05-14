import { describe, expect, it } from 'vitest';
import { domainToOrgnr, knownDomainCount } from '../src/lib/domains.js';
import { isValidOrgnr } from '../src/lib/orgnr.js';

// We import the symbol used by the module-load invariant so vitest can
// surface a clear assertion failure for newcomers, even though importing
// domains.ts at all would already throw on a bad table.
describe('domains table integrity', () => {
  it('every entry passes mod-11', () => {
    // Module-load invariant would have thrown above; this asserts via
    // public surface that domainToOrgnr returns mod-11 valid values.
    // Hardcoded probes — one per current entry. Update on table growth.
    const probes = [
      'dnb.no',
      'equinor.com',
      'finn.no',
      'nrk.no',
      'orkla.no',
      'posten.no',
      'sparebank1.no',
      'telenor.no',
      'tine.no',
      'vg.no',
      'vy.no',
    ];
    for (const domain of probes) {
      const orgnr = domainToOrgnr(domain);
      expect(orgnr, `missing entry for ${domain}`).toBeDefined();
      expect(isValidOrgnr(orgnr!), `${domain} → ${orgnr} fails mod-11`).toBe(
        true,
      );
    }
  });

  it('exposes the entry count', () => {
    expect(knownDomainCount()).toBeGreaterThanOrEqual(9);
  });
});

describe('domainToOrgnr', () => {
  it('returns orgnr for an exact match', () => {
    expect(domainToOrgnr('telenor.no')).toBe('982463718');
  });

  it('strips a leading www.', () => {
    expect(domainToOrgnr('www.telenor.no')).toBe('982463718');
  });

  it('walks parent domains for known subdomains', () => {
    expect(domainToOrgnr('shop.telenor.no')).toBe('982463718');
    expect(domainToOrgnr('a.b.c.telenor.no')).toBe('982463718');
  });

  it('returns undefined for an unknown domain', () => {
    expect(domainToOrgnr('something-else.example')).toBeUndefined();
  });

  it('is case-insensitive on the hostname', () => {
    expect(domainToOrgnr('Telenor.NO')).toBe('982463718');
  });
});
