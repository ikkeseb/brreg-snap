import { searchByHostname } from './hostname-search.js';
import { isValidOrgnr } from './mod11.js';

const ORGNR_RE = /\b(\d{9})\b/g;
// Canonical Norwegian display format: three groups of three digits
// with ONE consistent separator — "982 463 718", "982.463.718", or
// the same with non-breaking spaces (U+00A0, common in rendered
// footers). The \2 backreference rejects mixed separators
// ("982 463.718" is a coincidence of unrelated numbers, not the
// display format). The lookarounds reject groups embedded in longer
// spaced/dotted digit sequences ("1982 463 718", "982 463 718 4")
// where the 3-3-3 alignment is more likely a phone or account number.
const SPACED_ORGNR_RE =
  /(?<!\d[ .\u00a0]?)(\d{3})([ .\u00a0])(\d{3})\2(\d{3})(?![ .\u00a0]?\d)/g;
// Query keys that explicitly name an organisasjonsnummer.
const ORGNR_PARAM_RE =
  /^(orgnr|orgnummer|organisasjonsnummer|organizationnumber|organizationid)$/i;

export { isValidOrgnr };

// Distinct mod-11-valid orgnr candidates found in `text` — contiguous
// 9-digit runs plus spaced/dotted display-format groups, the latter
// normalized to 9 digits. Both formats land in one set, so the same
// orgnr written "982463718" and "982 463 718" is a single candidate
// and the single-valid-candidate abstain rule applies across formats.
function validOrgnrsIn(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(ORGNR_RE)) {
    const candidate = match[1]!;
    if (isValidOrgnr(candidate)) seen.add(candidate);
  }
  for (const match of text.matchAll(SPACED_ORGNR_RE)) {
    const candidate = match[1]! + match[3]! + match[4]!;
    if (isValidOrgnr(candidate)) seen.add(candidate);
  }
  return [...seen];
}

export function extractOrgnrFromText(text: string): string | undefined {
  // Trust a 9-digit run ONLY when it is the single mod-11-valid candidate
  // in the text. Roughly ~9% of arbitrary 9-digit numbers pass mod-11, so
  // a tracking id / timestamp / SKU sitting before the real number used to
  // win by position and silently resolve the WRONG company. When two or
  // more distinct valid candidates appear we abstain (return undefined)
  // and let the caller fall through to the hostname pipeline / picker —
  // better no answer than a confidently wrong one. A single valid run
  // (even with earlier mod-11-INVALID runs around it) still resolves.
  const found = validOrgnrsIn(text);
  return found.length === 1 ? found[0] : undefined;
}

export interface ResolveContext {
  url: string;
  title: string;
}

function hostnameFrom(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

// Strong signal: a query param whose KEY explicitly names the orgnr
// (?orgnr=…, ?organisasjonsnummer=…). The page author labelled it, so it
// wins over any other 9-digit run in the URL — even a chance-valid
// tracking id. Abstains (undefined) when two differently-named orgnr
// values disagree, which is maximal ambiguity. A bare 9-digit path
// segment is deliberately NOT treated as authoritative: it is just as
// likely to be a product/article id, and trusting it would re-open the
// shadowing bug this fix exists to close — an unnamed path/query orgnr
// is instead handled by the single-candidate rule in resolveOrgnr.
function orgnrFromNamedParam(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const named = new Set<string>();
  for (const [key, value] of parsed.searchParams) {
    if (ORGNR_PARAM_RE.test(key)) {
      for (const orgnr of validOrgnrsIn(value)) named.add(orgnr);
    }
  }
  return named.size === 1 ? [...named][0] : undefined;
}

export function resolveOrgnr(ctx: ResolveContext): string | undefined {
  // (a) An explicitly-named ?orgnr= param wins outright (author intent),
  //     even amid other 9-digit runs.
  const named = orgnrFromNamedParam(ctx.url);
  if (named) return named;

  // (b)/(c) Otherwise trust only an unambiguous single mod-11 candidate —
  //     URL first, then title. Two or more distinct valid candidates
  //     anywhere in the text (a chance-valid tracking id alongside the
  //     real orgnr, in the path or query) → abstain and let the hostname
  //     pipeline / picker decide. Better no answer than a confidently
  //     wrong one.
  const fromUrl = extractOrgnrFromText(ctx.url);
  if (fromUrl) return fromUrl;

  const fromTitle = extractOrgnrFromText(ctx.title);
  if (fromTitle) return fromTitle;

  return undefined;
}

// Async variant that adds a hostname-based brreg search after the
// sync cascade misses. Callers that run inside a user-gesture stack
// (context menu → sidebarAction.open, click → permissions.request)
// must NOT await on this — the first await consumes the activation
// token and Firefox blocks the next browser API call. Those callers
// sync-resolve first, then run this on a detached promise for the
// broadcast.
export async function resolveOrgnrAsync(
  ctx: ResolveContext,
): Promise<string | undefined> {
  const sync = resolveOrgnr(ctx);
  if (sync) return sync;

  const hostname = hostnameFrom(ctx.url);
  if (!hostname) return undefined;
  return searchByHostname(hostname);
}
