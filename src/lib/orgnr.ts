import { domainToOrgnr } from './domains.js';
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

export function resolveOrgnr(ctx: ResolveContext): string | undefined {
  const fromUrl = extractOrgnrFromText(ctx.url);
  if (fromUrl) return fromUrl;

  const fromTitle = extractOrgnrFromText(ctx.title);
  if (fromTitle) return fromTitle;

  try {
    const { hostname } = new URL(ctx.url);
    const fromDomain = domainToOrgnr(hostname);
    if (fromDomain) return fromDomain;
  } catch {
    // ignore malformed URL (e.g. about:newtab)
  }

  return undefined;
}
