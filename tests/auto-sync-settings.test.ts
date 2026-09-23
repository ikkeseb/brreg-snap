import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from './helpers/fake-browser.js';
import {
  AUTO_SYNC_STORAGE_KEY,
  getAutoSync,
  setAutoSync,
} from '../src/lib/auto-sync-settings.js';

type StorageMap = Record<string, unknown>;

function installStorageMock(initial: StorageMap = {}): StorageMap {
  return fakeBrowser({ storage: { local: initial } }).stores.local;
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
