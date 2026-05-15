// Settings persistence for the "Auto-oppdater ved fane-bytte" toggle.
// storage.local (not storage.session) — settings survive browser
// restarts; the cache module's storage.session is in-memory only.

export const AUTO_SYNC_STORAGE_KEY = 'settings.autoSyncOnTabSwitch';

export async function getAutoSync(): Promise<boolean> {
  const out = await browser.storage.local.get(AUTO_SYNC_STORAGE_KEY);
  return out[AUTO_SYNC_STORAGE_KEY] === true;
}

export async function setAutoSync(value: boolean): Promise<void> {
  await browser.storage.local.set({ [AUTO_SYNC_STORAGE_KEY]: value });
}
