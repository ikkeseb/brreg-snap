// Recorded data.brreg.no responses for the preview harness and the
// browser smoke (tests/e2e/). One JSON file per request:
//   { "request": "/enhetsregisteret/api/enheter/984851006",
//     "status": 200, "body": <parsed JSON, or a string> }
// `request` is the path + query exactly as the extension sends it to
// https://data.brreg.no. tests/e2e/record.mjs writes these files.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * @typedef {{ status: number, headers: Record<string, string>, body: string }} FixtureReply
 */

/**
 * Loads every *.json fixture in `dir` into a map keyed by `request`.
 * @param {string} dir
 * @returns {Promise<Map<string, { status: number, body: unknown }>>}
 */
export async function loadFixtures(dir) {
  const map = new Map();
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.json')) continue;
    const f = JSON.parse(await readFile(join(dir, name), 'utf8'));
    map.set(f.request, { status: f.status, body: f.body });
  }
  return map;
}

/** Marks a reply for a request nobody recorded; specs fail on it. */
export const MISS_HEADER = 'x-fixture-miss';

/**
 * The reply for one brreg request (`pathAndQuery` = URL minus origin).
 * An unrecorded request answers 404 with MISS_HEADER set, so a spec can
 * name the missing fixture instead of asserting on a wrong state.
 * @param {Map<string, { status: number, body: unknown }>} fixtures
 * @param {string} pathAndQuery
 * @returns {FixtureReply}
 */
export function fixtureReply(fixtures, pathAndQuery) {
  const hit = fixtures.get(pathAndQuery);
  if (!hit) {
    return {
      status: 404,
      headers: { 'content-type': 'application/json', [MISS_HEADER]: '1' },
      body: JSON.stringify({ error: `no recorded fixture for ${pathAndQuery}` }),
    };
  }
  return {
    status: hit.status,
    headers: { 'content-type': 'application/json' },
    body: typeof hit.body === 'string' ? hit.body : JSON.stringify(hit.body),
  };
}
