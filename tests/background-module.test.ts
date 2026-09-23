// The background hosts only the context menu. Two things matter:
//
//   - Its listeners register synchronously at module top level. It is a
//     non-persistent event page / service worker, and the runtime only
//     wakes it for events whose addListener ran during evaluation.
//     (Caught the hard way: a listener attached after an await worked
//     only while about:debugging's Inspector kept the script alive.)
//   - It touches no tab events at all. Auto-sync lives in the panel, so
//     with the panel closed nothing resolves tabs or reaches brreg —
//     the promise PRIVACY.md makes — and the worker isn't woken on
//     every tab switch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// If the background ever resolved a host itself, it would go through
// the brreg client — the menu tests assert it never does.
vi.mock('../src/lib/brreg.js', () => ({
  searchEnheterWithParams: vi.fn(async () => []),
}));

import { searchEnheterWithParams } from '../src/lib/brreg.js';
import { fakeBrowser } from './helpers/fake-browser.js';

type Fn = ReturnType<typeof vi.fn>;
type EventSpy = { addListener: Fn; removeListener: Fn };

type MenusMock = {
  create: Fn;
  onClicked: EventSpy;
};

// The context-menu API lives under a different namespace per engine
// (browser.menus on Firefox, browser.contextMenus on Chromium). Reach
// for whichever the mock exposes.
function menusSpy(mock: unknown): MenusMock {
  const m = mock as { menus?: MenusMock; contextMenus?: MenusMock };
  const api = m.menus ?? m.contextMenus;
  if (!api) throw new Error('mock exposes neither menus nor contextMenus');
  return api;
}

interface BrowserMock {
  runtime: {
    onInstalled: EventSpy;
    onStartup: EventSpy;
    sendMessage: Fn;
  };
  sidebarAction?: { setPanel: Fn; open: Fn };
  menus?: MenusMock;
  sidePanel?: { setOptions: Fn; open: Fn };
  contextMenus?: MenusMock;
  commands: { onCommand: EventSpy };
}

// The shared fake exposes only the engine's own namespaces: Firefox has
// sidebarAction and, under the `menus` permission, `browser.menus` —
// `browser.contextMenus` is UNDEFINED there. Chromium has sidePanel and
// only `chrome.contextMenus`. Any access to browser.tabs / windows /
// permissions / storage throws, so a module that registered tab
// listeners (or gated on the toggle) would fail at import, not pass
// silently.
function installBrowserMock(
  engine: 'firefox' | 'chrome' = 'firefox',
): BrowserMock {
  const fake = fakeBrowser({
    engine,
    forbid: ['tabs', 'windows', 'permissions', 'storage'],
  });
  return fake.browser;
}

async function loadBackground(): Promise<void> {
  await import('../src/background/background.js');
}

type MenuHandler = (
  info: { menuItemId: string; selectionText?: string },
  tab?: { id?: number; windowId?: number; url?: string; title?: string },
) => void;

function menuHandler(mock: unknown): MenuHandler {
  const handler = menusSpy(mock).onClicked.addListener.mock.calls[0]?.[0] as
    | MenuHandler
    | undefined;
  if (!handler) throw new Error('menu onClicked listener not registered');
  return handler;
}

type CommandHandler = (
  command: string,
  tab?: { id?: number; windowId?: number; url?: string; title?: string },
) => void;

function commandHandler(mock: BrowserMock): CommandHandler {
  const handler = mock.commands.onCommand.addListener.mock.calls[0]?.[0] as
    | CommandHandler
    | undefined;
  if (!handler) throw new Error('commands.onCommand listener not registered');
  return handler;
}

const NOW = 1_790_000_000_000;

beforeEach(() => {
  vi.resetModules();
  vi.mocked(searchEnheterWithParams).mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { browser?: unknown }).browser;
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe('background module load', () => {
  it.each(['firefox', 'chrome'] as const)(
    'registers install/startup and the menu click at top level (%s)',
    async (engine) => {
      const mock = installBrowserMock(engine);
      await loadBackground();
      expect(mock.runtime.onInstalled.addListener).toHaveBeenCalledTimes(1);
      expect(mock.runtime.onStartup.addListener).toHaveBeenCalledTimes(1);
      expect(menusSpy(mock).onClicked.addListener).toHaveBeenCalledTimes(1);
      expect(mock.commands.onCommand.addListener).toHaveBeenCalledTimes(1);
    },
  );

  it('uses browser.menus on Firefox (browser.contextMenus is undefined there)', async () => {
    // A hardcoded browser.contextMenus access throws a TypeError at
    // module top level in real Firefox and aborts the whole background
    // script. This pins the engine-correct namespace.
    const mock = installBrowserMock('firefox');
    await loadBackground();
    expect(mock.menus?.onClicked.addListener).toHaveBeenCalledTimes(1);
  });

  it.each(['firefox', 'chrome'] as const)(
    'touches no tabs, permissions or storage API — auto-sync is not here (%s)',
    async (engine) => {
      // installBrowserMock makes those namespaces throw on any access;
      // loading cleanly is the assertion.
      installBrowserMock(engine);
      await expect(loadBackground()).resolves.toBeUndefined();
    },
  );

  it.each(['firefox', 'chrome'] as const)(
    'registers the page and the selection menu items on install (%s)',
    async (engine) => {
      const mock = installBrowserMock(engine);
      await loadBackground();
      const onInstalled = mock.runtime.onInstalled.addListener.mock.calls[0]?.[0] as () => void;
      onInstalled();
      const create = menusSpy(mock).create;
      expect(create).toHaveBeenCalledTimes(2);
      expect(create).toHaveBeenCalledWith(
        {
          id: 'show-in-brreg-sidebar',
          title: 'Vis i brreg-snap sidebar',
          contexts: ['page'],
        },
        expect.any(Function),
      );
      expect(create).toHaveBeenCalledWith(
        {
          id: 'lookup-selection',
          title: 'Slå opp «%s» i brreg-snap',
          contexts: ['selection'],
        },
        expect.any(Function),
      );
    },
  );
});

describe('context menu click', () => {
  it('opens the panel on the page orgnr inside the gesture, then tells that window', async () => {
    const mock = installBrowserMock('firefox');
    await loadBackground();
    const tab = {
      id: 7,
      windowId: 3,
      url: 'https://example.com/firma/984851006',
      title: 'DNB',
    };

    menuHandler(mock)({ menuItemId: 'show-in-brreg-sidebar' }, tab);

    // Synchronously, before any await: setPanel + open (gesture stack).
    // The path names the click's window, so another window's panel
    // that loads it ignores it.
    expect(mock.sidebarAction?.setPanel).toHaveBeenCalledWith({
      panel: `moz-extension://test/details/details.html?orgnr=984851006&at=${NOW}&w=3`,
    });
    expect(mock.sidebarAction?.open).toHaveBeenCalledTimes(1);
    expect(mock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'sync',
      windowId: 3,
      orgnr: '984851006',
      host: 'example.com',
      method: 'url-path',
    });
  });

  it('on a page without an orgnr hands the host to the panel and looks nothing up itself', async () => {
    const mock = installBrowserMock('chrome');
    await loadBackground();

    menuHandler(mock)(
      { menuItemId: 'show-in-brreg-sidebar' },
      { id: 7, windowId: 3, url: 'https://www.yara.com/about', title: 'Yara' },
    );
    // Let anything the handler might have kicked off asynchronously run.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(mock.sidePanel?.setOptions).toHaveBeenCalledWith({
      path: `details/details.html?nomatch=www.yara.com&at=${NOW}&w=3`,
      enabled: true,
    });
    expect(mock.sidePanel?.open).toHaveBeenCalledWith({ windowId: 3 });
    expect(mock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'no-match',
      windowId: 3,
      host: 'www.yara.com',
    });
    // The panel runs the picker-aware search; the background never does.
    expect(searchEnheterWithParams).not.toHaveBeenCalled();
  });

  it('ignores other menu items', async () => {
    const mock = installBrowserMock('firefox');
    await loadBackground();
    menuHandler(mock)({ menuItemId: 'something-else' }, { windowId: 1 });
    expect(mock.sidebarAction?.setPanel).not.toHaveBeenCalled();
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('still opens the panel when the click carries no tab, but sends nothing it can’t address', async () => {
    const mock = installBrowserMock('firefox');
    await loadBackground();
    menuHandler(mock)({ menuItemId: 'show-in-brreg-sidebar' });
    expect(mock.sidebarAction?.setPanel).toHaveBeenCalledWith({
      panel: 'moz-extension://test/details/details.html',
    });
    expect(mock.sidebarAction?.open).toHaveBeenCalledTimes(1);
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

describe('selection lookup («Slå opp «%s» i brreg-snap»)', () => {
  const tab = { id: 7, windowId: 3, url: 'https://shop.example/kasse', title: 'Kasse' };

  it('opens a selected orgnr as the user’s own pick, inside the gesture', async () => {
    const mock = installBrowserMock('firefox');
    await loadBackground();

    menuHandler(mock)(
      { menuItemId: 'lookup-selection', selectionText: 'Org.nr. 923 609 016 MVA' },
      tab,
    );

    // Synchronous, before any await — and 'manual', not the tab's.
    expect(mock.sidebarAction?.setPanel).toHaveBeenCalledWith({
      panel: `moz-extension://test/details/details.html?orgnr=923609016&m=manual&at=${NOW}&w=3`,
    });
    expect(mock.sidebarAction?.open).toHaveBeenCalledTimes(1);
    expect(mock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'sync',
      windowId: 3,
      orgnr: '923609016',
      method: 'manual',
    });
  });

  it('opens the panel’s search on any other text, trimmed and whitespace-collapsed', async () => {
    const mock = installBrowserMock('chrome');
    await loadBackground();

    menuHandler(mock)(
      { menuItemId: 'lookup-selection', selectionText: '  Kiwi\n  Norge ' },
      tab,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(mock.sidePanel?.setOptions).toHaveBeenCalledWith({
      path: `details/details.html?q=Kiwi+Norge&at=${NOW}&w=3`,
      enabled: true,
    });
    expect(mock.sidePanel?.open).toHaveBeenCalledWith({ windowId: 3 });
    expect(mock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'search',
      windowId: 3,
      query: 'Kiwi Norge',
    });
    // The panel searches; the background never talks to brreg.
    expect(searchEnheterWithParams).not.toHaveBeenCalled();
  });

  it('caps a long selection before it goes anywhere', async () => {
    const mock = installBrowserMock('firefox');
    await loadBackground();
    menuHandler(mock)(
      { menuItemId: 'lookup-selection', selectionText: 'lorem '.repeat(100) },
      tab,
    );
    const [msg] = mock.runtime.sendMessage.mock.calls[0] as [{ query: string }];
    expect(msg.query.length).toBeLessThanOrEqual(100);
    expect(msg.query.startsWith('lorem lorem')).toBe(true);
  });

  it('two orgnrs in the selection are ambiguous: searched as text, never guessed', async () => {
    const mock = installBrowserMock('firefox');
    await loadBackground();
    menuHandler(mock)(
      { menuItemId: 'lookup-selection', selectionText: '923609016 og 984851006' },
      tab,
    );
    expect(mock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'search',
      windowId: 3,
      query: '923609016 og 984851006',
    });
  });

  it('a blank selection still opens the panel, with nothing to search', async () => {
    const mock = installBrowserMock('firefox');
    await loadBackground();
    menuHandler(mock)({ menuItemId: 'lookup-selection', selectionText: '   ' }, tab);
    expect(mock.sidebarAction?.setPanel).toHaveBeenCalledWith({
      panel: 'moz-extension://test/details/details.html',
    });
    expect(mock.sidebarAction?.open).toHaveBeenCalledTimes(1);
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

describe('keyboard command (Chrome «open-panel»)', () => {
  it('opens the side panel on the page’s company inside the gesture, like the page menu item', async () => {
    const mock = installBrowserMock('chrome');
    await loadBackground();

    commandHandler(mock)('open-panel', {
      id: 7,
      windowId: 3,
      url: 'https://example.com/firma/984851006',
      title: 'DNB',
    });

    expect(mock.sidePanel?.setOptions).toHaveBeenCalledWith({
      path: `details/details.html?orgnr=984851006&at=${NOW}&w=3`,
      enabled: true,
    });
    expect(mock.sidePanel?.open).toHaveBeenCalledWith({ windowId: 3 });
    expect(mock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'sync',
      windowId: 3,
      orgnr: '984851006',
      host: 'example.com',
      method: 'url-path',
    });
  });

  it('ignores any other command', async () => {
    const mock = installBrowserMock('chrome');
    await loadBackground();
    commandHandler(mock)('_execute_action', { windowId: 3 });
    expect(mock.sidePanel?.setOptions).not.toHaveBeenCalled();
    expect(mock.sidePanel?.open).not.toHaveBeenCalled();
  });
});
