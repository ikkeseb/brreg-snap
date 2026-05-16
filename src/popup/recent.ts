// Recent-companies stack shown in the popup's empty state so the user
// can re-open recently viewed orgnrs without re-typing or re-resolving.
// storage.session scope — cleared when the browser restarts, which
// matches "recent" intent (history is the long-term store, not us) and
// keeps install-time permissions to activeTab/storage/menus only.

const STORAGE_KEY = 'recent-companies';
const MAX_ENTRIES = 5;

export interface RecentEntry {
  orgnr: string;
  navn: string;
  ts: number;
}

interface StorageShape {
  [STORAGE_KEY]?: RecentEntry[];
}

export async function getRecent(): Promise<RecentEntry[]> {
  try {
    const stored = (await browser.storage.session.get(STORAGE_KEY)) as StorageShape;
    const list = stored[STORAGE_KEY];
    if (!Array.isArray(list)) return [];
    return list.filter(
      (e): e is RecentEntry =>
        typeof e?.orgnr === 'string' &&
        typeof e?.navn === 'string' &&
        typeof e?.ts === 'number',
    );
  } catch {
    return [];
  }
}

export async function pushRecent(orgnr: string, navn: string): Promise<void> {
  try {
    const existing = await getRecent();
    // Dedupe by orgnr — re-visiting moves the entry to the top instead
    // of producing duplicates that crowd out other recents.
    const filtered = existing.filter((e) => e.orgnr !== orgnr);
    const next: RecentEntry[] = [
      { orgnr, navn, ts: Date.now() },
      ...filtered,
    ].slice(0, MAX_ENTRIES);
    await browser.storage.session.set({ [STORAGE_KEY]: next });
  } catch {
    /* silent — recent list is a nice-to-have, never block the render */
  }
}
