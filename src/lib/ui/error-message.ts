// Map raw fetch/brreg errors to Norwegian user-facing messages. The
// raw `err.message` strings ("brreg API returned 503.", "Failed to
// fetch") are developer-speak; the user needs to know whether the
// problem is their network, brreg, or the orgnr — and whether retrying
// helps. Keyed on error name + the stable message strings thrown by
// src/lib/brreg.ts (same repo, covered by tests).

export function describeLoadError(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : String(err);

  // AbortSignal.timeout() rejects with TimeoutError (spec) — some
  // engines have shipped AbortError for it, so accept both.
  if (name === 'TimeoutError' || name === 'AbortError') {
    return 'Brønnøysundregistrene svarte ikke i tide. Prøv igjen.';
  }

  // fetch() network failure (offline, DNS, blocked) is a TypeError.
  if (err instanceof TypeError) {
    return 'Fikk ikke kontakt med Brønnøysundregistrene. Sjekk nettverkstilkoblingen og prøv igjen.';
  }

  const orgnrMatch = message.match(/^No entity found for orgnr (\d{9})\./);
  if (orgnrMatch) {
    return `Fant ingen bedrift med organisasjonsnummer ${orgnrMatch[1]}.`;
  }

  const statusMatch = message.match(/returned (\d{3})\./);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    if (status === 429) {
      return 'For mange oppslag på kort tid. Vent litt og prøv igjen.';
    }
    if (status >= 500) {
      return 'Brønnøysundregistrene har tekniske problemer akkurat nå. Prøv igjen om litt.';
    }
  }

  if (message.includes('unexpected response shape')) {
    return 'Brønnøysundregistrene ga et uventet svar. Prøv igjen om litt.';
  }

  return 'Noe gikk galt under oppslaget. Prøv igjen.';
}
