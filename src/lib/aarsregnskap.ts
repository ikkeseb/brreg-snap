// Links to the official annual-report copies (årsregnskap) and to the
// company's kunngjøringer: the multi-year history the Økonomi tab
// doesn't show. The only fetch is the small year list on
// data.brreg.no; the PDFs and the announcement page are plain links the
// user clicks. See docs/notes/brreg-api.md § aarsregnskap-kopi.

import { brregFetch } from './brreg.js';
import { cacheGet, cacheSet } from './session-cache.js';

const KOPI_API =
  'https://data.brreg.no/regnskapsregisteret/regnskap/aarsregnskap/kopi';

// The years brreg has an annual-report copy for, newest first
// (["2025", "2024", …]). The live list starts at 2011 even where older
// copies exist. [] = none (brreg answers [] for an orgnr it doesn't
// know; a 404 is read the same way). Rejects on network failure, any
// other status and a non-array body; loadCompany maps that to
// «couldn't ask».
export async function fetchAarsregnskapYears(orgnr: string): Promise<string[]> {
  const key = `aarsregnskap:${orgnr}`;
  const cached = await cacheGet<string[]>(key);
  if (Array.isArray(cached)) return cached;

  const res = await brregFetch(`${KOPI_API}/${orgnr}/aar`);
  if (res.status === 404) {
    await cacheSet<string[]>(key, []);
    return [];
  }
  if (!res.ok) {
    throw new Error(`brreg aarsregnskap API returned ${res.status}.`);
  }
  const data: unknown = await res.json();
  if (!Array.isArray(data)) {
    throw new Error('brreg aarsregnskap returned an unexpected response shape.');
  }
  // Live order is oldest first; don't rely on it.
  const years = [
    ...new Set(
      data.filter((y): y is string => typeof y === 'string' && /^\d{4}$/.test(y)),
    ),
  ].sort((a, b) => b.localeCompare(a));
  await cacheSet(key, years);
  return years;
}

// The annual-report PDF for one year. A link only — never fetch it: a
// copy can be tens of MB and take brreg half a minute to produce. brreg
// serves it as `Content-Disposition: attachment`, so a click downloads
// the file (aarsregnskap-<year>_<orgnr>.pdf) rather than opening a tab.
export function aarsregnskapPdfUrl(orgnr: string, year: string): string {
  return `${KOPI_API}/${encodeURIComponent(orgnr)}/${encodeURIComponent(year)}`;
}

// brreg's announcement list for the company (Kunngjøringer): board
// changes, capital changes, approved accounts… An HTML page on
// w2.brreg.no — a user-clicked link, never fetched (not a host the
// extension may contact).
export function kunngjoringerUrl(orgnr: string): string {
  return `https://w2.brreg.no/kunngjoring/hent_nr.jsp?orgnr=${encodeURIComponent(orgnr)}`;
}
