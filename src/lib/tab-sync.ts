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

// --- auto-sync tab listeners (hosted by the panel) ------------------
//
// The panel registers these only while auto-sync is on, and only for
// its own window. Closing the panel unloads its document and the
// listeners with it, so no tab is resolved — and nothing is sent to
// brreg — while no panel is open. See sidebar-sync.md § panel-hosted-
// auto-sync.

export interface ActivatedInfo {
  tabId: number;
  windowId: number;
}

export interface UpdatedTab {
  id?: number;
  url?: string;
  title?: string;
  active: boolean;
  windowId?: number;
}

type ActivatedListener = (info: ActivatedInfo) => void;
type UpdatedListener = (
  tabId: number,
  changeInfo: { url?: string },
  tab: UpdatedTab,
) => void;

// The slice of browser.tabs the watcher touches, so tests can hand in
// a fake.
export interface TabEvents {
  onActivated: {
    addListener(cb: ActivatedListener): void;
    removeListener(cb: ActivatedListener): void;
  };
  onUpdated: {
    addListener(
      cb: UpdatedListener,
      filter?: { properties: ['url']; windowId: number },
    ): void;
    removeListener(cb: UpdatedListener): void;
  };
}

export function followsActivation(
  info: ActivatedInfo,
  windowId: number,
): boolean {
  return info.windowId === windowId;
}

// Only URL transitions of the tab the user is looking at in this
// window. Title-only churn (media playback, unread badges) and
// navigations in background tabs or other windows don't move the panel.
export function followsUpdate(
  changeInfo: { url?: string },
  tab: UpdatedTab,
  windowId: number,
): boolean {
  return !!changeInfo.url && tab.active && tab.windowId === windowId;
}

export interface TabWatcher {
  attach(): void;
  detach(): void;
  isAttached(): boolean;
}

export function createTabWatcher(opts: {
  tabs: TabEvents;
  windowId: number;
  // Firefox takes an onUpdated filter; Chrome throws "This event does
  // not support filters" at registration. followsUpdate is the real
  // gate on both — the filter only spares Firefox the wakeups.
  supportsUpdateFilter: boolean;
  onTabChange: (tabId: number, tab?: UpdatedTab) => void;
}): TabWatcher {
  const { tabs, windowId, onTabChange } = opts;
  let attached = false;

  const onActivated: ActivatedListener = (info) => {
    if (followsActivation(info, windowId)) onTabChange(info.tabId);
  };
  const onUpdated: UpdatedListener = (tabId, changeInfo, tab) => {
    if (followsUpdate(changeInfo, tab, windowId)) onTabChange(tabId, tab);
  };

  return {
    attach(): void {
      if (attached) return;
      attached = true;
      tabs.onActivated.addListener(onActivated);
      if (opts.supportsUpdateFilter) {
        tabs.onUpdated.addListener(onUpdated, {
          properties: ['url'],
          windowId,
        });
      } else {
        tabs.onUpdated.addListener(onUpdated);
      }
    },
    detach(): void {
      if (!attached) return;
      attached = false;
      tabs.onActivated.removeListener(onActivated);
      tabs.onUpdated.removeListener(onUpdated);
    },
    isAttached(): boolean {
      return attached;
    },
  };
}
