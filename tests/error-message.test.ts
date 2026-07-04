import { describe, expect, it } from 'vitest';

import { describeLoadError } from '../src/lib/ui/error-message.js';

function namedError(name: string, message = ''): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe('describeLoadError', () => {
  it('maps AbortSignal.timeout rejections (TimeoutError/AbortError)', () => {
    expect(describeLoadError(namedError('TimeoutError'))).toMatch(
      /svarte ikke i tide/,
    );
    expect(describeLoadError(namedError('AbortError'))).toMatch(
      /svarte ikke i tide/,
    );
  });

  it('maps fetch network failures (TypeError)', () => {
    expect(describeLoadError(new TypeError('Failed to fetch'))).toMatch(
      /nettverkstilkoblingen/,
    );
  });

  it('maps the 404 no-entity message and carries the orgnr through', () => {
    expect(
      describeLoadError(new Error('No entity found for orgnr 933004708.')),
    ).toBe('Fant ingen bedrift med organisasjonsnummer 933004708.');
  });

  it('maps 429 to a rate-limit message', () => {
    expect(describeLoadError(new Error('brreg API returned 429.'))).toMatch(
      /For mange oppslag/,
    );
  });

  it('maps 5xx to a brreg-is-down message for every fetcher', () => {
    for (const msg of [
      'brreg API returned 503.',
      'brreg roller API returned 500.',
      'brreg search returned 502.',
    ]) {
      expect(describeLoadError(new Error(msg))).toMatch(
        /tekniske problemer/,
      );
    }
  });

  it('maps unexpected-shape errors', () => {
    expect(
      describeLoadError(new Error('brreg returned an unexpected response shape.')),
    ).toMatch(/uventet svar/);
  });

  it('falls back to a generic message for anything else', () => {
    expect(describeLoadError(new Error('kaboom'))).toMatch(/Noe gikk galt/);
    expect(describeLoadError('string error')).toMatch(/Noe gikk galt/);
    expect(describeLoadError(undefined)).toMatch(/Noe gikk galt/);
  });

  it('does not treat a client 4xx as a server problem', () => {
    expect(describeLoadError(new Error('brreg API returned 400.'))).toMatch(
      /Noe gikk galt/,
    );
  });
});
