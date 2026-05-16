// The popup is the entire toolbar UI surface. The background script
// hosts the context-menu handler and the tab-switch listeners that
// drive sidebar auto-refresh.
//
// `tabs` is in optional_permissions. The tab-event listeners are
// registered unconditionally at top level (required for MV3-style
// event-page wakeup — see § event-page-wakeup below) and gate on
// permission + toggle internally. Without both, the handler returns
// before touching tab.url/title.

import { getAutoSync } from '../lib/auto-sync-settings.js';
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
//
// SECTION: event-page-wakeup
// The background is a non-persistent event page; Firefox kills it on
// idle and re-evaluates the module on wakeup. For the runtime to wake
// us for a tab event, `addListener` must run synchronously at module
// top level — async registration (e.g. inside an awaited permission
// check) leaves the runtime unaware that this script should be
// dispatched the event, so events are silently dropped.
//
// Concretely: previous wiring did `void reconcileListeners()` at the
// bottom of the module, attaching `tabs.onActivated/onUpdated` only
// after awaiting `permissions.contains` and `getAutoSync()`. The
// script then went idle, was killed, and the next tab switch failed
// to wake it because no top-level addListener call was recorded.
// Auto-sync only worked while the inspector held the script alive.
//
// The fix: register unconditionally at top level, gate per-event on
// permission + toggle inside the handler. The permission/storage
// state is cached in-memory and refreshed via the change listeners
// below, so the hot path is a synchronous boolean check.

let autoSyncEnabled = false;

async function refreshAutoSyncEnabled(): Promise<void> {
  const [hasTabs, toggleOn] = await Promise.all([
    browser.permissions.contains({ permissions: ['tabs'] }),
    getAutoSync(),
  ]);
  autoSyncEnabled = hasTabs && toggleOn;
}

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

// Top-level synchronous registration. The handler gates on the
// in-memory `autoSyncEnabled` cache; on cold start the cache is
// false, so the first event after wakeup awaits a refresh before
// dispatching. Subsequent events hit the cached value synchronously.
browser.tabs.onActivated.addListener((info) => {
  void (async () => {
    if (!autoSyncEnabled) await refreshAutoSyncEnabled();
    if (!autoSyncEnabled) return;
    await handleActivated(info);
  })();
});

// Firefox-specific filter so the listener fires only on url changes.
// handleUpdated() already bails on !changeInfo.url, so the filter is
// pure overhead reduction — no behavior change. Skips noise from
// favicon, title, status, mutedInfo and audible updates.
browser.tabs.onUpdated.addListener(
  (tabId, changeInfo, tab) => {
    void (async () => {
      if (!autoSyncEnabled) await refreshAutoSyncEnabled();
      if (!autoSyncEnabled) return;
      await handleUpdated(tabId, changeInfo, tab);
    })();
  },
  { properties: ['url'] },
);

// Keep the cache in sync with permission and toggle changes so the
// hot path stays a synchronous boolean. The events below are top-level
// for the same wakeup reason as the tab listeners.
browser.permissions.onAdded.addListener((perms) => {
  if (!perms.permissions?.includes('tabs')) return;
  void refreshAutoSyncEnabled();
});

browser.permissions.onRemoved.addListener((perms) => {
  if (!perms.permissions?.includes('tabs')) return;
  autoSyncEnabled = false;
  void refreshAutoSyncEnabled();
});

browser.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName !== 'local') return;
  void refreshAutoSyncEnabled();
});

// Seed the cache on module load so the very first tab event after a
// cold wakeup doesn't have to wait on storage/permission lookups.
void refreshAutoSyncEnabled();
