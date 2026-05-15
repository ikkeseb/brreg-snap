import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_SYNC_STORAGE_KEY,
  getAutoSync,
  setAutoSync,
} from '../src/lib/auto-sync-settings.js';

type StorageMap = Record<string, unknown>;

function installStorageMock(initial: StorageMap = {}): StorageMap {
  const store: StorageMap = { ...initial };
  // The webextension-polyfill / native browser API both expose
  // storage.local.get with a string or string[] arg returning a partial map.
  (globalThis as { browser?: unknown }).browser = {
    storage: {
      local: {
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
  return store;
}

describe('auto-sync-settings', () => {
  beforeEach(() => {
    installStorageMock();
  });

  it('returns false when the key has never been written', async () => {
    expect(await getAutoSync()).toBe(false);
  });

  it('coerces a stored boolean true to true', async () => {
    installStorageMock({ [AUTO_SYNC_STORAGE_KEY]: true });
    expect(await getAutoSync()).toBe(true);
  });

  it('coerces a stored non-boolean to false (defensive)', async () => {
    installStorageMock({ [AUTO_SYNC_STORAGE_KEY]: 'yes' });
    expect(await getAutoSync()).toBe(false);
  });

  it('setAutoSync(true) writes the key', async () => {
    const store = installStorageMock();
    await setAutoSync(true);
    expect(store[AUTO_SYNC_STORAGE_KEY]).toBe(true);
  });

  it('setAutoSync(false) writes the key (does not delete it)', async () => {
    const store = installStorageMock({ [AUTO_SYNC_STORAGE_KEY]: true });
    await setAutoSync(false);
    expect(store[AUTO_SYNC_STORAGE_KEY]).toBe(false);
  });
});
