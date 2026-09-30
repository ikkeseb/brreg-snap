// The panel's entry: wiring only. Looks up the document, renders the
// masthead, builds the painter and the controller, hooks the browser
// events, and starts. The decisions live in controller.ts; the markup
// in painter.ts.

// Side-effect import: aliases `globalThis.browser = chrome` on Chromium
// before any `browser.*` access. Must stay the first import.
import '../lib/platform/globals.js';
import {
  AUTO_SYNC_STORAGE_KEY,
  getAutoSync,
  setAutoSync,
} from '../lib/auto-sync-settings.js';
import { invalidateCache } from '../lib/brreg.js';
import { loadCompany } from '../lib/company-load.js';
import { writeClipboard } from '../lib/copy-orgnr.js';
import {
  addRejectedChoice,
  forgetHost,
  getRememberedChoice,
  searchByHostnameDetailed,
  setPickerChoice,
} from '../lib/hostname-search.js';
import {
  isForWindow,
  parsePanelMessage,
  readPanelHint,
} from '../lib/panel-protocol.js';
import { isFirefox } from '../lib/platform/engine.js';
import { createTabWatcher } from '../lib/tab-sync.js';
import { getRecent, pushRecent } from '../lib/ui/recent.js';
import { resolveTabContext } from '../lib/ui/resolve-tab.js';
import { liveRegionOf } from '../lib/view/components/live.js';
import { renderMasthead } from '../lib/view/components/masthead.js';
import { createSwitchAutoSyncUi } from './auto-sync-switch.js';
import { wireAutoSync } from './auto-sync-ui.js';
import { createPanelController } from './controller.js';
import { createPanelHistory } from './history.js';
import { createPanelPainter } from './painter.js';

function main(): void {
  const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const live = liveRegionOf(byId('live'));
  // The masthead is rendered once: its search field is the manual
  // search from every state and its switch keeps its state across paints.
  const mast = renderMasthead(byId('mast'), { kind: 'panel', autoSync: { on: false } });
  const searchInput = mast.input!;
  const autoSyncToggle = mast.toggle!;
  // What «Rapporter feil treff» reports about this install. getManifest
  // is optional-called: the preview harness's shim has none.
  const env = {
    version: browser.runtime.getManifest?.()?.version ?? '',
    browser: isFirefox ? 'Firefox' : 'Chrome',
  };

  // The window this panel document lives in. Firefox sidebars and
  // Chrome side panels are one document per browser window, and
  // windows.getCurrent() called from one returns that window (MDN
  // windows.getCurrent; Chrome windows § "The current window"). Messages
  // and tab events are scoped to it.
  const panelWindowId: Promise<number | undefined> = browser.windows
    .getCurrent()
    .then(
      (win) => win.id,
      () => undefined,
    );

  const history = createPanelHistory(window);

  const controller = createPanelController({
    painter: (intents) =>
      createPanelPainter(
        {
          body: document.body,
          search: searchInput,
          stick: byId('stick'),
          back: byId<HTMLButtonElement>('back'),
          main: byId('app'),
          foot: byId('foot'),
          live,
        },
        intents,
        {
          initialTab: history.tabFromUrl(),
          deps: { copy: writeClipboard, getRecent, getRememberedChoice, setPickerChoice, env },
        },
      ),
    history,
    hasFocus: () => document.hasFocus(),
    ownUrlPrefix: browser.runtime.getURL(''),
    // tabs.query returns the active tab's url and title only when the
    // extension may read them: an activeTab grant (Firefox grants it on
    // the user action that toggles the sidebar — the sidebar icon, our
    // toolbar action, a keyboard shortcut; the context menu too) or the
    // auto-sync `tabs` opt-in. Otherwise they come back empty and the
    // panel falls back to its URL hint (panel-follow.ts § chooseStart).
    // The cascade itself is shared with the popup — lib/ui/resolve-tab.ts.
    queryActiveTab: async () => {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      return tabs[0];
    },
    getTab: (tabId) => browser.tabs.get(tabId),
    resolveTab: resolveTabContext,
    searchHost: searchByHostnameDetailed,
    loadCompany,
    invalidateCache,
    pushRecent,
    addRejectedChoice,
    forgetHost,
    getRememberedChoice,
  });

  async function setupAutoSync(): Promise<void> {
    const windowId = await panelWindowId;
    const autoSync = wireAutoSync(createSwitchAutoSyncUi(autoSyncToggle, byId('under-mast'), live), {
      permissions: browser.permissions,
      getAutoSync,
      setAutoSync,
      // Only when the panel knows its window: otherwise it can't tell its
      // own tabs from other windows' and follows none.
      watcher:
        windowId === undefined
          ? undefined
          : createTabWatcher({
              tabs: browser.tabs,
              windowId,
              supportsUpdateFilter: isFirefox,
              onTabChange: (tabId, tab) => {
                void controller.followTab(tabId, tab);
              },
            }),
    });
    await autoSync.reconcile();
    // A revoke outside the panel (about:addons): detach and untick live.
    browser.permissions.onRemoved.addListener((perms) => {
      void autoSync.permissionsRemoved(perms);
    });
    // The toggle flipped in another window's panel: follow suit here.
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !(AUTO_SYNC_STORAGE_KEY in changes)) return;
      void autoSync.reconcile();
    });
  }

  // Messages from the popup (sync after it resolved the tab, no-match
  // after «Ingen av disse») and the context menu. Firefox's global
  // setPanel reloads an open sidebar in one window only, not necessarily
  // the sender's, so the sender tells the panel directly. runtime
  // messages reach every extension page, so each names its window and
  // the other windows' panels ignore it.
  browser.runtime.onMessage.addListener((raw: unknown) => {
    const msg = parsePanelMessage(raw);
    if (!msg) return;
    void panelWindowId.then((windowId) => {
      if (!isForWindow(msg, windowId)) return;
      if (msg.type === 'sync') {
        controller.follow({
          kind: 'company',
          orgnr: msg.orgnr,
          method: msg.method,
          host: msg.host,
        });
      } else if (msg.type === 'search') {
        controller.intents.search(msg.query);
      } else {
        void controller.probe(msg.host);
      }
    });
  });

  // Browser Back / Forward within the panel.
  window.addEventListener('popstate', (ev) => controller.restore(ev.state));

  async function init(): Promise<void> {
    // ?orgnr= / ?nomatch= / ?q= is a hint from whoever opened the panel
    // (popup link, context menu), stamped with the open's time and
    // window; a hint for another window counts as none. Messages wait
    // on the same window promise, queued behind this await, so start
    // still claims its load token first and a message that arrives
    // during startup wins.
    const search = window.location.search;
    const now = Date.now();
    const hint = readPanelHint(search, now, await panelWindowId);
    return controller.init(hint);
  }

  void setupAutoSync();
  void init();
}

main();
