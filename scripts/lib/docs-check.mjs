// Pure reference checks. The CLI supplies git's tracked paths and I/O;
// inline fixtures supply the same data and callbacks in tests.
import { posix } from 'node:path';

const OUTPUT_DIRS = new Set([
  'dist-firefox', 'dist-chrome', 'web-ext-artifacts', 'test-results', 'node_modules', 'coverage',
]);

/** @param {string[]} trackedFiles */
export function selectDocFiles(trackedFiles) {
  return trackedFiles.filter((file) => {
    if (file.startsWith('docs/plans/')) return false;
    if (/^docs\/submission-kit\/\d+\.\d+\.\d+(?:[-+][^/]+)?\//.test(file)) return false;
    return /^(?:AGENTS|CLAUDE|README|BUILD|PRIVACY)\.md$/.test(file) ||
      /^docs\/[^/]+\.md$/.test(file) ||
      /^docs\/notes\/[^/]+\.md$/.test(file) ||
      /^docs\/submission-kit\/templates\/[^/]+\.md$/.test(file) ||
      /^(?:scripts|tests|public|docs)\/(?:[^/]+\/)*README\.md$/.test(file);
  });
}

/** @param {string} text */
function blank(text) {
  return text.replace(/[^\n]/g, ' ');
}

// Preserve offsets and line numbers while removing fenced examples and comments.
/** @param {string} text */
function prose(text) {
  let fence = '';
  let length = 0;
  const masked = text.split('\n').map((line) => {
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (new RegExp(`^ {0,3}${fence}{${length},}\\s*$`).test(line)) fence = '';
      return blank(line);
    }
    if (opening) {
      fence = opening[1][0];
      length = opening[1].length;
      return blank(line);
    }
    return line;
  }).join('\n');
  return masked.replace(/<!--[\s\S]*?(?:-->|$)/g, blank);
}

/** @param {string} value */
function isPlaceholder(value) {
  return /<[^>]*>|X\.Y\.Z|…|\.\.\.|\$\{[^}]*\}|\{\{[^}]*\}\}|\d+\.\.\d+/.test(value);
}

/** Strip location suffixes before recognition and brace expansion. @param {string} value */
export function expandPaths(value) {
  const path = value.replace(/#.*$/, '').replace(/:\d+(?:-\d+)?$/, '');
  const brace = /\{([^{}]+,[^{}]+)\}/.exec(path);
  if (!brace) return [posix.normalize(path)];
  return brace[1].split(',').flatMap((part) =>
    expandPaths(path.slice(0, brace.index) + part + path.slice(brace.index + brace[0].length)),
  );
}

/**
 * @param {string} value
 * @param {string} source
 * @param {string[]} trackedFiles
 * @param {boolean} [link] Markdown destinations are relative to the source file.
 */
function repoPath(value, source, trackedFiles, link = false) {
  if (!value || /\s/.test(value) || isPlaceholder(value) || value.startsWith('#')) return null;
  const path = value.replace(/#.*$/, '').replace(/:\d+(?:-\d+)?$/, '');
  if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(path)) return null;
  const resolved = link ? posix.join(posix.dirname(source), path) : posix.normalize(path);
  const dirs = new Set(trackedFiles.filter((file) => file.includes('/')).map((file) => file.split('/')[0]));
  const roots = new Set(trackedFiles.filter((file) => !file.includes('/')));
  const alternatives = expandPaths(resolved);
  if (alternatives.some((file) => OUTPUT_DIRS.has(file.split('/')[0]))) return null;
  if (!alternatives.every((file) => dirs.has(file.split('/')[0]) || roots.has(file))) return null;
  return resolved;
}

/** @typedef {{ path: string, reference: string, line: number, section?: string, kind?: 'anchor' | 'heading', bareHeading?: boolean }} Reference */

/** @param {string} value */
function sectionValue(value) {
  const trimmed = value.trim();
  if (!trimmed || isPlaceholder(trimmed)) return null;
  if (/^[a-z\d]+(?:-[a-z\d]+)*$/.test(trimmed)) return { section: trimmed, kind: /** @type {const} */ ('anchor') };
  // A lone camelCase identifier is usually a symbol, not a heading.
  if (/^[a-z]+[A-Z]\w*$/.test(trimmed)) return null;
  return { section: trimmed, kind: /** @type {const} */ ('heading') };
}

/**
 * Extract only inline paths, inline Markdown destinations and clear § refs.
 * @param {string} markdown
 * @param {string} source
 * @param {string[]} trackedFiles
 */
export function findReferences(markdown, source, trackedFiles) {
  const text = prose(markdown);
  const spans = [...text.matchAll(/(?<![\\`])(`+)([\s\S]*?)\1(?!`)/g)].map((match) => ({
    start: match.index, end: match.index + match[0].length, value: match[2],
  }));
  /** @type {Reference[]} */
  const references = [];
  const lineAt = (index) => text.slice(0, index).split('\n').length;
  const sectionPathSpans = new Set();
  let sectionRefsSkipped = 0;

  // Mask code spans so examples like `[text](url)` remain examples.
  let links = text;
  for (const span of spans) links = links.slice(0, span.start) + blank(links.slice(span.start, span.end)) + links.slice(span.end);
  for (const match of links.matchAll(/!?\[[^\]\n]*\]\(\s*([^\s)]+)(?:\s+"[^"\n]*")?\s*\)/g)) {
    const path = repoPath(match[1], source, trackedFiles, true);
    if (path) references.push({ path, reference: match[1], line: lineAt(match.index) });
  }

  for (const match of text.matchAll(/§/g)) {
    const index = match.index;
    const containing = spans.find((span) => span.start <= index && index < span.end);
    let pathText = '';
    let value = '';
    let quoted = false;
    let bareHeading = false;
    let pathSpan;
    if (containing) {
      const parts = containing.value.split('§');
      if (parts.length === 2) [pathText, value] = parts.map((part) => part.trim());
    } else {
      const preceding = spans.find((span) => span.end <= index && /^[ \t]*(?:\n[ \t]*)?$/.test(text.slice(span.end, index)));
      pathSpan = preceding;
      pathText = preceding?.value ?? /([\w./{}*,:#-]+)[ \t]*(?:\n[ \t]*)?$/.exec(text.slice(0, index))?.[1] ?? '';
      const right = text.slice(index + 1).replace(/^[ \t]*(?:\n[ \t]*)?/, '');
      const delimited = /^(?:`([^`\n]+)`|"([^"\n]*(?:\n[^"\n]+)?)"|'([^'\n]+)')/.exec(right);
      if (delimited) {
        value = delimited[1] ?? delimited[2] ?? delimited[3];
        quoted = delimited[2] !== undefined || delimited[3] !== undefined;
      } else {
        const slug = /^([a-z\d]+(?:-[a-z\d]+)+)(?=$|[\s).,;:])|^([a-z\d]+)(?=$|[).,;:]|[ \t]*\n)/.exec(right);
        if (slug) value = slug[1] ?? slug[2];
        else {
          // Unquoted titles need a clause boundary on the same line.
          // A wrapped title mixed with prose has no reliable end point.
          value = /^([^\n§]+?)(?=[).,;:]|$)/.exec(right)?.[1] ?? '';
          bareHeading = true;
        }
      }
    }
    const path = repoPath(pathText.trim(), source, trackedFiles);
    const section = sectionValue(value);
    if (!path || !section || /[{}*]/.test(path)) {
      sectionRefsSkipped++;
      continue;
    }
    references.push({
      path, reference: `${pathText.trim()} § ${value.replace(/\s+/g, ' ')}`,
      line: lineAt(index), ...section, kind: quoted ? 'heading' : section.kind, bareHeading,
    });
    if (pathSpan) sectionPathSpans.add(pathSpan.start);
  }
  for (const span of spans) {
    if (sectionPathSpans.has(span.start)) continue;
    const path = repoPath(span.value, source, trackedFiles);
    if (path) references.push({ path, reference: span.value, line: lineAt(span.start) });
  }
  return { references, sectionRefsSkipped };
}

/** @param {string} pattern */
function globPattern(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const wildcard = escaped.replace(/\*\*\/|\*\*|\*/g, (token) =>
    token === '**/' ? '(?:.*/)?' : token === '**' ? '.*' : '[^/]*',
  );
  return new RegExp(`^${wildcard}$`);
}

/** @param {string} text */
function headingText(text) {
  return text.replace(/[`"'“”‘’]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** @param {string} markdown */
function headings(markdown) {
  const lines = prose(markdown).split('\n');
  return lines.flatMap((line, index) => {
    const atx = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (atx) return [headingText(atx[1])];
    if (line.trim() && /^ {0,3}(?:=+|-+)\s*$/.test(lines[index + 1] ?? '')) return [headingText(line)];
    return [];
  });
}

/**
 * @param {{ trackedFiles: string[], readFile: (path: string) => string,
 *   exists: (path: string) => boolean, isIgnored: (path: string) => boolean }} input
 */
export function checkDocs({ trackedFiles, readFile, exists, isIgnored }) {
  const files = selectDocFiles(trackedFiles);
  /** @type {{ file: string, line: number, message: string }[]} */
  const hits = [];
  let referencesChecked = 0;
  let sectionRefsSkipped = 0;
  for (const file of files) {
    const found = findReferences(readFile(file), file, trackedFiles);
    sectionRefsSkipped += found.sectionRefsSkipped;
    for (const ref of found.references) {
      referencesChecked++;
      let valid = true;
      const fail = (reason) => {
        valid = false;
        hits.push({ file, line: ref.line, message: `"${ref.reference}": ${reason}` });
      };
      for (const path of expandPaths(ref.path)) {
        if (isIgnored(path)) {
          fail(`gitignored path "${path}"`);
        } else if (path.includes('*')) {
          const matches = trackedFiles.filter((tracked) => globPattern(path).test(tracked));
          if (!matches.length) fail(`no tracked matches for "${path}"`);
          for (const matched of matches) {
            if (isIgnored(matched)) fail(`gitignored path "${matched}"`);
            else if (!exists(matched)) fail(`missing path "${matched}"`);
          }
        } else if (path.endsWith('/')) {
          if (!trackedFiles.some((tracked) => tracked.startsWith(path))) fail(`no tracked files in directory "${path}"`);
          else if (!exists(path)) fail(`missing directory "${path}"`);
        } else if (!exists(path)) {
          fail(`missing path "${path}"`);
        }
      }
      if (valid && ref.section) {
        const target = readFile(expandPaths(ref.path)[0]);
        if (ref.kind === 'anchor') {
          const anchors = [...target.matchAll(/<!--\s*SECTION:\s*([^\s]+)\s*-->/g)].map((match) => match[1]);
          if (!anchors.includes(ref.section)) fail(`missing SECTION anchor "${ref.section}" in "${ref.path}"`);
        } else {
          const wanted = headingText(ref.section);
          const titles = headings(target);
          if (!titles.includes(wanted)) {
            // A title followed by prose does not give an unambiguous heading text.
            if (ref.bareHeading && titles.some((title) => wanted.startsWith(`${title} `))) {
              sectionRefsSkipped++;
              referencesChecked--;
            } else fail(`missing heading "${ref.section.replace(/\s+/g, ' ')}" in "${ref.path}"`);
          }
        }
      }
    }
  }
  hits.sort((a, b) => files.indexOf(a.file) - files.indexOf(b.file) || a.line - b.line);
  return { hits, filesScanned: files.length, referencesChecked, sectionRefsSkipped };
}
