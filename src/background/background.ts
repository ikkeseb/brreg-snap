// The popup is the entire toolbar UI surface. The background script
// hosts the context-menu handler and the tab-switch listeners that
// drive sidebar auto-refresh.
//
// `tabs` is in optional_permissions. The tab-event listeners are
// registered unconditionally at top level (required for MV3-style
// event-page wakeup — see § event-page-wakeup below) and gate on
// permission + toggle internally. Without both, the handler returns
// before touching tab.url/title.

// Side-effect import: aliases `globalThis.browser = chrome` on Chromium
// before any `browser.*` access. Must stay the first import.
import '../lib/platform/globals.js';
import { sidebar } from '../lib/platform/sidebar.js';
import { menus } from '../lib/platform/menus.js';
import { isFirefox } from '../lib/platform/engine.js';
import { getAutoSync } from '../lib/auto-sync-settings.js';
import { deriveSync, deriveSyncAsync } from '../lib/tab-sync.js';

const MENU_ID = 'show-in-brreg-sidebar';

function registerMenu(): void {
  // `menus` resolves to browser.menus on Firefox and chrome.contextMenus
  // on Chromium (see platform/menus.ts) — the two engines expose the
  // same API under different namespaces, and browser.contextMenus is
  // undefined on Firefox under the `menus` permission.
  //
  // The trailing callback reads runtime.lastError to swallow Chrome's
  // async "Cannot create item with duplicate id" — context menus
  // persist across service-worker restarts there, and onInstalled /
  // onStartup can each re-run this. On Firefox the callback is a no-op
  // (create is idempotent across restarts; only one of onInstalled /
  // onStartup fires per session). Result: one menu item either way.
  menus.create(
    {
      id: MENU_ID,
      title: 'Vis i brreg-snap sidebar',
      contexts: ['page'],
    },
    () => void browser.runtime.lastError,
  );
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

menus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  // SYNC resolve only — setPanel + open must fire inside the user-
  // gesture stack and the first await would consume the activation
  // token. See docs/notes/permissions-model.md § gesture-stack.
  // (Chrome's sidePanel.open enforces the same live-gesture rule.)
  const sync = deriveSync(tab?.url, tab?.title);
  const host = hostFromUrl(tab?.url);

  // Encode the target state into the panel path so a fresh sidebar
  // opens on the right page even if the broadcast races the panel's
  // listener registration. The adapter resolves this relative path to
  // an absolute URL on Firefox and feeds it to setOptions on Chrome.
  const panelPath = sync
    ? `details/details.html?orgnr=${encodeURIComponent(sync.orgnr)}`
    : host
      ? `details/details.html?nomatch=${encodeURIComponent(host)}`
      : 'details/details.html';
  sidebar.setPanel(panelPath);
  sidebar.open({ windowId: tab?.windowId, tabId: tab?.id });

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

// Monotonic sequence over tab events (shared by onActivated and
// onUpdated — both feed the same sidebar). deriveSyncAsync can hit the
// network, so two rapid tab switches A→B can resolve out of order:
// without sequencing, slow-A's broadcast lands after fast-B's and the
// sidebar shows the wrong company. Handlers claim a slot synchronously
// at event entry and re-check after their awaits — superseded events
// drop their broadcast.
let tabEventSeq = 0;

async function refreshAutoSyncEnabled(): Promise<void> {
  // Reconcile the in-memory flag from the runtime `tabs` grant + the
  // stored toggle. Same on both engines: `tabs` is an optional
  // (runtime opt-in) permission in each manifest, so it stays false
  // until the user flips the auto-sync toggle and grants it.
  const [hasTabs, toggleOn] = await Promise.all([
    browser.permissions.contains({ permissions: ['tabs'] }),
    getAutoSync(),
  ]);
  autoSyncEnabled = hasTabs && toggleOn;
}

async function handleActivated(
  info: browser.tabs._OnActivatedActiveInfo,
  seq: number,
): Promise<void> {
  try {
    const tab = await browser.tabs.get(info.tabId);
    const sync = await deriveSyncAsync(tab.url, tab.title);
    // Superseded by a newer tab event while we resolved — its
    // broadcast (already sent or about to be) is the truthful one.
    if (seq !== tabEventSeq) return;
    if (sync) {
      await broadcastSync(sync.orgnr, sync.host);
      return;
    }
    await broadcastNoMatch(hostFromUrl(tab.url));
  } catch {
    // Tab gone, permission revoked mid-flight, etc. — drop silently.
  }
}

async function handleUpdated(tab: browser.tabs.Tab, seq: number): Promise<void> {
  try {
    const sync = await deriveSyncAsync(tab.url, tab.title);
    // Superseded by a newer tab event while we resolved — drop.
    if (seq !== tabEventSeq) return;
    if (sync) {
      await broadcastSync(sync.orgnr, sync.host);
      return;
    }
    await broadcastNoMatch(hostFromUrl(tab.url));
  } catch {
    // Parity with handleActivated — resolution/broadcast failures
    // (network glitch, sidebar gone) drop silently.
  }
}

// Top-level synchronous registration. The handler gates on the
// in-memory `autoSyncEnabled` cache; on cold start the cache is
// false, so the first event after wakeup awaits a refresh before
// dispatching. Subsequent events hit the cached value synchronously.
browser.tabs.onActivated.addListener((info) => {
  // Claim the sequence slot synchronously at event entry — arrival
  // order, not resolution-completion order, decides which broadcast
  // wins (see tabEventSeq above).
  const seq = ++tabEventSeq;
  void (async () => {
    if (!autoSyncEnabled) await refreshAutoSyncEnabled();
    if (!autoSyncEnabled) return;
    await handleActivated(info, seq);
  })();
});

function onUpdatedDispatch(
  _tabId: number,
  changeInfo: browser.tabs._OnUpdatedChangeInfo,
  tab: browser.tabs.Tab,
): void {
  // Only fire on URL transitions; title-only updates from media
  // playback or notification badges shouldn't churn the sidebar.
  // These guards run BEFORE claiming a sequence slot — background-tab
  // churn must not invalidate an in-flight resolution for the tab the
  // user is actually looking at.
  if (!changeInfo.url) return;
  if (!tab.active) return;
  const seq = ++tabEventSeq;
  void (async () => {
    if (!autoSyncEnabled) await refreshAutoSyncEnabled();
    if (!autoSyncEnabled) return;
    await handleUpdated(tab, seq);
  })();
}

// Firefox supports an onUpdated filter ({properties:['url']}) so the
// listener fires only on URL changes — pure overhead reduction, since
// handleUpdated() already bails on !changeInfo.url. Chrome's onUpdated
// rejects ANY filter argument ("This event does not support filters")
// and throws at registration, which would abort the rest of this module
// (the permission/storage reconciliation listeners and the seed below).
// So pass the filter only where it's supported; on Chrome the handler's
// own !changeInfo.url guard does the same job at the cost of a few extra
// (cheap, autoSync-gated) wakeups.
if (isFirefox) {
  browser.tabs.onUpdated.addListener(onUpdatedDispatch, {
    properties: ['url'],
  });
} else {
  browser.tabs.onUpdated.addListener(onUpdatedDispatch);
}

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
