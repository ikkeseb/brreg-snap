// The popup is the entire toolbar UI surface. The background script
// hosts only the entry points that open the panel: the two context-menu
// items (the page, and «Slå opp «…»» on selected text) and, on Chrome,
// the «open-panel» keyboard command — plus the install hook that opens
// the welcome page once. Firefox opens its sidebar from the
// built-in `_execute_sidebar_action` command, which needs no listener.
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
import { extractOrgnrFromText } from '../lib/orgnr.js';
import {
  normalizeQuery,
  notifyPanel,
  panelPath,
  type PanelTarget,
} from '../lib/panel-protocol.js';
import { deriveSync } from '../lib/tab-sync.js';

const MENU_ID = 'show-in-brreg-sidebar';
const SELECTION_MENU_ID = 'lookup-selection';
// Chrome only (manifest.chrome.json `commands`): Chrome has no built-in
// command that opens the side panel, but sidePanel.open() accepts a
// keyboard shortcut as the user gesture.
const OPEN_PANEL_COMMAND = 'open-panel';

// The fields of tabs.Tab the entry points read. activeTab fills url
// and title for the tab the gesture was on.
interface GestureTab {
  id?: number;
  windowId?: number;
  url?: string;
  title?: string;
}

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
  // %s is the selected text; both engines shorten a long selection in
  // the menu label themselves.
  menus.create(
    {
      id: SELECTION_MENU_ID,
      title: 'Slå opp «%s» i brreg-snap',
      contexts: ['selection'],
    },
    () => void browser.runtime.lastError,
  );
}

// The first-run page, once: a fresh install, not an update, and not a
// temporary load (about:debugging / web-ext run: Firefox marks those;
// Chrome's unpacked load counts as an install). tabs.create needs no
// permission for one of the extension's own pages. See
// docs/notes/permissions-model.md § install-tab.
const WELCOME_PATH = 'welcome/welcome.html';

function onInstalled(details: { reason?: string; temporary?: boolean } | undefined): void {
  registerMenu();
  if (details?.reason !== 'install' || details.temporary) return;
  void browser.tabs.create({ url: browser.runtime.getURL(WELCOME_PATH) });
}

// Top-level, synchronous registration: the background is a
// non-persistent event page / service worker, and the runtime only
// wakes it for events whose addListener ran during module evaluation.
browser.runtime.onInstalled.addListener(onInstalled);
browser.runtime.onStartup.addListener(registerMenu);

function hostFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

// setPanel + open, synchronously: both must fire inside the user-
// gesture stack and the first await would consume the activation
// token. See docs/notes/permissions-model.md § gesture-stack. (Chrome's
// sidePanel.open enforces the same live-gesture rule.)
//
// The target is encoded into the panel path, stamped with this
// gesture's time and window, so a panel opened by it shows the target
// even if a follow-up message races the panel's listener registration
// — while the same path, left behind as the global panel URL or loaded
// into another window's open panel, can't override that panel's own
// tab. The adapter resolves this relative path to an absolute URL on
// Firefox and feeds it to setOptions on Chrome.
function openPanel(target: PanelTarget, tab: GestureTab | undefined): void {
  sidebar.setPanel(panelPath(target, Date.now(), tab?.windowId));
  sidebar.open({ windowId: tab?.windowId, tabId: tab?.id });
}

// «Vis i brreg-snap sidebar» and Chrome's open-panel shortcut: show
// what the page resolves to.
function openOnPage(tab: GestureTab | undefined): void {
  // SYNC resolve only — see openPanel.
  const sync = deriveSync(tab?.url, tab?.title);
  const host = hostFromUrl(tab?.url);
  openPanel(sync ? { orgnr: sync.orgnr } : host ? { nomatch: host } : undefined, tab);

  // For the already-open case: Firefox's global setPanel reloads an
  // open sidebar in only one window, not necessarily this one
  // (panel-protocol.ts), so tell this window's panel directly. On a
  // sync miss the panel runs the picker-aware host search itself — the
  // one resolver, and it can show the picker.
  const windowId = tab?.windowId;
  if (windowId === undefined) return;
  void notifyPanel(
    sync
      ? { type: 'sync', windowId, orgnr: sync.orgnr, host: sync.host, method: sync.method }
      : { type: 'no-match', windowId, host },
  );
}

// «Slå opp «…» i brreg-snap» on selected text. An orgnr in it (any
// printed form, the single valid one) opens that company as the user's
// own choice ('manual': no «synket fra», no «Feil bedrift?»). Any other
// text opens the panel's search on it. Only the orgnr or the text
// itself ever leaves the browser — and only because the user chose
// this item.
function openOnSelection(
  selectionText: string | undefined,
  tab: GestureTab | undefined,
): void {
  const orgnr = extractOrgnrFromText(selectionText ?? '');
  const query = orgnr ? undefined : normalizeQuery(selectionText);
  openPanel(
    orgnr ? { orgnr, method: 'manual' } : query ? { query } : undefined,
    tab,
  );

  const windowId = tab?.windowId;
  if (windowId === undefined) return;
  if (orgnr) {
    void notifyPanel({ type: 'sync', windowId, orgnr, method: 'manual' });
  } else if (query) {
    void notifyPanel({ type: 'search', windowId, query });
  }
}

menus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID) openOnPage(tab);
  else if (info.menuItemId === SELECTION_MENU_ID) {
    openOnSelection(info.selectionText, tab);
  }
});

// Firefox's typings omit the tab argument Chrome (86+) and Firefox
// (77+) pass to onCommand.
type CommandListener = (command: string, tab?: GestureTab) => void;
const commands = (
  browser as { commands?: { onCommand: { addListener(cb: CommandListener): void } } }
).commands;
commands?.onCommand.addListener((command, tab) => {
  if (command === OPEN_PANEL_COMMAND) openOnPage(tab);
});
