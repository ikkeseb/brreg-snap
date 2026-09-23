// One engine-aware `browser` fake for every test.
//
// RULE: change this fake only to match behaviour observed in a real
// engine (Firefox or Chrome), never to make a test pass. A fake that
// drifts from the engine hides real bugs: before 16d9bdd the Firefox
// mock exposed `contextMenus`, so tests stayed green while Firefox
// auto-sync was dead.
//
// Engine namespaces are exclusive, as in the real engines:
//   firefox: `menus` + `sidebarAction` (no `contextMenus`, no `sidePanel`)
//   chrome:  `contextMenus` + `sidePanel` (no `menus`, no `sidebarAction`)
// The fake is installed as both `browser` and `chrome`: Firefox defines
// both, and on Chromium that is the state after platform/globals.ts has
// aliased `browser = chrome`.
//
// Storage areas follow the StorageArea contract: get() takes a string,
// a string[], an object of defaults, or null/undefined (the whole area);
// values are stored and returned as structured clones; set()/remove()/
// clear() fire `storage.onChanged` (changes, areaName) and the area's own
// `onChanged` (changes) for keys that actually existed or changed. The
// events are dispatched in a microtask after the write; don't write tests
// that depend on their order relative to the write's promise.
//
// Every method is a vi.fn, so tests can still override one call
// (`vi.mocked(browser.storage.session.get).mockRejectedValueOnce(...)`).
import { vi } from 'vitest';

type Listener = (...args: never[]) => unknown;
type StorageMap = Record<string, unknown>;
type AreaName = 'session' | 'local';
type Namespace = 'tabs' | 'windows' | 'permissions' | 'storage';

export interface FakeBrowserOptions {
  engine?: 'firefox' | 'chrome';
  /** Initial contents per storage area (copied, never aliased). */
  storage?: Partial<Record<AreaName, StorageMap>>;
  /** Permissions granted at start (e.g. ['tabs']). */
  permissions?: string[];
  /** What permissions.request() resolves to (the user's answer). */
  grantOnRequest?: boolean;
  /**
   * Namespaces that throw on any access, for tests asserting a module
   * never touches them.
   */
  forbid?: Namespace[];
  /** Install on globalThis (default true; uses vi.stubGlobal). */
  install?: boolean;
}

export function fakeEvent<L extends Listener = Listener>() {
  const listeners = new Set<L>();
  return {
    addListener: vi.fn((fn: L) => {
      listeners.add(fn);
    }),
    removeListener: vi.fn((fn: L) => {
      listeners.delete(fn);
    }),
    hasListener: vi.fn((fn: L) => listeners.has(fn)),
    /** Test-side: call every listener, as the engine would. */
    emit(...args: Parameters<L>): void {
      for (const fn of [...listeners]) fn(...args);
    },
  };
}

type StorageChanges = Record<string, { oldValue?: unknown; newValue?: unknown }>;

function fakeStorageArea(
  name: AreaName,
  store: StorageMap,
  globalOnChanged: ReturnType<typeof fakeEvent<(c: StorageChanges, area: string) => void>>,
) {
  const onChanged = fakeEvent<(c: StorageChanges) => void>();
  const notify = (changes: StorageChanges): void => {
    if (Object.keys(changes).length === 0) return;
    queueMicrotask(() => {
      onChanged.emit(changes);
      globalOnChanged.emit(changes, name);
    });
  };
  const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(store, k);

  const get = vi.fn(
    async (keys?: string | string[] | StorageMap | null): Promise<StorageMap> => {
      if (keys === null || keys === undefined) return structuredClone({ ...store });
      if (typeof keys === 'string') keys = [keys];
      if (Array.isArray(keys)) {
        const out: StorageMap = {};
        for (const k of keys) if (has(k)) out[k] = structuredClone(store[k]);
        return out;
      }
      const out: StorageMap = structuredClone(keys);
      for (const k of Object.keys(keys)) if (has(k)) out[k] = structuredClone(store[k]);
      return out;
    },
  );
  const set = vi.fn(async (items: StorageMap): Promise<void> => {
    const changes: StorageChanges = {};
    for (const [k, v] of Object.entries(items)) {
      const newValue = structuredClone(v);
      changes[k] = has(k) ? { oldValue: store[k], newValue } : { newValue };
      store[k] = newValue;
    }
    notify(changes);
  });
  const remove = vi.fn(async (keys: string | string[]): Promise<void> => {
    const changes: StorageChanges = {};
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      if (!has(k)) continue;
      changes[k] = { oldValue: store[k] };
      delete store[k];
    }
    notify(changes);
  });
  const clear = vi.fn(async (): Promise<void> => {
    await remove(Object.keys(store));
  });
  return { get, set, remove, clear, onChanged };
}

function forbidden(name: string): unknown {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(`touched forbidden browser.${name}.${String(prop)}`);
      },
    },
  );
}

export function fakeBrowser(opts: FakeBrowserOptions = {}) {
  const engine = opts.engine ?? 'firefox';
  const scheme = engine === 'firefox' ? 'moz-extension' : 'chrome-extension';

  // Backing maps: tests may read them directly to assert what was stored.
  const stores: Record<AreaName, StorageMap> = {
    session: structuredClone(opts.storage?.session ?? {}),
    local: structuredClone(opts.storage?.local ?? {}),
  };
  const storageOnChanged = fakeEvent<(c: StorageChanges, area: string) => void>();
  const storage = {
    session: fakeStorageArea('session', stores.session, storageOnChanged),
    local: fakeStorageArea('local', stores.local, storageOnChanged),
    onChanged: storageOnChanged,
  };

  type Perms = { permissions?: string[]; origins?: string[] };
  const granted = new Set(opts.permissions ?? []);
  const permissions = {
    contains: vi.fn(async (p: Perms) => (p.permissions ?? []).every((x) => granted.has(x))),
    getAll: vi.fn(async () => ({ permissions: [...granted], origins: [] as string[] })),
    request: vi.fn(async (p: Perms) => {
      if (!(opts.grantOnRequest ?? true)) return false;
      const added = (p.permissions ?? []).filter((x) => !granted.has(x));
      for (const x of added) granted.add(x);
      if (added.length) permissions.onAdded.emit({ permissions: added, origins: [] });
      return true;
    }),
    remove: vi.fn(async (p: Perms) => {
      const removed = (p.permissions ?? []).filter((x) => granted.has(x));
      for (const x of removed) granted.delete(x);
      if (removed.length) permissions.onRemoved.emit({ permissions: removed, origins: [] });
      return true;
    }),
    onAdded: fakeEvent<(p: Perms) => void>(),
    onRemoved: fakeEvent<(p: Perms) => void>(),
  };

  const runtime = {
    id: 'brreg-snap-test',
    lastError: undefined as { message?: string } | undefined,
    getURL: vi.fn((path: string) => `${scheme}://test/${path.replace(/^\//, '')}`),
    sendMessage: vi.fn(async (_msg: unknown): Promise<unknown> => undefined),
    onMessage: fakeEvent(),
    onInstalled: fakeEvent(),
    onStartup: fakeEvent(),
  };

  const tabs = {
    query: vi.fn(async (_q: unknown): Promise<unknown[]> => []),
    get: vi.fn(async (tabId: number): Promise<unknown> => ({ id: tabId })),
    onActivated: fakeEvent(),
    onUpdated: fakeEvent(),
    onRemoved: fakeEvent(),
  };

  const windows = {
    getCurrent: vi.fn(async (): Promise<{ id?: number }> => ({ id: 1 })),
    onFocusChanged: fakeEvent(),
  };

  const menusApi = () => ({
    create: vi.fn(),
    removeAll: vi.fn(async () => undefined),
    onClicked: fakeEvent(),
  });

  const engineApis =
    engine === 'firefox'
      ? {
          menus: menusApi(),
          sidebarAction: {
            setPanel: vi.fn(async (_d: unknown) => undefined),
            open: vi.fn(async () => undefined),
            close: vi.fn(async () => undefined),
            isOpen: vi.fn(async (_d: unknown) => false),
          },
        }
      : {
          contextMenus: menusApi(),
          sidePanel: {
            setOptions: vi.fn(async (_o: unknown) => undefined),
            open: vi.fn(async (_o: unknown) => undefined),
          },
        };

  const forbid = new Set(opts.forbid ?? []);
  const pick = <T>(name: Namespace, api: T): T => (forbid.has(name) ? (forbidden(name) as T) : api);

  const ns = {
    storage: pick('storage', storage),
    permissions: pick('permissions', permissions),
    runtime,
    tabs: pick('tabs', tabs),
    windows: pick('windows', windows),
    ...engineApis,
  };

  if (opts.install ?? true) {
    // Firefox defines both `browser` and `chrome`; Chromium only
    // `chrome`, which platform/globals.ts aliases to `browser`.
    vi.stubGlobal('browser', ns);
    vi.stubGlobal('chrome', ns);
  }

  return {
    engine,
    browser: ns,
    stores,
    storage,
    permissions,
    runtime,
    tabs,
    windows,
    menus: 'menus' in engineApis ? engineApis.menus : engineApis.contextMenus,
    /** The granted-permission set (live). */
    granted,
  };
}

export type FakeBrowser = ReturnType<typeof fakeBrowser>;
