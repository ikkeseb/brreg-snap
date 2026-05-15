// Hostname → brreg search resolution. Last tier of the resolve cascade,
// after URL regex / title regex / curated domain override all miss.
//
// Strips `www.` and the TLD segment to derive a query, hits the brreg
// search endpoint, and picks the most plausible hit. Returns undefined
// if nothing confidently matches — the caller then falls through to
// "no match" / manual search UX.
//
// Caches per hostname in storage.session (24h) so re-visits don't churn
// the API. Negative results are cached too, with a `null` marker, so
// browsing back to e.g. mdn.mozilla.org doesn't re-search every time.

import { searchEnheter } from './brreg.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_PREFIX = 'hostname:';

// Organisasjonsformer that almost certainly aren't the entity behind a
// company website. ENK = enkeltpersonforetak (sole proprietorship,
// often a private individual's side gig); PERS = used internally for
// physical persons. Filtering them out drops a lot of noise from
// generic searches like "shell" → 30+ ENK hits before the AS appears.
const NON_COMPANY_FORMS = new Set(['ENK', 'PERS']);

interface CacheEntry {
  value: string | null;
  expiresAt: number;
}

async function cacheGet(host: string): Promise<string | null | undefined> {
  const key = `${KEY_PREFIX}${host}`;
  const store = await browser.storage.session.get(key);
  const entry = store[key] as CacheEntry | undefined;
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    try {
      await browser.storage.session.remove(key);
    } catch {
      /* best-effort */
    }
    return undefined;
  }
  return entry.value;
}

async function cacheSet(host: string, value: string | null): Promise<void> {
  const key = `${KEY_PREFIX}${host}`;
  const entry: CacheEntry = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  await browser.storage.session.set({ [key]: entry });
}

// Pull the brandable part out of a hostname for use as a search query.
// `www.yara.com` → `yara`, `shop.mestergruppen.no` → `mestergruppen`,
// `nrk.no` → `nrk`. Strips `www.` and the final TLD segment, then takes
// the rightmost remaining label (which is the registrable domain in
// the common case — good enough; tweaking subdomain handling is a
// future refinement). Returns undefined if the result is empty or
// shorter than 2 chars (would match too much).
export function queryFromHostname(hostname: string): string | undefined {
  const stripped = hostname.replace(/^www\./, '').toLowerCase();
  const parts = stripped.split('.');
  if (parts.length < 2) return undefined;
  // Drop the TLD (last segment). For two-label domains this leaves
  // a single label; for deeper hosts we keep the last label before
  // the TLD as the brand candidate.
  const base = parts[parts.length - 2];
  if (!base || base.length < 2) return undefined;
  return base;
}

function isPlausibleMatch(
  hit: { navn: string; organisasjonsform?: { kode?: string } },
  query: string,
): boolean {
  const form = hit.organisasjonsform?.kode;
  if (form && NON_COMPANY_FORMS.has(form)) return false;
  // Navn must contain the query as a substring, case-insensitive. A
  // match where the query appears anywhere is sometimes wrong (e.g.
  // "shell" matching "SHELLY AS") but the alternative — strict prefix
  // match — drops legitimate hits like "A/S NORSKE SHELL" where the
  // brand sits at the end of the legal name.
  return hit.navn.toLowerCase().includes(query);
}

// Search brreg for the most plausible entity matching this hostname.
// Returns the orgnr if exactly one hit looks right, or the first hit
// where the brand sits at the start of the legal name (tightest
// signal). Otherwise undefined — better to show the search UI than
// auto-load a guess.
export async function searchByHostname(
  hostname: string,
): Promise<string | undefined> {
  const cached = await cacheGet(hostname);
  if (cached !== undefined) return cached ?? undefined;

  const query = queryFromHostname(hostname);
  if (!query) {
    await cacheSet(hostname, null);
    return undefined;
  }

  let hits;
  try {
    hits = await searchEnheter(query, 10);
  } catch {
    // Network error / API hiccup — don't cache, just bail. Next visit
    // will retry. The popup/sidebar already handles undefined gracefully.
    return undefined;
  }

  const plausible = hits.filter((h) => isPlausibleMatch(h, query));
  if (plausible.length === 0) {
    await cacheSet(hostname, null);
    return undefined;
  }

  // Prefer a hit whose navn *starts* with the query — that's the brand
  // sitting at the head of the legal name, which is the strongest signal
  // we can get without a curated table. Falls back to first plausible
  // hit otherwise (e.g. "shell" → "A/S NORSKE SHELL"), but only if
  // there's no competing prefix-match.
  const prefixMatches = plausible.filter((h) =>
    h.navn.toLowerCase().startsWith(query),
  );
  const picked = prefixMatches[0] ?? plausible[0];
  if (!picked) {
    await cacheSet(hostname, null);
    return undefined;
  }

  await cacheSet(hostname, picked.organisasjonsnummer);
  return picked.organisasjonsnummer;
}
