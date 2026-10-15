// AMO submission through the addons.mozilla.org API v5, with the exact
// bytes of the GitHub Release assets:
//
//   1. POST upload/                    multipart: upload=<package zip>, channel=listed
//   2. GET  upload/<uuid>/             poll until processed; stop unless valid
//   3. POST addon/<guid>/versions/     JSON: upload, release_notes {nb-NO, en-US}, approval_notes
//   4. PATCH addon/<guid>/versions/<id>/  multipart: source=<source zip>
//
// Step 4 is separate because the API takes the source file only as
// multipart form data, and release_notes (an object) only as JSON
// (docs: https://mozilla.github.io/addons-server/topics/api/addons.html
// § Version Sources). Every request carries a fresh JWT (HS256,
// iss/jti/iat/exp, exp = iat + 60 s):
// https://mozilla.github.io/addons-server/topics/api/auth.html
//
// The listing sync (syncAmoListing) is separate from the version and
// only runs when asked:
//
//   GET   addon/<guid>/, eula_policy/  public: the live listing, for the diff; a failure stops here
//   PATCH addon/<guid>/                JSON: name, summary, description {nb-NO, en-US}, categories
//   PATCH addon/<guid>/eula_policy/    JSON: privacy_policy {nb-NO}
//
// (same docs, § Edit and § EULA and Privacy Policy Edit). A translated
// field updates only the locales sent; the others stay, and null would
// delete one (https://mozilla.github.io/addons-server/topics/api/overview.html
// § Translated Fields). Description and privacy policy take "some
// Markdown" and keep every newline, so the kit's text goes as is.
import { File } from 'node:buffer';

import { call, diffLines, indent, newJti, notice, sha256, signHs256 } from './publish.mjs';
import { reflowForAmo } from './release.mjs';

// ------------------------------------------------------------ kit → texts

/** The listing's locales; nb-NO is the add-on's default locale on AMO. */
export const AMO_LOCALES = /** @type {const} */ (['nb-NO', 'en-US']);
export const AMO_DEFAULT_LOCALE = 'nb-NO';

/**
 * AMO's extension category slugs, as listed in
 * https://mozilla.github.io/addons-server/topics/api/categories.html
 * § Current categories. Which ones we use is the kit's `categories`
 * field (docs/amo-submission.md § categories), not code.
 */
export const AMO_EXTENSION_CATEGORIES = [
  'alerts-updates',
  'appearance',
  'bookmarks',
  'download-management',
  'feeds-news-blogging',
  'games-entertainment',
  'language-support',
  'photos-music-videos',
  'privacy-security',
  'search-tools',
  'shopping',
  'social-communication',
  'tabs',
  'web-development',
  'other',
];

/**
 * The kit's `categories` field (one slug per line) as the API's list,
 * checked the way addons-server's CategoriesSerializerField checks it:
 * at most 3, and `other` only alone (src/olympia/addons/fields.py at
 * 44bc701, https://github.com/mozilla/addons-server/blob/44bc701df077f000ca4a680f46a9d2ed0d000677/src/olympia/addons/fields.py#L43-L80).
 * @param {string} text
 * @returns {string[]}
 */
export function parseAmoCategories(text) {
  const slugs = text.split(/\s+/).filter(Boolean);
  const unknown = slugs.filter((c) => !AMO_EXTENSION_CATEGORIES.includes(c));
  if (unknown.length) throw new Error(`kit field categories: unknown slug ${unknown.join(', ')}`);
  if (!slugs.length || slugs.length > 3) throw new Error(`kit field categories: 1 to 3 slugs, got ${slugs.length}`);
  if (new Set(slugs).size !== slugs.length) throw new Error('kit field categories: a slug appears twice');
  if (slugs.length > 1 && slugs.includes('other')) throw new Error('kit field categories: "other" only alone');
  return slugs;
}

/**
 * AMO's length limits for the fields we send: `max_length` on the
 * addons-server models, which the API serializers enforce per locale
 * (amo/utils.py `set_max_length_on_fields_where_necessary`), counted as
 * Python `len()`, i.e. code points. Sources, addons-server at 44bc701:
 * https://github.com/mozilla/addons-server/blob/44bc701df077f000ca4a680f46a9d2ed0d000677/src/olympia/addons/models.py#L468-L493
 * (name, description, summary, privacy_policy),
 * https://github.com/mozilla/addons-server/blob/44bc701df077f000ca4a680f46a9d2ed0d000677/src/olympia/versions/models.py#L306-L313
 * (release_notes, approval_notes),
 * https://github.com/mozilla/addons-server/blob/44bc701df077f000ca4a680f46a9d2ed0d000677/src/olympia/amo/utils.py#L1383-L1402
 * (the serializer side). The 3000 for approval_notes is the limit the
 * 1.6.0 submission hit (HTTP 400).
 * @type {Record<string, number>}
 */
export const AMO_LIMITS = {
  approval_notes: 3000,
  release_notes: 3000,
  name: 50,
  summary: 250,
  description: 15000,
  privacy_policy: 150000,
};

/**
 * @param {Record<string, string>} fields kitFields() of the AMO kit
 * @param {string[]} names
 * @param {string} [hint]
 */
function requireFields(fields, names, hint = '') {
  const missing = names.filter((n) => !fields[n]);
  if (missing.length) throw new Error(`kit field ${missing.join(', ')} missing or empty${hint}`);
}

/** @param {(locale: string) => string} pick */
const byLocale = (pick) => Object.fromEntries(AMO_LOCALES.map((l) => [l, pick(l)]));

/**
 * The texts of the version request, as sent. AMO keeps every newline,
 * so the kit's hard-wrapped paragraphs go as one line each (the 1.3.0
 * notes on AMO broke mid-sentence).
 * @param {Record<string, string>} fields kitFields() of the AMO kit
 */
export function amoVersionTexts(fields) {
  requireFields(fields, [...AMO_LOCALES.map((l) => `release_notes.${l}`), 'approval_notes']);
  return {
    release_notes: byLocale((l) => reflowForAmo(fields[`release_notes.${l}`])),
    approval_notes: reflowForAmo(fields.approval_notes),
  };
}

/**
 * The two listing requests, as sent: the add-on edit (name for both
 * locales from the package manifest, summary, description, categories)
 * and the privacy policy (default locale). The kit's listing blocks are
 * already one line per paragraph and bullet, as AMO shows them.
 * @param {Record<string, string>} fields kitFields() of the AMO kit
 * @param {string} name the package manifest's `name`
 */
export function amoListingTexts(fields, name) {
  const listing = AMO_LOCALES.flatMap((l) => [`summary.${l}`, `description.${l}`]);
  requireFields(
    fields,
    [...listing, 'categories', 'privacy_policy'],
    ' (a kit rendered before the listing sync existed has none: use the kit from main)',
  );
  if (!name) throw new Error('the package manifest has no name');
  return {
    addon: {
      name: byLocale(() => name),
      summary: byLocale((l) => fields[`summary.${l}`]),
      description: byLocale((l) => fields[`description.${l}`]),
      categories: parseAmoCategories(fields.categories),
    },
    policy: { privacy_policy: { [AMO_DEFAULT_LOCALE]: fields.privacy_policy } },
  };
}

/**
 * Every limited text in a request body (a string, or an object of
 * locale → string), with its length and AMO's limit. Fields without a
 * known limit (categories) are left out.
 * @param {Record<string, unknown>} body
 * @returns {{ field: string, length: number, limit: number }[]}
 */
export function amoTextLengths(body) {
  const out = [];
  for (const [field, value] of Object.entries(body)) {
    const limit = AMO_LIMITS[field];
    if (!limit || value == null) continue;
    const texts = typeof value === 'string' ? { '': value } : /** @type {Record<string, string>} */ (value);
    for (const [locale, text] of Object.entries(texts)) {
      out.push({ field: locale ? `${field}.${locale}` : field, length: [...String(text ?? '')].length, limit });
    }
  }
  return out;
}

/**
 * The length guard: one message per text over AMO's limit, empty when
 * the body fits. Run before any request (publish-amo.mjs) and on the
 * kit rendered from the canonical docs (tests/release.test.ts).
 * @param {Record<string, unknown>} body
 */
export function amoLengthErrors(body) {
  return amoTextLengths(body)
    .filter((t) => t.length > t.limit)
    .map((t) => `${t.field}: ${t.length} characters, AMO allows ${t.limit}`);
}

export const AMO_API = 'https://addons.mozilla.org/api/v5/addons/';

/**
 * @typedef {{ name: string, bytes: Uint8Array }} Asset
 * @typedef {{
 *   version: string,
 *   guid: string,
 *   pkg: Asset,
 *   source: Asset,
 *   releaseNotes: { 'nb-NO': string, 'en-US': string },
 *   approvalNotes: string,
 *   env: Record<string, string | undefined>,
 *   fetch: import('./publish.mjs').Fetch,
 *   dryRun: boolean,
 *   log?: (line: string) => void,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 *   pollMs?: number,
 *   timeoutMs?: number,
 * }} AmoOptions
 * @typedef {{ status: 'skipped' | 'planned' | 'submitted', reason?: string, versionId?: number, editUrl?: string }} Result
 */

/** @param {AmoOptions['env']} env */
export function missingAmoSecrets(env) {
  return ['AMO_JWT_ISSUER', 'AMO_JWT_SECRET'].filter((k) => !env[k]);
}

/**
 * @param {AmoOptions} o
 * @returns {Promise<Result>}
 */
export async function publishAmo(o) {
  const log = o.log ?? console.log;
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  // Every request shares the injected clock, so a throttled one (HTTP 429)
  // waits on the same sleep as the polling.
  /** @type {(method: string, url: string, init?: Parameters<typeof call>[3]) => ReturnType<typeof call>} */
  const send = (method, url, init) => call(o.fetch, method, url, { ...init, sleep, now });
  const pollMs = o.pollMs ?? 5000;
  const timeoutMs = o.timeoutMs ?? 15 * 60_000;
  const missing = missingAmoSecrets(o.env);

  const versionBody = {
    upload: '<uuid from step 1>',
    release_notes: o.releaseNotes,
    approval_notes: o.approvalNotes,
  };
  const describe = (/** @type {Asset} */ a) => `${a.name} (${a.bytes.length} bytes, sha256 ${sha256(a.bytes)})`;
  const auth = 'Authorization: JWT <HS256 {iss: AMO_JWT_ISSUER, jti, iat, exp: iat+60}>, fresh per request';

  log(`AMO ${o.version} — add-on ${o.guid}`);
  if (o.dryRun) {
    log(`  credentials: ${missing.length ? `${missing.join(', ')} not set (a real run would skip AMO)` : 'set'}`);
    log('  plan (dry run: no request is sent):');
    log(`   1. POST ${AMO_API}upload/`);
    log(`      ${auth}`);
    log(`      multipart: upload=${describe(o.pkg)}, channel=listed`);
    log(`   2. GET ${AMO_API}upload/<uuid>/ every ${pollMs / 1000} s until processed (max ${timeoutMs / 60_000} min); stop unless valid`);
    log(`   3. POST ${AMO_API}addon/${o.guid}/versions/`);
    log('      Content-Type: application/json');
    log(indent(JSON.stringify(versionBody, null, 2)));
    log(`   4. PATCH ${AMO_API}addon/${o.guid}/versions/<id from step 3>/`);
    log(`      multipart: source=${describe(o.source)}`);
    return { status: 'planned' };
  }
  if (missing.length) {
    const reason = `${missing.join(', ')} not set in the store-publish environment`;
    notice(`AMO skipped: ${reason}.`);
    return { status: 'skipped', reason };
  }

  const issuer = /** @type {string} */ (o.env.AMO_JWT_ISSUER);
  const secret = /** @type {string} */ (o.env.AMO_JWT_SECRET);
  const headers = (/** @type {Record<string, string>} */ extra = {}) => {
    const iat = Math.floor(now() / 1000);
    const jwt = signHs256({ iss: issuer, jti: newJti(), iat, exp: iat + 60 }, secret);
    return { Authorization: `JWT ${jwt}`, Accept: 'application/json', ...extra };
  };

  // 1. Upload. The file name must end in .zip/.xpi or AMO rejects it.
  const up = new FormData();
  up.set('upload', new File([o.pkg.bytes], o.pkg.name, { type: 'application/zip' }));
  up.set('channel', 'listed');
  log(`  1. upload ${describe(o.pkg)}`);
  const upload = await send('POST', `${AMO_API}upload/`, { headers, body: up });
  const uuid = String(upload.uuid ?? '');
  if (!uuid) throw new Error(`AMO upload: no uuid in the response: ${JSON.stringify(upload)}`);

  // 2. Validation.
  const deadline = now() + timeoutMs;
  let detail = upload;
  while (!detail.processed) {
    if (now() > deadline) throw new Error(`AMO validation of upload ${uuid} did not finish in ${timeoutMs / 60_000} min`);
    await sleep(pollMs);
    detail = await send('GET', `${AMO_API}upload/${uuid}/`, { headers });
  }
  const messages = detail.validation?.messages ?? [];
  for (const m of messages) log(`     ${m.type ?? 'message'}: ${stripTags(m.message)}${m.file ? ` (${m.file})` : ''}`);
  if (!detail.valid) throw new Error(`AMO validation failed for upload ${uuid} (${messages.length} messages above)`);
  log(`  2. validated (${messages.length} messages)`);

  // 3. Version.
  const created = await send('POST', `${AMO_API}addon/${o.guid}/versions/`, {
    headers: () => headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ...versionBody, upload: uuid }),
  });
  const versionId = Number(created.id);
  if (!versionId) throw new Error(`AMO version create: no id in the response: ${JSON.stringify(created)}`);
  log(`  3. version ${created.version ?? o.version} created (id ${versionId})`);

  // 4. Source for review.
  const src = new FormData();
  src.set('source', new File([o.source.bytes], o.source.name, { type: 'application/zip' }));
  try {
    await send('PATCH', `${AMO_API}addon/${o.guid}/versions/${versionId}/`, { headers, body: src });
  } catch (err) {
    throw new Error(
      `AMO version ${o.version} (id ${versionId}) exists, but attaching the source failed. ` +
        `Upload ${o.source.name} on the version's edit page by hand.\n${err.message}`,
      { cause: err },
    );
  }
  log(`  4. source attached: ${describe(o.source)}`);
  return { status: 'submitted', versionId, editUrl: created.edit_url };
}

/**
 * @typedef {ReturnType<typeof amoListingTexts>} Listing
 * @typedef {{
 *   guid: string,
 *   listing: Listing,
 *   env: Record<string, string | undefined>,
 *   fetch: import('./publish.mjs').Fetch,
 *   dryRun: boolean,
 *   log?: (line: string) => void,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 * }} ListingOptions
 */

/**
 * Send the listing text to AMO: the add-on edit, then the privacy
 * policy. Independent of any version, so it also works for a version
 * that is already up. Both runs first read the live listing (public,
 * unauthenticated GETs; a failed read stops the sync before any write)
 * and print what changes; a dry run stops there and writes nothing.
 * @param {ListingOptions} o
 * @returns {Promise<{ status: 'skipped' | 'planned' | 'synced', reason?: string }>}
 */
export async function syncAmoListing(o) {
  const log = o.log ?? console.log;
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  // Every request shares the injected clock, so a throttled one (HTTP 429)
  // waits on the same sleep as the polling.
  /** @type {(method: string, url: string, init?: Parameters<typeof call>[3]) => ReturnType<typeof call>} */
  const send = (method, url, init) => call(o.fetch, method, url, { ...init, sleep, now });
  const missing = missingAmoSecrets(o.env);
  const addonUrl = `${AMO_API}addon/${o.guid}/`;
  const policyUrl = `${addonUrl}eula_policy/`;
  const { addon, policy } = o.listing;

  log(`AMO listing — add-on ${o.guid}`);
  if (!o.dryRun && missing.length) {
    const reason = `${missing.join(', ')} not set in the store-publish environment`;
    notice(`AMO listing skipped: ${reason}.`);
    return { status: 'skipped', reason };
  }

  const auth = 'Authorization: JWT <HS256 {iss: AMO_JWT_ISSUER, jti, iat, exp: iat+60}>, fresh per request';
  const lengths = (/** @type {Record<string, unknown>} */ body) =>
    amoTextLengths(body).map((t) => `${t.field} ${t.length}/${t.limit}`).join(', ');
  if (o.dryRun) {
    log(`  credentials: ${missing.length ? `${missing.join(', ')} not set (a real run would skip the listing)` : 'set'}`);
  }
  log(`  plan${o.dryRun ? ' (dry run: nothing is written)' : ''}:`);
  log(`   1. PATCH ${addonUrl}`);
  log(`      ${auth}`);
  log('      Content-Type: application/json');
  log(`      lengths (AMO limit): ${lengths(addon)}; categories ${addon.categories.join(', ')}`);
  log(indent(JSON.stringify(addon, null, 2)));
  log(`   2. PATCH ${policyUrl}`);
  log('      Content-Type: application/json');
  log(`      lengths (AMO limit): ${lengths(policy)}`);
  log(indent(JSON.stringify(policy, null, 2)));

  // What changes, against the live listing. AMO serves description and
  // policy as rendered HTML (links wrapped), turned back into text first.
  // No diff, no write: a failed read stops the sync before any PATCH.
  const accept = { Accept: 'application/json' };
  /** @type {Record<string, any>} */
  let live;
  try {
    live = {
      ...(await send('GET', addonUrl, { headers: accept })),
      ...(await send('GET', policyUrl, { headers: accept })),
    };
  } catch (err) {
    throw new Error(`could not read the live listing, so nothing was sent.\n${err.message}`, { cause: err });
  }
  log('  changes against the live listing (live, from its HTML → sent):');
  for (const line of listingChanges(live, { ...addon, ...policy })) log(`    ${line}`);
  if (o.dryRun) return { status: 'planned' };

  const issuer = /** @type {string} */ (o.env.AMO_JWT_ISSUER);
  const secret = /** @type {string} */ (o.env.AMO_JWT_SECRET);
  const headers = () => {
    const iat = Math.floor(now() / 1000);
    const jwt = signHs256({ iss: issuer, jti: newJti(), iat, exp: iat + 60 }, secret);
    return { Authorization: `JWT ${jwt}`, Accept: 'application/json', 'Content-Type': 'application/json' };
  };
  await send('PATCH', addonUrl, { headers, body: JSON.stringify(addon) });
  log('  1. name, summary, description and categories updated');
  try {
    await send('PATCH', policyUrl, { headers, body: JSON.stringify(policy) });
  } catch (err) {
    throw new Error(`AMO listing text was updated, but the privacy policy was not.\n${err.message}`, { cause: err });
  }
  log('  2. privacy policy updated');
  return { status: 'synced' };
}

/**
 * Per field and locale: "unchanged", or a line diff live → sent.
 * @param {Record<string, any>} live the public add-on and eula_policy objects, merged
 * @param {Record<string, any>} sent
 * @returns {string[]}
 */
export function listingChanges(live, sent) {
  const out = [];
  for (const [field, value] of Object.entries(sent)) {
    if (Array.isArray(value)) {
      const was = Array.isArray(live[field]) ? live[field] : (live[field]?.firefox ?? []);
      const same = [...was].sort().join() === [...value].sort().join();
      out.push(`${field}: ${same ? 'unchanged' : `${was.join(', ') || '(none)'} → ${value.join(', ')}`}`);
      continue;
    }
    for (const [locale, text] of Object.entries(value)) {
      const before = htmlToText(live[field]?.[locale] ?? '');
      if (before === text) {
        out.push(`${field}.${locale}: unchanged`);
        continue;
      }
      out.push(`${field}.${locale}:${before ? '' : ' (not set on AMO)'}`);
      for (const line of diffLines(before, text)) out.push(`  ${line}`);
    }
  }
  return out;
}

/** @param {unknown} s */
const stripTags = (s) => String(s ?? '').replace(/<[^>]+>/g, '');

/**
 * AMO's rendered HTML back to roughly the Markdown it was made from, so
 * the diff shows text changes, not markup (links lose their URL).
 * @param {string} html
 */
const htmlToText = (html) =>
  stripTags(
    html
      .replace(/<\/?strong>/g, '**')
      .replace(/<\/?em>/g, '_')
      .replace(/<\/?code>/g, '`')
      .replace(/<li>/g, '\n- ')
      .replace(/<\/[uo]l>/g, '\n'),
  )
    .replace(/\n{3,}/g, '\n\n')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();

