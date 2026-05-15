import { resolveOrgnr, resolveOrgnrAsync } from './orgnr.js';

export interface TabSync {
  orgnr: string;
  host: string | undefined;
}

function hostFrom(tabUrl: string): string | undefined {
  try {
    return new URL(tabUrl).hostname;
  } catch {
    return undefined;
  }
}

// Pure derivation from raw tab fields → broadcast payload. Used by
// the context menu (inside the user-gesture stack — see
// permissions-model.md § gesture-stack), the sidebar refresh button,
// and the auto-sync tab listeners. Side effects
// (browser.runtime.sendMessage, browser.tabs.*) stay in their
// respective call sites.
export function deriveSync(
  tabUrl: string | undefined,
  tabTitle: string | undefined,
): TabSync | null {
  if (!tabUrl) return null;
  const orgnr = resolveOrgnr({ url: tabUrl, title: tabTitle ?? '' });
  if (!orgnr) return null;
  return { orgnr, host: hostFrom(tabUrl) };
}

// Async variant — runs the full cascade including hostname-based
// brreg search. Callers outside the user-gesture stack (popup init,
// sidebar resolveFromActiveTab, background tab listeners) should
// prefer this so any host that brreg can resolve (e.g. yara.com via
// hjemmeside-exact match) gets picked up.
export async function deriveSyncAsync(
  tabUrl: string | undefined,
  tabTitle: string | undefined,
): Promise<TabSync | null> {
  if (!tabUrl) return null;
  const orgnr = await resolveOrgnrAsync({
    url: tabUrl,
    title: tabTitle ?? '',
  });
  if (!orgnr) return null;
  return { orgnr, host: hostFrom(tabUrl) };
}
