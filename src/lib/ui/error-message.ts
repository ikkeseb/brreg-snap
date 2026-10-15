// Map raw fetch/brreg errors to Norwegian user-facing messages. The
// raw `err.message` strings ("brreg API returned 503.", "Failed to
// fetch") are developer-speak; the user needs to know whether the
// problem is their network, brreg, or the orgnr — and whether retrying
// helps. Keyed on error name + the stable message strings thrown by
// src/lib/brreg.ts (same repo, covered by tests). The sentences are
// COPY keys (src/lib/view/copy.ts).

import { DeletedAvdelingError } from '../company-load.js';
import { formatDateNo } from '../format.js';
import { COPY } from '../view/copy.js';

export function describeLoadError(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : String(err);

  if (err instanceof DeletedAvdelingError) {
    const { navn, organisasjonsnummer, slettedato } = err.avdeling;
    return COPY.deletedAvdeling(organisasjonsnummer, navn, formatDateNo(slettedato));
  }

  // AbortSignal.timeout() rejects with TimeoutError (spec) — some
  // engines have shipped AbortError for it, so accept both.
  if (name === 'TimeoutError' || name === 'AbortError') {
    return COPY.timedOut;
  }

  // fetch() network failure (offline, DNS, blocked) is a TypeError.
  if (err instanceof TypeError) {
    return COPY.offline;
  }

  const orgnrMatch = message.match(/^No entity found for orgnr (\d{9})\./);
  if (orgnrMatch) {
    return COPY.notFound(orgnrMatch[1]!);
  }

  const statusMatch = message.match(/returned (\d{3})\./);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    if (status === 429) {
      return COPY.tooMany;
    }
    if (status >= 500) {
      return COPY.brregDown;
    }
  }

  if (message.includes('unexpected response shape')) {
    return COPY.badResponse;
  }

  return COPY.genericFailure;
}

// The error state's answer band (always warn, never the danger stamp:
// a failed lookup says nothing about the company). `head` is the
// headline, `support` the sentence under it, `retry` whether asking
// again can change the answer.
export interface LoadFailure {
  head: string;
  support: string;
  retry: boolean;
}

export function describeLoadFailure(err: unknown): LoadFailure {
  const text = describeLoadError(err);
  if (err instanceof DeletedAvdelingError) {
    return { head: COPY.deletedAvdelingHead, support: text, retry: false };
  }
  const message = err instanceof Error ? err.message : '';
  if (/^No entity found for orgnr \d{9}\./.test(message)) {
    return { head: COPY.notFoundHead, support: text, retry: false };
  }
  if (/returned 429\./.test(message)) {
    return { head: COPY.tooManyHead, support: text, retry: true };
  }
  // A network failure's own sentence only repeats the headline: say
  // what to do instead.
  const what = err instanceof TypeError ? COPY.checkNetwork : text;
  return { head: COPY.noAnswerHead, support: COPY.noAnswerSupport(what), retry: true };
}
