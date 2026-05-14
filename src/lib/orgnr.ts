import { domainToOrgnr } from './domains.js';

const ORGNR_RE = /\b(\d{9})\b/;

export function isValidOrgnr(candidate: string): boolean {
  if (!/^\d{9}$/.test(candidate)) return false;
  return mod11Check(candidate);
}

function mod11Check(orgnr: string): boolean {
  const weights = [3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += Number(orgnr[i]) * weights[i]!;
  }
  const remainder = sum % 11;
  const checkDigit = remainder === 0 ? 0 : 11 - remainder;
  if (checkDigit === 10) return false;
  return checkDigit === Number(orgnr[8]);
}

export function extractOrgnrFromText(text: string): string | undefined {
  const match = ORGNR_RE.exec(text);
  if (!match) return undefined;
  const candidate = match[1]!;
  return isValidOrgnr(candidate) ? candidate : undefined;
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
