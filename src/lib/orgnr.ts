import { searchByHostname } from './hostname-search.js';
import { isValidOrgnr } from './mod11.js';

const ORGNR_RE = /\b(\d{9})\b/g;

export { isValidOrgnr };

export function extractOrgnrFromText(text: string): string | undefined {
  // Iterate every 9-digit run in text. The first mod-11 valid candidate
  // wins. A URL like /?ref=123456789&orgnr=982463718 would otherwise be
  // disqualified by an upstream phone number or article id.
  for (const match of text.matchAll(ORGNR_RE)) {
    const candidate = match[1]!;
    if (isValidOrgnr(candidate)) return candidate;
  }
  return undefined;
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

export function resolveOrgnr(ctx: ResolveContext): string | undefined {
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
