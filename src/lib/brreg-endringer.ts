// The company's recent changes from brreg's change feed
// (/oppdateringer/enheter). One request per company and window; follows
// the brreg.ts error contract: non-2xx, network failure and an
// unexpected shape all reject (callers map that to undefined, "couldn't
// ask"), and [] is a real answer: no changes in the window. See
// docs/notes/trust.md § endringer.

import { API, brregFetch } from './brreg.js';
import { cacheGet, cacheSet } from './session-cache.js';
import type { EnhetOppdatering, JsonPatchOp } from '../types/brreg.js';

// Newest first. The window's events fit easily (a big company has about
// one a month: the antallAnsatte update); if one ever has more, the
// newest 100 are the ones that matter.
const PAGE_SIZE = 100;

interface CachedFeed {
  // The `dato` the feed was asked from; a later window reuses it.
  since: string;
  events: EnhetOppdatering[];
}

function isCachedFeed(value: unknown): value is CachedFeed {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { since?: unknown }).since === 'string' &&
    Array.isArray((value as { events?: unknown }).events)
  );
}

function toPatchOp(value: unknown): JsonPatchOp[] {
  if (typeof value !== 'object' || value === null) return [];
  const { op, path } = value as { op?: unknown; path?: unknown };
  return typeof op === 'string' && typeof path === 'string' ? [{ op, path }] : [];
}

function toOppdatering(value: unknown): EnhetOppdatering[] {
  if (typeof value !== 'object' || value === null) return [];
  const raw = value as {
    oppdateringsid?: unknown;
    dato?: unknown;
    endringstype?: unknown;
    endringer?: unknown;
  };
  if (typeof raw.dato !== 'string') return [];
  const event: EnhetOppdatering = { dato: raw.dato };
  if (typeof raw.oppdateringsid === 'number') event.oppdateringsid = raw.oppdateringsid;
  if (typeof raw.endringstype === 'string') event.endringstype = raw.endringstype;
  if (Array.isArray(raw.endringer)) event.endringer = raw.endringer.flatMap(toPatchOp);
  return [event];
}

// A page is an object; `_embedded` is absent when nothing changed.
function feedItems(data: unknown): unknown[] | undefined {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined;
  const embedded = (data as { _embedded?: unknown })._embedded;
  if (embedded === undefined) return [];
  if (typeof embedded !== 'object' || embedded === null) return undefined;
  const items = (embedded as { oppdaterteEnheter?: unknown }).oppdaterteEnheter;
  if (items === undefined) return [];
  return Array.isArray(items) ? items : undefined;
}

// Change events for one enhet published at or after `sinceIso`, newest
// first. `sinceIso` must be a full ISO timestamp with milliseconds
// (Date.toISOString()): brreg answers 400 to a bare date. Cached 24 h;
// a cached answer that covers the asked window is reused.
export async function fetchEndringer(
  orgnr: string,
  sinceIso: string,
): Promise<EnhetOppdatering[]> {
  const key = `endringer:${orgnr}`;
  const cached = await cacheGet<unknown>(key);
  if (isCachedFeed(cached) && cached.since <= sinceIso) {
    return cached.events.filter((e) => e.dato >= sinceIso);
  }

  const url = new URL(`${API}/oppdateringer/enheter`);
  url.searchParams.set('organisasjonsnummer', orgnr);
  url.searchParams.set('dato', sinceIso);
  url.searchParams.set('includeChanges', 'true');
  url.searchParams.set('size', String(PAGE_SIZE));
  url.searchParams.set('sort', 'id,DESC');
  const res = await brregFetch(url);
  if (!res.ok) {
    throw new Error(`brreg oppdateringer API returned ${res.status}.`);
  }
  const items = feedItems(await res.json());
  if (!items) {
    throw new Error('brreg oppdateringer returned an unexpected response shape.');
  }
  const events = items.flatMap(toOppdatering);
  const entry: CachedFeed = { since: sinceIso, events };
  await cacheSet(key, entry);
  return events;
}
