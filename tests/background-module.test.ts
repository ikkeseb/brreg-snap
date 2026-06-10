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

interface MockTab {
  url?: string;
  title?: string;
  active?: boolean;
}

// Manually-released promise so a test can hold one tabs.get in flight
// while later events resolve — the ordering scenarios need a "slow
// network" the mock can release on cue.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface BrowserMockOptions {
  hasTabs?: boolean;
  autoSyncOn?: boolean;
  activeTab?: { url?: string; title?: string; active?: boolean };
  // Which engine the mock presents as. Firefox exposes `sidebarAction`
  // (so isFirefox === true); Chrome exposes `sidePanel` instead. Drives
  // the engine-specific branches in background.ts (notably the
  // tabs.onUpdated filter, which Chrome rejects).
  engine?: 'firefox' | 'chrome';
}

function installBrowserMock(opts: BrowserMockOptions = {}) {
  const { hasTabs = false, autoSyncOn = false, activeTab, engine = 'firefox' } =
    opts;
  const localStore: Record<string, unknown> = {};
  if (autoSyncOn) localStore[AUTO_SYNC_STORAGE_KEY] = true;
  const sessionStore: Record<string, unknown> = {};

  const mock = {
    tabs: {
      onActivated: makeListenerSpy(),
      onUpdated: makeListenerSpy(),
      get: vi.fn(async (_tabId: number): Promise<MockTab> => activeTab ?? {}),
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
    // Engine marker: Firefox exposes sidebarAction, Chrome exposes
    // sidePanel. engine.ts feature-detects on 'sidebarAction' in browser.
    ...(engine === 'firefox'
      ? { sidebarAction: { setPanel: vi.fn(), open: vi.fn() } }
      : { sidePanel: { setOptions: vi.fn(), open: vi.fn() } }),
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

  it('registers tabs.onUpdated WITHOUT a filter on Chrome (filters throw there)', async () => {
    // chrome.tabs.onUpdated.addListener(cb, {properties}) throws
    // "This event does not support filters" and would abort the rest of
    // module evaluation — taking the permission/storage reconciliation
    // listeners and the seed with it. Chrome must register filter-free.
    const mock = installBrowserMock({ engine: 'chrome' });
    await loadBackground();
    expect(mock.tabs.onUpdated.addListener).toHaveBeenCalledTimes(1);
    const call = mock.tabs.onUpdated.addListener.mock.calls[0];
    expect(call?.[1]).toBeUndefined();
  });

  it('still registers the tail listeners on Chrome (proves onUpdated did not throw)', async () => {
    const mock = installBrowserMock({ engine: 'chrome' });
    await loadBackground();
    expect(mock.permissions.onAdded.addListener).toHaveBeenCalledTimes(1);
    expect(mock.permissions.onRemoved.addListener).toHaveBeenCalledTimes(1);
    expect(mock.storage.onChanged.addListener).toHaveBeenCalledTimes(1);
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

  it('dispatches on Chrome too when permission and toggle are on (no isFirefox gate)', async () => {
    // Auto-sync is no longer Firefox-only: removing the !isFirefox
    // short-circuit in refreshAutoSyncEnabled lets Chrome reconcile from
    // permission + toggle like Firefox does.
    const mock = installBrowserMock({
      engine: 'chrome',
      hasTabs: true,
      autoSyncOn: true,
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

describe('background tab event ordering — stale broadcasts drop', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('suppresses a slow onActivated broadcast superseded by a faster one', async () => {
    const mock = installBrowserMock({ hasTabs: true, autoSyncOn: true });
    // Tab 1 (DNB) resolves slowly — its tabs.get hangs until we release
    // it. Tab 2 (Equinor) resolves immediately. Both URLs carry a valid
    // orgnr so deriveSyncAsync stays off the (mocked) brreg client.
    const slowTab1 = deferred<MockTab>();
    mock.tabs.get.mockImplementation((tabId: number) =>
      tabId === 1
        ? slowTab1.promise
        : Promise.resolve({
            url: 'https://equinor.com/x/923609016',
            title: 'Equinor',
            active: true,
          }),
    );
    await loadBackground();
    const handler = mock.tabs.onActivated.addListener.mock.calls[0]?.[0];
    expect(handler).toBeDefined();

    // Event A (slow), then event B (fast) before A resolves.
    handler({ tabId: 1, windowId: 1 });
    handler({ tabId: 2, windowId: 1 });
    await flushMicrotasks();
    expect(mock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'sync',
      orgnr: '923609016',
      host: 'equinor.com',
    });
    mock.runtime.sendMessage.mockClear();

    // A's tabs.get finally lands — its broadcast must be dropped, not
    // overwrite B's in the sidebar.
    slowTab1.resolve({
      url: 'https://dnb.no/x/984851006',
      title: 'DNB',
      active: true,
    });
    await flushMicrotasks();
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('lets a newer onUpdated supersede an in-flight onActivated (shared sequence)', async () => {
    const mock = installBrowserMock({ hasTabs: true, autoSyncOn: true });
    const slowTab1 = deferred<MockTab>();
    mock.tabs.get.mockImplementation(() => slowTab1.promise);
    await loadBackground();
    const activated = mock.tabs.onActivated.addListener.mock.calls[0]?.[0];
    const updated = mock.tabs.onUpdated.addListener.mock.calls[0]?.[0];
    expect(activated).toBeDefined();
    expect(updated).toBeDefined();

    // Slow activation on tab 1, then a same-tab URL navigation that
    // resolves immediately (onUpdated hands us the tab inline).
    activated({ tabId: 1, windowId: 1 });
    updated(
      1,
      { url: 'https://equinor.com/x/923609016' },
      {
        url: 'https://equinor.com/x/923609016',
        title: 'Equinor',
        active: true,
      },
    );
    await flushMicrotasks();
    expect(mock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'sync',
      orgnr: '923609016',
      host: 'equinor.com',
    });
    mock.runtime.sendMessage.mockClear();

    slowTab1.resolve({
      url: 'https://dnb.no/x/984851006',
      title: 'DNB',
      active: true,
    });
    await flushMicrotasks();
    expect(mock.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('does NOT claim a sequence slot for title-only or background-tab updates', async () => {
    const mock = installBrowserMock({ hasTabs: true, autoSyncOn: true });
    const slowTab1 = deferred<MockTab>();
    mock.tabs.get.mockImplementation(() => slowTab1.promise);
    await loadBackground();
    const activated = mock.tabs.onActivated.addListener.mock.calls[0]?.[0];
    const updated = mock.tabs.onUpdated.addListener.mock.calls[0]?.[0];

    activated({ tabId: 1, windowId: 1 });
    // Title-only churn (media playback) and a background-tab URL change
    // must not invalidate the in-flight resolution for the active tab.
    updated(2, { title: 'now playing' }, { title: 'now playing', active: false });
    updated(
      3,
      { url: 'https://example.org/' },
      { url: 'https://example.org/', active: false },
    );
    await flushMicrotasks();

    slowTab1.resolve({
      url: 'https://dnb.no/x/984851006',
      title: 'DNB',
      active: true,
    });
    await flushMicrotasks();
    expect(mock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'sync',
      orgnr: '984851006',
      host: 'dnb.no',
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
