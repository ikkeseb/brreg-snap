import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchHit } from '../src/types/brreg.js';

vi.mock('../src/lib/brreg.js', () => ({
  searchEnheterWithParams: vi.fn(),
}));

import { searchEnheterWithParams } from '../src/lib/brreg.js';
import {
  createTabWatcher,
  deriveSync,
  deriveSyncAsync,
  followsActivation,
  followsUpdate,
  type TabEvents,
  type UpdatedTab,
} from '../src/lib/tab-sync.js';

const searchMock = vi.mocked(searchEnheterWithParams);

type StorageMap = Record<string, unknown>;

function installStorageMock(): void {
  const store: StorageMap = {};
  (globalThis as { browser?: unknown }).browser = {
    storage: {
      session: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: StorageMap = {};
          for (const k of list) {
            if (k in store) out[k] = store[k];
          }
          return out;
        }),
        set: vi.fn(async (entries: StorageMap) => {
          Object.assign(store, entries);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) delete store[k];
        }),
      },
    },
  };
}

function hit(
  navn: string,
  organisasjonsnummer: string,
  formKode = 'AS',
): SearchHit {
  return {
    navn,
    organisasjonsnummer,
    organisasjonsform: { kode: formKode, beskrivelse: formKode },
  } as SearchHit;
}

describe('deriveSync', () => {
  it('resolves orgnr from url path even when title is empty', () => {
    // brreg's own canonical orgnr appears in path; resolver picks it up
    const result = deriveSync('https://example.com/foo/950588063', '');
    expect(result).toEqual({ orgnr: '950588063', host: 'example.com' });
  });

  it('returns null when url is undefined', () => {
    expect(deriveSync(undefined, 'DNB')).toBeNull();
  });

  it('returns null when no orgnr can be resolved', () => {
    expect(deriveSync('https://example.com/no-orgnr-here', 'Random')).toBeNull();
  });

  it('returns null on unknown menu target with non-http url', () => {
    // about:blank, file://, etc. — no orgnr resolvable, no domain match
    expect(deriveSync('about:blank', 'New Tab')).toBeNull();
  });

  it('handles malformed url by leaving host undefined when orgnr is in title', () => {
    // Edge case: resolver finds orgnr in title even though URL is junk
    const result = deriveSync('not-a-url', 'DNB BANK ASA orgnr 984851006');
    expect(result).toEqual({ orgnr: '984851006', host: undefined });
  });
});

describe('deriveSyncAsync', () => {
  beforeEach(() => {
    installStorageMock();
    searchMock.mockReset();
  });

  it('returns the sync result without hitting the network when URL carries an orgnr', async () => {
    const result = await deriveSyncAsync(
      'https://example.com/foo/984851006',
      'DNB',
    );
    expect(result).toEqual({ orgnr: '984851006', host: 'example.com' });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('falls back to hostname search when sync misses, populating host', async () => {
    searchMock.mockResolvedValue([
      hit('YARA INTERNATIONAL ASA', '986228608', 'ASA'),
    ]);
    const result = await deriveSyncAsync(
      'https://www.yara.com/about',
      'Yara — global crop nutrition',
    );
    expect(result).toEqual({ orgnr: '986228608', host: 'www.yara.com' });
  });

  it('returns null when both sync and search miss', async () => {
    searchMock.mockResolvedValue([]);
    expect(
      await deriveSyncAsync('https://random-unknown-blog.example/', ''),
    ).toBeNull();
  });

  it('returns null when url is undefined', async () => {
    expect(await deriveSyncAsync(undefined, 'DNB')).toBeNull();
    expect(searchMock).not.toHaveBeenCalled();
  });
});

describe('followsActivation / followsUpdate — which tab events move the panel', () => {
  it('follows an activation in the panel window only', () => {
    expect(followsActivation({ tabId: 4, windowId: 1 }, 1)).toBe(true);
    expect(followsActivation({ tabId: 4, windowId: 2 }, 1)).toBe(false);
  });

  it('follows a URL change of the active tab in the panel window', () => {
    const tab: UpdatedTab = { url: 'https://dnb.no/', active: true, windowId: 1 };
    expect(followsUpdate({ url: 'https://dnb.no/' }, tab, 1)).toBe(true);
  });

  it('ignores title-only churn (media playback, unread badges)', () => {
    const tab: UpdatedTab = { title: 'now playing', active: true, windowId: 1 };
    expect(followsUpdate({}, tab, 1)).toBe(false);
  });

  it('ignores navigations in a background tab', () => {
    const tab: UpdatedTab = { url: 'https://x.no/', active: false, windowId: 1 };
    expect(followsUpdate({ url: 'https://x.no/' }, tab, 1)).toBe(false);
  });

  it("ignores another window's active tab (an SPA there must not repaint this panel)", () => {
    const tab: UpdatedTab = { url: 'https://x.no/', active: true, windowId: 2 };
    expect(followsUpdate({ url: 'https://x.no/' }, tab, 1)).toBe(false);
  });
});

function fakeTabs() {
  const activated = { addListener: vi.fn(), removeListener: vi.fn() };
  const updated = { addListener: vi.fn(), removeListener: vi.fn() };
  const tabs = { onActivated: activated, onUpdated: updated } as unknown as TabEvents;
  return { tabs, activated, updated };
}

describe('createTabWatcher — the panel attaches tab listeners only while auto-sync is on', () => {
  it('registers nothing until attached', () => {
    const { tabs, activated, updated } = fakeTabs();
    createTabWatcher({
      tabs,
      windowId: 1,
      supportsUpdateFilter: true,
      onTabChange: vi.fn(),
    });
    expect(activated.addListener).not.toHaveBeenCalled();
    expect(updated.addListener).not.toHaveBeenCalled();
  });

  it('on Firefox passes a url + window filter to onUpdated', () => {
    const { tabs, updated } = fakeTabs();
    const w = createTabWatcher({
      tabs,
      windowId: 7,
      supportsUpdateFilter: true,
      onTabChange: vi.fn(),
    });
    w.attach();
    expect(updated.addListener).toHaveBeenCalledWith(expect.any(Function), {
      properties: ['url'],
      windowId: 7,
    });
  });

  it('on Chrome registers onUpdated WITHOUT a filter (Chrome throws on one)', () => {
    const { tabs, updated } = fakeTabs();
    const w = createTabWatcher({
      tabs,
      windowId: 7,
      supportsUpdateFilter: false,
      onTabChange: vi.fn(),
    });
    w.attach();
    expect(updated.addListener).toHaveBeenCalledTimes(1);
    expect(updated.addListener.mock.calls[0]).toHaveLength(1);
  });

  it('attach is idempotent and detach removes exactly the registered listeners', () => {
    const { tabs, activated, updated } = fakeTabs();
    const w = createTabWatcher({
      tabs,
      windowId: 1,
      supportsUpdateFilter: true,
      onTabChange: vi.fn(),
    });
    w.attach();
    w.attach();
    expect(activated.addListener).toHaveBeenCalledTimes(1);
    expect(w.isAttached()).toBe(true);
    w.detach();
    w.detach();
    expect(activated.removeListener).toHaveBeenCalledTimes(1);
    expect(activated.removeListener).toHaveBeenCalledWith(
      activated.addListener.mock.calls[0]?.[0],
    );
    expect(updated.removeListener).toHaveBeenCalledWith(
      updated.addListener.mock.calls[0]?.[0],
    );
    expect(w.isAttached()).toBe(false);
  });

  it("forwards only this window's events: activation by id, navigation with the tab", () => {
    const { tabs, activated, updated } = fakeTabs();
    const onTabChange = vi.fn();
    createTabWatcher({
      tabs,
      windowId: 1,
      supportsUpdateFilter: false,
      onTabChange,
    }).attach();
    const onActivated = activated.addListener.mock.calls[0]?.[0] as (
      info: { tabId: number; windowId: number },
    ) => void;
    const onUpdated = updated.addListener.mock.calls[0]?.[0] as (
      tabId: number,
      changeInfo: { url?: string },
      tab: UpdatedTab,
    ) => void;

    onActivated({ tabId: 3, windowId: 2 });
    onActivated({ tabId: 4, windowId: 1 });
    const tab: UpdatedTab = { url: 'https://dnb.no/', active: true, windowId: 1 };
    onUpdated(4, { url: 'https://dnb.no/' }, tab);
    onUpdated(5, { url: 'https://x.no/' }, { ...tab, windowId: 2 });

    expect(onTabChange.mock.calls).toEqual([[4], [4, tab]]);
  });
});
