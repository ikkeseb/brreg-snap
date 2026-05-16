// The popup is the entire toolbar UI surface. The service worker
// hosts the context-menu handler and (when granted) the tab-switch
// listeners that drive sidebar auto-refresh.
//
// `tabs` is in optional_permissions. Listeners are attached only
// when the user has both (a) granted tabs and (b) flipped the
// auto-sync toggle on. Both conditions are re-checked at boot
// because the service worker dies and respawns under MV3.

import { AUTO_SYNC_STORAGE_KEY, getAutoSync } from '../lib/auto-sync-settings.js';
import { deriveSync, deriveSyncAsync } from '../lib/tab-sync.js';

const MENU_ID = 'show-in-brreg-sidebar';

function registerMenu(): void {
  // menus.create is idempotent only across browser restarts, not within
  // the same session — calling it twice with the same id throws. Both
  // onInstalled and onStartup fire once per session at most, so a
  // single create call from each is safe.
  browser.menus.create({
    id: MENU_ID,
    title: 'Vis i brreg-snap sidebar',
    contexts: ['page'],
  });
}

browser.runtime.onInstalled.addListener(registerMenu);
browser.runtime.onStartup.addListener(registerMenu);

async function broadcastSync(
  orgnr: string,
  host: string | undefined,
): Promise<void> {
  try {
    await browser.runtime.sendMessage({ type: 'sync', orgnr, host });
  } catch {
    // No listener (sidebar closed) — sendMessage rejects. Silent: the
    // menu item, refresh button, and auto-sync are all best-effort;
    // the user can re-open the sidebar to pick up the latest state.
  }
}

async function broadcastNoMatch(host: string | undefined): Promise<void> {
  // Sent when a deliberate trigger (menu click, tab activate / update
  // with auto-sync on) lands on a page where we can't resolve an
  // orgnr. Lets the sidebar clear stale state instead of pretending
  // the previous company is still relevant.
  try {
    await browser.runtime.sendMessage({ type: 'no-match', host });
  } catch {
    // Sidebar closed — nothing to update.
  }
}

function hostFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

browser.menus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  // SYNC resolve only — setPanel + open must fire inside the user-
  // gesture stack and the first await would consume the activation
  // token. See docs/notes/permissions-model.md § gesture-stack.
  const sync = deriveSync(tab?.url, tab?.title);
  const host = hostFromUrl(tab?.url);

  // Encode the target state into the panel URL so a fresh sidebar
  // opens on the right page even if the broadcast races the panel's
  // listener registration.
  const panelUrl = sync
    ? browser.runtime.getURL(
        `details/details.html?orgnr=${encodeURIComponent(sync.orgnr)}`,
      )
    : host
      ? browser.runtime.getURL(
          `details/details.html?nomatch=${encodeURIComponent(host)}`,
        )
      : browser.runtime.getURL('details/details.html');
  void browser.sidebarAction.setPanel({ panel: panelUrl });
  void browser.sidebarAction.open();

  // For the already-open case: setPanel doesn't reliably repaint a
  // visible sidebar in Firefox 115+, so broadcast a message that the
  // live panel listens for and re-renders in place. Now safe to
  // await — the gesture-stack work is done.
  if (sync) {
    void broadcastSync(sync.orgnr, sync.host);
    return;
  }
  // Sync miss: kick the async resolver (hostname-based brreg search).
  // If it finds a match, broadcast sync — the sidebar's onMessage
  // listener will swap from the no-match empty state to the company
  // panel without a reload. If it also misses, broadcast no-match so
  // an already-open sidebar clears stale state.
  void (async () => {
    const asyncSync = await deriveSyncAsync(tab?.url, tab?.title);
    if (asyncSync) {
      await broadcastSync(asyncSync.orgnr, asyncSync.host);
      return;
    }
    await broadcastNoMatch(host);
  })();
});

// --- auto-sync tab listeners --------------------------------------

async function handleActivated(
  info: browser.tabs._OnActivatedActiveInfo,
): Promise<void> {
  try {
    const tab = await browser.tabs.get(info.tabId);
    const sync = await deriveSyncAsync(tab.url, tab.title);
    if (sync) {
      await broadcastSync(sync.orgnr, sync.host);
      return;
    }
    await broadcastNoMatch(hostFromUrl(tab.url));
  } catch {
    // Tab gone, permission revoked mid-flight, etc. — drop silently.
  }
}

async function handleUpdated(
  _tabId: number,
  changeInfo: browser.tabs._OnUpdatedChangeInfo,
  tab: browser.tabs.Tab,
): Promise<void> {
  // Only fire on URL transitions; title-only updates from media
  // playback or notification badges shouldn't churn the sidebar.
  if (!changeInfo.url) return;
  if (!tab.active) return;
  const sync = await deriveSyncAsync(tab.url, tab.title);
  if (sync) {
    await broadcastSync(sync.orgnr, sync.host);
    return;
  }
  await broadcastNoMatch(hostFromUrl(tab.url));
}

// Sync wrappers around the async handlers so addListener gets a
// void-returning function (browser event listeners are fire-and-forget;
// returning a Promise would mislead the type system). Module-level so
// addListener / removeListener see the same reference.
function onActivatedListener(info: browser.tabs._OnActivatedActiveInfo): void {
  void handleActivated(info);
}

function onUpdatedListener(
  tabId: number,
  changeInfo: browser.tabs._OnUpdatedChangeInfo,
  tab: browser.tabs.Tab,
): void {
  void handleUpdated(tabId, changeInfo, tab);
}

let listenersAttached = false;

function attachTabListeners(): void {
  if (listenersAttached) return;
  browser.tabs.onActivated.addListener(onActivatedListener);
  // Firefox-specific filter so the listener fires only on url changes.
  // handleUpdated() already bails on !changeInfo.url, so the filter is
  // pure overhead reduction — no behavior change. Skips noise from
  // favicon, title, status, mutedInfo and audible updates.
  browser.tabs.onUpdated.addListener(onUpdatedListener, {
    properties: ['url'],
  });
  listenersAttached = true;
}

function detachTabListeners(): void {
  if (!listenersAttached) return;
  browser.tabs.onActivated.removeListener(onActivatedListener);
  browser.tabs.onUpdated.removeListener(onUpdatedListener);
  listenersAttached = false;
}

async function reconcileListeners(): Promise<void> {
  const [hasTabs, toggleOn] = await Promise.all([
    browser.permissions.contains({ permissions: ['tabs'] }),
    getAutoSync(),
  ]);
  if (hasTabs && toggleOn) {
    attachTabListeners();
  } else {
    detachTabListeners();
  }
}

browser.permissions.onAdded.addListener((perms) => {
  if (!perms.permissions?.includes('tabs')) return;
  void reconcileListeners();
});

browser.permissions.onRemoved.addListener((perms) => {
  if (!perms.permissions?.includes('tabs')) return;
  // Belt-and-braces: detach immediately even before reconcile lands,
  // so a stray tab event between revoke and storage flush can't fire.
  detachTabListeners();
  void reconcileListeners();
});

// React to the toggle being flipped in the sidebar (storage.local
// write). storage.onChanged fires for both local and session areas;
// gate on areaName to avoid waking on cache writes.
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (!(AUTO_SYNC_STORAGE_KEY in changes)) return;
  void reconcileListeners();
});

// Boot reconciliation — MV3 service workers die and respawn; we
// can't rely on listener registration from a previous session.
browser.runtime.onInstalled.addListener(() => void reconcileListeners());
browser.runtime.onStartup.addListener(() => void reconcileListeners());

// Also reconcile on cold start of this module (covers the case where
// the worker wakes from an event without firing onStartup, e.g. a
// runtime.onMessage). Best-effort; harmless if it runs twice.
void reconcileListeners();
