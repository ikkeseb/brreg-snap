import { resolveOrgnr } from './orgnr.js';

export interface TabSync {
  orgnr: string;
  host: string | undefined;
}

// Pure derivation from raw tab fields → broadcast payload. Used by
// the context menu, the sidebar refresh button, and the auto-sync
// tab listeners. Side effects (browser.runtime.sendMessage,
// browser.tabs.*) stay in their respective call sites.
export function deriveSync(
  tabUrl: string | undefined,
  tabTitle: string | undefined,
): TabSync | null {
  if (!tabUrl) return null;
  const orgnr = resolveOrgnr({ url: tabUrl, title: tabTitle ?? '' });
  if (!orgnr) return null;
  let host: string | undefined;
  try {
    host = new URL(tabUrl).hostname;
  } catch {
    /* invalid url — leave host undefined */
  }
  return { orgnr, host };
}
