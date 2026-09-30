// Pure helpers for `pnpm release` (scripts/release.mjs), the release
// workflow's notes step (scripts/release-notes.mjs) and the store
// publisher (scripts/lib/amo.mjs). No I/O here: everything takes and
// returns strings, so tests/release.test.ts covers it without a repo.

/** The marker `pnpm release --tag` refuses to tag over. */
export const STORE_NOTES_TODO = 'TODO(store-notes)';

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** @param {string} v */
export function isVersion(v) {
  return VERSION_RE.test(v);
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number} <0, 0 or >0, like a sort comparator
 */
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * Replace the one `"version": "…"` field in a JSON file's text, leaving
 * every other byte alone (same string-level rule as the stamp in
 * vite.config.ts, so the source manifests keep their formatting).
 * @param {string} text
 * @param {string} version
 * @param {string} label file name for the error message
 */
export function setJsonVersion(text, version, label) {
  const field = /("version"\s*:\s*")[^"]*(")/g;
  const found = text.match(field)?.length ?? 0;
  if (found !== 1) {
    throw new Error(`${label}: expected exactly one "version" field, found ${found}`);
  }
  return text.replace(field, `$1${version}$2`);
}

// ---------------------------------------------------------------- CHANGELOG

const H2 = /^## /;
const isUnreleased = (line) => /^## \[unreleased\]\s*$/i.test(line);
const isVersionHeading = (line, version) =>
  line.startsWith(`## [${version}]`) &&
  /^## \[[^\]]+\](\s|$)/.test(line);

/**
 * Body lines of the first `## ` heading matching `pred`, up to the next
 * `## ` heading.
 * @param {string} changelog
 * @param {(line: string) => boolean} pred
 * @returns {{ start: number, end: number, lines: string[] } | null}
 */
function h2Section(changelog, pred) {
  const lines = changelog.split('\n');
  const start = lines.findIndex(pred);
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !H2.test(lines[end])) end++;
  return { start, end, lines };
}

const trimBlank = (text) => text.replace(/^\s*\n/, '').trimEnd();

/**
 * The `## [Unreleased]` body, trimmed; null when there is no such heading.
 * @param {string} changelog
 */
export function unreleasedBody(changelog) {
  const s = h2Section(changelog, isUnreleased);
  return s ? trimBlank(s.lines.slice(s.start + 1, s.end).join('\n')) : null;
}

/**
 * The body of `## [version] — date`, trimmed; null when missing.
 * @param {string} changelog
 * @param {string} version
 */
export function changelogSection(changelog, version) {
  const s = h2Section(changelog, (l) => isVersionHeading(l, version));
  return s ? trimBlank(s.lines.slice(s.start + 1, s.end).join('\n')) : null;
}

/**
 * Turn `## [Unreleased]` into `## [version] — date` and open a fresh,
 * empty `## [Unreleased]` above it.
 * @param {string} changelog
 * @param {string} version
 * @param {string} date YYYY-MM-DD
 */
export function promoteUnreleased(changelog, version, date) {
  const body = unreleasedBody(changelog);
  if (body === null) throw new Error('CHANGELOG.md has no "## [Unreleased]" section');
  if (!body) throw new Error('CHANGELOG.md: "## [Unreleased]" is empty — nothing to release');
  if (changelogSection(changelog, version) !== null) {
    throw new Error(`CHANGELOG.md already has a "## [${version}]" section`);
  }
  const lines = changelog.split('\n');
  const i = lines.findIndex(isUnreleased);
  lines.splice(i, 1, '## [Unreleased]', '', `## [${version}] — ${date}`);
  return lines.join('\n');
}

// ------------------------------------------------------- anchored sections

/**
 * The body under the heading that follows `<!-- SECTION: name -->`, up to
 * the next anchor or the next heading of the same or a higher level. A
 * trailing `---` rule is dropped.
 * @param {string} doc
 * @param {string} name
 * @param {string} [label] document name for errors
 */
export function extractSection(doc, name, label = 'document') {
  const lines = doc.split('\n');
  const marker = `<!-- SECTION: ${name} -->`;
  const hits = lines.flatMap((l, i) => (l.trim() === marker ? [i] : []));
  if (hits.length !== 1) {
    throw new Error(`${label}: expected one "${marker}", found ${hits.length}`);
  }
  let h = hits[0] + 1;
  while (h < lines.length && !lines[h].trim()) h++;
  const heading = /^(#{1,6}) /.exec(lines[h] ?? '');
  if (!heading) throw new Error(`${label}: "${marker}" must sit right above a heading`);
  const level = heading[1].length;
  let end = h + 1;
  while (end < lines.length) {
    const l = lines[end];
    if (l.trim().startsWith('<!-- SECTION:')) break;
    const m = /^(#{1,6}) /.exec(l);
    if (m && m[1].length <= level) break;
    end++;
  }
  return trimBlank(lines.slice(h + 1, end).join('\n')).replace(/\n+---$/, '').trimEnd();
}

/**
 * The first blockquote in `text`, with the `> ` markers removed.
 * @param {string} text
 */
export function unquote(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('>'));
  if (start === -1) throw new Error('expected a blockquote');
  const out = [];
  for (let i = start; i < lines.length && lines[i].startsWith('>'); i++) {
    out.push(lines[i].replace(/^> ?/, ''));
  }
  return out.join('\n').trim();
}

/** @param {string} text */
const blockquote = (text) =>
  text
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n');

// ---------------------------------------------------------------- templates

/**
 * Fill a kit template. Placeholders: `{{ name }}` or `{{ name | filter }}`.
 * `name` is a key of `values`, or `<doc>:<anchor>` for a section of
 * `docs[doc]` (see extractSection); `<version>` inside a section becomes
 * the release version. Filters: `unquote` (the section's blockquote text),
 * `blockquote` (wrap as a Markdown quote). Unknown names, filters and
 * anchors throw, so a renamed anchor can't silently empty a kit.
 * @param {string} template
 * @param {{ version: string, values: Record<string, string>, docs: Record<string, string> }} ctx
 */
export function renderTemplate(template, ctx) {
  return template.replace(/\{\{\s*([\w:.-]+)\s*(?:\|\s*(\w+)\s*)?\}\}/g, (_, name, filter) => {
    let out;
    const ref = /^(\w+):([\w-]+)$/.exec(name);
    if (ref) {
      const doc = ctx.docs[ref[1]];
      if (doc === undefined) throw new Error(`template: unknown document "${ref[1]}"`);
      out = extractSection(doc, ref[2], ref[1]).replaceAll('<version>', ctx.version);
    } else if (name in ctx.values) {
      out = ctx.values[name];
    } else {
      throw new Error(`template: unknown placeholder "${name}"`);
    }
    if (filter === 'unquote') return unquote(out);
    if (filter === 'blockquote') return blockquote(out);
    if (filter) throw new Error(`template: unknown filter "${filter}"`);
    return out;
  });
}

/**
 * Lines still carrying the store-notes TODO marker.
 * @param {string} text
 * @returns {number[]} 1-based line numbers
 */
export function findTodos(text) {
  return text.split('\n').flatMap((l, i) => (l.includes(STORE_NOTES_TODO) ? [i + 1] : []));
}

/**
 * The machine-read fields of a kit: `<!-- field: name -->` followed by a
 * fenced block. The publisher sends exactly these texts.
 * @param {string} kit
 * @returns {Record<string, string>}
 */
export function kitFields(kit) {
  const lines = kit.split('\n');
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^<!-- field: ([\w.-]+) -->$/.exec(lines[i].trim());
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    const fence = /^(`{3,})/.exec(lines[j] ?? '');
    if (!fence) throw new Error(`kit: field "${m[1]}" must be followed by a fenced block`);
    const body = [];
    for (j++; j < lines.length && !lines[j].startsWith(fence[1]); j++) body.push(lines[j]);
    if (j === lines.length) throw new Error(`kit: field "${m[1]}" has an unclosed fence`);
    if (m[1] in out) throw new Error(`kit: field "${m[1]}" appears twice`);
    out[m[1]] = body.join('\n').trim();
    i = j;
  }
  return out;
}

// ------------------------------------------------------------ AMO privacy

/** @param {string} row */
const cells = (row) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

const LIST_ITEM = /^(\s*)([-*+]|\d+\.)\s+/;

/**
 * PRIVACY.md reshaped for AMO's privacy-policy field, which keeps every
 * newline and renders only a Markdown subset (emphasis, links, code,
 * lists — no headings, no tables; checked against the live 1.3.1
 * policy via the public eula_policy API). Paragraphs and list items
 * become single lines, `##` headings bold lines, table rows list items
 * (`- key: value`; extra columns as `— Header: cell; …`). The `#` title
 * is dropped: AMO titles the page itself.
 * @param {string} md
 */
export function reflowForAmo(md) {
  const blocks = md.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  const out = [];
  for (const block of blocks) {
    let lines = block.split('\n').filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines[0].startsWith('```')) {
      out.push(block.trim());
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(lines[0]);
    if (heading) {
      if (heading[1].length > 1) out.push(`**${heading[2].trim()}**`);
      lines = lines.slice(1);
      if (!lines.length) continue;
    }
    if (lines.every((l) => l.trim().startsWith('|'))) {
      const [head, ...rows] = lines.map(cells);
      const body = rows.filter((r) => !r.every((c) => /^:?-+:?$/.test(c)));
      out.push(
        body
          .map((r) => {
            if (r.length <= 2) return `- ${r[0]}: ${r[1] ?? ''}`.trimEnd();
            const rest = r.slice(1).map((c, i) => `${head[i + 1]}: ${c}`);
            return `- ${r[0]} — ${rest.join('; ')}`;
          })
          .join('\n'),
      );
      continue;
    }
    // Paragraph and/or list: a list marker starts a new line, anything
    // else continues the current one.
    const joined = [];
    for (const line of lines) {
      const item = LIST_ITEM.exec(line);
      if (item || !joined.length) joined.push(line.trim());
      else joined[joined.length - 1] += ` ${line.trim()}`;
    }
    out.push(joined.join('\n'));
  }
  return out.join('\n\n');
}
