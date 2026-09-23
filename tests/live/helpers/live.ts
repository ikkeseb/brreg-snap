// Shared plumbing for the live canary (tests/live/**, `pnpm test:live`).
//
// Every request — the test's own and the ones the shipped fetchers make —
// goes through one queue: strictly sequential, a pause before each, a
// counted log. The shipped code keeps its own headers and timeout; the
// queue only adds a User-Agent so brreg can tell who is calling.

import { appendFileSync } from 'node:fs';
import { vi } from 'vitest';

import { fakeBrowser } from '../../helpers/fake-browser.js';

export const ER_API = 'https://data.brreg.no/enhetsregisteret/api';
export const REGNSKAP_API = 'https://data.brreg.no/regnskapsregisteret/regnskap';

const PAUSE_MS = 250;
const USER_AGENT =
  'brreg-snap-canary (+https://github.com/ikkeseb/brreg-snap; weekly contract check)';

const realFetch = globalThis.fetch.bind(globalThis);

export interface LoggedRequest {
  url: string;
  status: number;
}

/** Every request this worker made, in order. */
export const requestLog: LoggedRequest[] = [];

let queue: Promise<unknown> = Promise.resolve();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function politeFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const run = async (): Promise<Response> => {
    await sleep(PAUSE_MS);
    const headers = new Headers(init?.headers);
    headers.set('User-Agent', USER_AGENT);
    const res = await realFetch(input, { ...init, headers });
    const url = input instanceof Request ? input.url : String(input);
    requestLog.push({ url, status: res.status });
    return res;
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

/**
 * Fresh engine fake (storage.session backs the shipped caches) plus the
 * polite fetch. Call in beforeEach/beforeAll; vi.unstubAllGlobals undoes
 * both.
 */
export function installLive(): void {
  fakeBrowser();
  vi.stubGlobal('fetch', politeFetch);
}

/** Status of the most recent logged request whose URL contains `part`. */
export function lastStatus(part: string): number | undefined {
  for (let i = requestLog.length - 1; i >= 0; i--) {
    if (requestLog[i]!.url.includes(part)) return requestLog[i]!.status;
  }
  return undefined;
}

/** GET through the queue and parse JSON; returns status and body. */
export async function getJson<T = unknown>(
  url: string,
): Promise<{ status: number; body: T | undefined }> {
  const res = await politeFetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  let body: T | undefined;
  try {
    body = text ? (JSON.parse(text) as T) : undefined;
  } catch {
    body = undefined;
  }
  return { status: res.status, body };
}

/** GET through the queue as text (the docs page). */
export async function getText(
  url: string,
): Promise<{ status: number; text: string }> {
  const res = await politeFetch(url);
  return { status: res.status, text: await res.text() };
}

/**
 * Lazily run `fn` once and share its promise between tests. A rejection
 * is not kept, so vitest's retry really asks again.
 */
export function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () => {
    p ??= fn().catch((err: unknown) => {
      p = undefined;
      throw err;
    });
    return p;
  };
}

/** Append markdown to the GitHub Actions job summary, when there is one. */
export function jobSummary(markdown: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${markdown}\n`);
}
