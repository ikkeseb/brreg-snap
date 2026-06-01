// Regression coverage for the MV3 event-page wakeup discipline. The
// background script must register tab and permission/storage event
// listeners synchronously at top level — async registration leaves
// Firefox unaware that the script should be woken for those events,
// and auto-sync silently breaks once the script goes idle. (Caught
// the hard way: auto-sync worked only while about:debugging Inspector
// kept the script alive.) The tests below fail if anyone moves an
// addListener call back inside an async helper.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTO_SYNC_STORAGE_KEY } from '../src/lib/auto-sync-settings.js';

// Mock the brreg client so the host-search fallback inside
// resolveOrgnrAsync can't hit the network when we exercise the gated
// dispatch path with a URL that doesn't carry a sync orgnr.
vi.mock('../src/lib/brreg.js', () => ({
  searchEnheterWithParams: vi.fn(async () => []),
}));

function makeListenerSpy() {
  return { addListener: vi.fn(), removeListener: vi.fn() };
}

interface BrowserMockOptions {
  hasTabs?: boolean;
  autoSyncOn?: boolean;
  activeTab?: { url?: string; title?: string; active?: boolean };
}

function installBrowserMock(opts: BrowserMockOptions = {}) {
  const { hasTabs = false, autoSyncOn = false, activeTab } = opts;
  const localStore: Record<string, unknown> = {};
  if (autoSyncOn) localStore[AUTO_SYNC_STORAGE_KEY] = true;
  const sessionStore: Record<string, unknown> = {};

  const mock = {
    tabs: {
      onActivated: makeListenerSpy(),
      onUpdated: makeListenerSpy(),
      get: vi.fn(async () => activeTab ?? {}),
    },
    runtime: {
      onInstalled: makeListenerSpy(),
      onStartup: makeListenerSpy(),
      sendMessage: vi.fn(async () => undefined),
      getURL: vi.fn((p: string) => `moz-extension://test/${p}`),
      lastError: undefined,
    },
    contextMenus: {
      create: vi.fn(),
      onClicked: makeListenerSpy(),
    },
    permissions: {
      contains: vi.fn(async () => hasTabs),
      onAdded: makeListenerSpy(),
      onRemoved: makeListenerSpy(),
    },
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) if (k in localStore) out[k] = localStore[k];
          return out;
        }),
        set: vi.fn(async (entries: Record<string, unknown>) => {
          Object.assign(localStore, entries);
        }),
      },
      session: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) if (k in sessionStore) out[k] = sessionStore[k];
          return out;
        }),
        set: vi.fn(async (entries: Record<string, unknown>) => {
          Object.assign(sessionStore, entries);
        }),
        remove: vi.fn(),
      },
      onChanged: makeListenerSpy(),
    },
    sidebarAction: {
      setPanel: vi.fn(),
      open: vi.fn(),
    },
  };
  (globalThis as { browser?: unknown }).browser = mock;
  return mock;
}

async function flushMicrotasks(): Promise<void> {
  // The tab event handlers wrap their async work in `void (async () =>
  // {…})()` (fire-and-forget by design), so awaiting the listener
  // return value doesn't await the dispatch. A macrotask boundary
  // drains every microtask the dispatch chain schedules — refresh,
  // tabs.get, deriveSyncAsync, sendMessage — without needing to count
  // ticks.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function loadBackground(): Promise<void> {
  await import('../src/background/background.js');
  await flushMicrotasks();
}

describe('background module load — top-level listener registration', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('registers tabs.onActivated synchronously at top level', async () => {
    const mock = installBrowserMock();
    await loadBackground();
    expect(mock.tabs.onActivated.addListener).toHaveBeenCalledTimes(1);
  });

  it('registers tabs.onUpdated with the url-properties filter at top level', async () => {
    const mock = installBrowserMock();
    await loadBackground();
    expect(mock.tabs.onUpdated.addListener).toHaveBeenCalledTimes(1);
    const call = mock.tabs.onUpdated.addListener.mock.calls[0];
    expect(call?.[1]).toEqual({ properties: ['url'] });
  });

  it('registers permission change listeners at top level', async () => {
    const mock = installBrowserMock();
    await loadBackground();
    expect(mock.permissions.onAdded.addListener).toHaveBeenCalledTimes(1);
    expect(mock.permissions.onRemoved.addListener).toHaveBeenCalledTimes(1);
  });

  it('registers storage.onChanged at top level so toggle flips refresh the cache', async () => {
    const mock = installBrowserMock();
    await loadBackground();
    expect(mock.storage.onChanged.addListener).toHaveBeenCalledTimes(1);
  });

  it('registers runtime.onInstalled, onStartup, and contextMenus.onClicked at top level', async () => {
    const mock = installBrowserMock();
    await loadBackground();
    expect(mock.runtime.onInstalled.addListener).toHaveBeenCalled();
    expect(mock.runtime.onStartup.addListener).toHaveBeenCalled();
    expect(mock.contextMenus.onClicked.addListener).toHaveBeenCalledTimes(1);
  });
});

describe('background tab event dispatch — gated on auto-sync state', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('skips dispatch when tabs permission has not been granted', async () => {
    const mock = installBrowserMock({ hasTabs: false, autoSyncOn: true });
    await loadBackground();
    const handler = mock.tabs.onActivated.addListener.mock.calls[0]?.[0];
    expect(handler).toBeDefined();
    await handler({ tabId: 1, windowId: 1 });
    await flushMicrotasks();
    expect(mock.tabs.get).not.toHaveBeenCalled();
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('skips dispatch when the auto-sync toggle is off even with permission granted', async () => {
    const mock = installBrowserMock({ hasTabs: true, autoSyncOn: false });
    await loadBackground();
    const handler = mock.tabs.onActivated.addListener.mock.calls[0]?.[0];
    expect(handler).toBeDefined();
    await handler({ tabId: 1, windowId: 1 });
    await flushMicrotasks();
    expect(mock.tabs.get).not.toHaveBeenCalled();
  });

  it('proceeds with dispatch and broadcasts sync when both permission and toggle are on', async () => {
    const mock = installBrowserMock({
      hasTabs: true,
      autoSyncOn: true,
      // URL carries a valid orgnr (DNB Bank ASA) so resolveOrgnrAsync
      // resolves synchronously without touching the mocked brreg client.
      activeTab: {
        url: 'https://example.com/foo/984851006',
        title: 'DNB',
        active: true,
      },
    });
    await loadBackground();
    const handler = mock.tabs.onActivated.addListener.mock.calls[0]?.[0];
    expect(handler).toBeDefined();
    await handler({ tabId: 7, windowId: 1 });
    await flushMicrotasks();
    expect(mock.tabs.get).toHaveBeenCalledWith(7);
    expect(mock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'sync',
      orgnr: '984851006',
      host: 'example.com',
    });
  });

  it('broadcasts no-match when the active tab cannot be resolved to an orgnr', async () => {
    const mock = installBrowserMock({
      hasTabs: true,
      autoSyncOn: true,
      activeTab: {
        url: 'https://random-unknown-blog.example/',
        title: '',
        active: true,
      },
    });
    await loadBackground();
    const handler = mock.tabs.onActivated.addListener.mock.calls[0]?.[0];
    expect(handler).toBeDefined();
    await handler({ tabId: 9, windowId: 1 });
    await flushMicrotasks();
    expect(mock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'no-match',
      host: 'random-unknown-blog.example',
    });
  });
});

describe('background permission revoke — synchronous cache invalidation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('flips autoSyncEnabled to false synchronously on permissions.onRemoved', async () => {
    const mock = installBrowserMock({ hasTabs: true, autoSyncOn: true });
    await loadBackground();

    // Confirm the enabled path works first.
    const activated = mock.tabs.onActivated.addListener.mock.calls[0]?.[0];
    expect(activated).toBeDefined();
    await activated({ tabId: 1, windowId: 1 });
    await flushMicrotasks();
    expect(mock.tabs.get).toHaveBeenCalled();
    mock.tabs.get.mockClear();

    // Simulate user revoking the tabs permission. The onRemoved listener
    // must zero the cache synchronously — *before* awaiting the refresh
    // — so a tab event firing in the same tick can't slip through.
    const removed = mock.permissions.onRemoved.addListener.mock.calls[0]?.[0];
    expect(removed).toBeDefined();
    // Also flip the contains mock so the post-refresh state is consistent.
    mock.permissions.contains.mockResolvedValue(false);
    removed({ permissions: ['tabs'] });

    // Without awaiting microtasks, fire another tab event right away.
    await activated({ tabId: 2, windowId: 1 });
    await flushMicrotasks();
    expect(mock.tabs.get).not.toHaveBeenCalled();
  });
});
