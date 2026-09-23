// The popup is the entire toolbar UI surface. The background script
// hosts only the context menu: registering it on install/startup and
// opening the panel when it's clicked.
//
// It registers no tab listeners. Auto-sync («Auto-oppdater ved
// fane-bytte») lives in the panel itself (details.ts), which exists
// only while the sidebar / side panel is open — so no tab is resolved
// and nothing reaches brreg while it's closed, and the event page /
// service worker isn't woken on every tab switch. See
// docs/notes/sidebar-sync.md § panel-hosted-auto-sync.

// Side-effect import: aliases `globalThis.browser = chrome` on Chromium
// before any `browser.*` access. Must stay the first import.
import '../lib/platform/globals.js';
import { sidebar } from '../lib/platform/sidebar.js';
import { menus } from '../lib/platform/menus.js';
import { notifyPanel, panelPath } from '../lib/panel-protocol.js';
import { deriveSync } from '../lib/tab-sync.js';

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

// Top-level, synchronous registration: the background is a
// non-persistent event page / service worker, and the runtime only
// wakes it for events whose addListener ran during module evaluation.
browser.runtime.onInstalled.addListener(registerMenu);
browser.runtime.onStartup.addListener(registerMenu);

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

  // Encode the target into the panel path, stamped with this click's
  // time, so a panel opened by this click shows it even if the message
  // below races the panel's listener registration — and so the same
  // path, left behind as the global panel URL, can't override the
  // active tab on some later open. The adapter resolves this relative
  // path to an absolute URL on Firefox and feeds it to setOptions on
  // Chrome.
  sidebar.setPanel(
    panelPath(
      sync ? { orgnr: sync.orgnr } : host ? { nomatch: host } : undefined,
      Date.now(),
    ),
  );
  sidebar.open({ windowId: tab?.windowId, tabId: tab?.id });

  // For the already-open case: setPanel doesn't reliably repaint a
  // visible sidebar in Firefox 115+, so tell this window's panel
  // directly. On a sync miss the panel runs the picker-aware host
  // search itself — the one resolver, and it can show the picker.
  const windowId = tab?.windowId;
  if (windowId === undefined) return;
  void notifyPanel(
    sync
      ? { type: 'sync', windowId, orgnr: sync.orgnr, host: sync.host, method: 'url' }
      : { type: 'no-match', windowId, host },
  );
});
