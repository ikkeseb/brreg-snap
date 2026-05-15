# Sidebar tab-sync via runtime `tabs` permission — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the sidebar in sync with the active tab via an opt-in
"Auto-oppdater ved fane-bytte" toggle that requests `tabs` at runtime,
plus a smart refresh button that reads the active tab when permission
allows and falls back to today's re-fetch when it doesn't.

**Architecture:** `tabs` moves from "never" to `optional_permissions`,
keeping install silent. The sidebar header gains a toolbar row with a
toggle + the existing refresh button. Flipping the toggle on triggers
`permissions.request`; the background script registers
`tabs.onActivated` + `tabs.onUpdated` listeners that resolve orgnr via
the existing `deriveSync` helper and broadcast the same `{type:'sync',
orgnr, host}` shape the sidebar already handles. Flipping off calls
`permissions.remove`, so "off" truly means revoked. Boot-time
reconciliation re-registers listeners across service-worker restarts.

**Tech Stack:** TypeScript, MV3, WebExtensions API (`permissions`,
`tabs`, `storage.local`, `runtime.onMessage`, `menus`), vitest, vite,
web-ext.

---

## File map

**Renamed:**
- `src/lib/context-menu.ts` → `src/lib/tab-sync.ts` — `deriveSync` now
  serves three call sites (context menu, refresh button, tab listeners).
- `tests/context-menu.test.ts` → `tests/tab-sync.test.ts` — follow the
  module rename.

**New:**
- `src/lib/auto-sync-settings.ts` — `getAutoSync()` / `setAutoSync()`
  helpers around `storage.local`. Single key, no migration.
- `tests/auto-sync-settings.test.ts` — covers read/write/default.
- `src/lib/auto-sync-controller.ts` — pure decision logic for the
  toggle (input: current state + permission/grant outcome; output:
  next state + side-effect descriptor). Keeps `details.ts` thin.
- `tests/auto-sync-controller.test.ts` — covers grant, deny, external
  revoke, idempotent re-enable.

**Modified:**
- `public/manifest.json` — add `optional_permissions: ["tabs"]`.
- `src/background/background.ts` — add permission lifecycle wiring +
  `tabs.onActivated`/`onUpdated` listeners + boot reconciliation.
- `src/details/details.html` — new `<div class="toolbar">` in the
  header with the toggle and refresh button (refresh moves from
  footer to toolbar).
- `src/details/details.css` — styles for `.toolbar` and `.toggle`.
- `src/details/details.ts` — wire toggle controller, smart refresh
  behavior, `permissions.onRemoved` listener.
- `README.md` — permission table update.
- `CLAUDE.md` — § Security constraints update.

---

## Task 1: Rename `context-menu.ts` → `tab-sync.ts`

**Why first:** No behavior change. Cleans up the module name before
it's imported from three more sites.

**Files:**
- Rename: `src/lib/context-menu.ts` → `src/lib/tab-sync.ts`
- Rename: `tests/context-menu.test.ts` → `tests/tab-sync.test.ts`
- Modify: `src/background/background.ts` (one import line)

- [ ] **Step 1: Move source file**

```bash
git mv src/lib/context-menu.ts src/lib/tab-sync.ts
```

- [ ] **Step 2: Move test file**

```bash
git mv tests/context-menu.test.ts tests/tab-sync.test.ts
```

- [ ] **Step 3: Update import in the test file**

In `tests/tab-sync.test.ts` line 2:

```ts
// Old:
import { deriveSync } from '../src/lib/context-menu.js';
// New:
import { deriveSync } from '../src/lib/tab-sync.js';
```

- [ ] **Step 4: Update import in background.ts**

In `src/background/background.ts` line 10:

```ts
// Old:
import { deriveSync } from '../lib/context-menu.js';
// New:
import { deriveSync } from '../lib/tab-sync.js';
```

- [ ] **Step 5: Update the source file's leading comment**

`src/lib/tab-sync.ts` line 8-9 currently reads:

```ts
// Pure derivation from raw tab fields → broadcast payload.
// Side effects (browser.runtime.sendMessage) stay in background.ts.
```

Replace with:

```ts
// Pure derivation from raw tab fields → broadcast payload. Used by
// the context menu, the sidebar refresh button, and the auto-sync
// tab listeners. Side effects (browser.runtime.sendMessage,
// browser.tabs.*) stay in their respective call sites.
```

Also rename the exported interface to drop the menu reference:

```ts
// Old:
export interface ContextMenuSync {
// New:
export interface TabSync {
```

…and update the function's return type:

```ts
// Old:
export function deriveSync(
  tabUrl: string | undefined,
  tabTitle: string | undefined,
): ContextMenuSync | null {
// New:
export function deriveSync(
  tabUrl: string | undefined,
  tabTitle: string | undefined,
): TabSync | null {
```

- [ ] **Step 6: Verify nothing else imports the old name**

Run: `grep -rn "context-menu" src tests public`
Expected: zero matches (the old menu *item id* in background.ts is
`show-in-brreg-sidebar`, unrelated to the module name).

- [ ] **Step 7: Run the full check gate**

Run: `pnpm typecheck && pnpm lint:ts && pnpm test`
Expected: all green. 31 vitest tests should still pass (no behavior
change).

- [ ] **Step 8: Commit**

```bash
git add src/lib/tab-sync.ts tests/tab-sync.test.ts src/background/background.ts
git commit -m "Rename context-menu module to tab-sync"
```

---

## Task 2: Add `optional_permissions: ["tabs"]` to manifest

**Why next:** Additive, no UI yet. Validates the manifest change in
isolation.

**Files:**
- Modify: `public/manifest.json`

- [ ] **Step 1: Add the optional_permissions key**

In `public/manifest.json`, after the `permissions` line (currently
line 36):

```json
  "permissions": ["activeTab", "storage", "menus"],
  "optional_permissions": ["tabs"],
  "host_permissions": ["https://data.brreg.no/*"],
```

- [ ] **Step 2: Build and lint the extension**

Run: `pnpm build && pnpm lint:ext`
Expected: build green, web-ext lint 0/0/0 (no errors, no warnings,
no notices). `optional_permissions` is fully supported in MV3.

- [ ] **Step 3: Manual sanity check (no UI yet)**

In one terminal: `pnpm dev`. Once Firefox boots with the extension
loaded, open `about:addons` → brreg-now → Permissions tab. You should
see the install-granted permissions (activeTab, storage, menus,
data.brreg.no/*) and a separate "Optional permissions" section listing
`tabs` as *off*. No prompt should have fired on install.

- [ ] **Step 4: Commit**

```bash
git add public/manifest.json
git commit -m "Add tabs to optional_permissions for runtime opt-in"
```

---

## Task 3: `auto-sync-settings.ts` — storage helpers (TDD)

**Why:** Pure storage I/O is testable in isolation. Locks the schema
before the controller layer depends on it.

**Files:**
- Create: `src/lib/auto-sync-settings.ts`
- Test: `tests/auto-sync-settings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/auto-sync-settings.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm exec vitest run tests/auto-sync-settings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `src/lib/auto-sync-settings.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/auto-sync-settings.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Run the full gate**

Run: `pnpm typecheck && pnpm lint:ts && pnpm test`
Expected: all green, 36 tests total (31 + 5 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/auto-sync-settings.ts tests/auto-sync-settings.test.ts
git commit -m "Add auto-sync settings storage helpers"
```

---

## Task 4: `auto-sync-controller.ts` — pure decision logic (TDD)

**Why:** Extracts the toggle state machine from `details.ts` so the
DOM-touching wiring stays thin. Without this split, the controller
logic would live tangled with input.checked reads and is hard to test.

**Files:**
- Create: `src/lib/auto-sync-controller.ts`
- Test: `tests/auto-sync-controller.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/auto-sync-controller.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decideToggle } from '../src/lib/auto-sync-controller.js';

describe('decideToggle', () => {
  it('flip-to-on with grant: persist true, signal listener-attach', () => {
    const result = decideToggle({
      desired: true,
      currentlyEnabled: false,
      grantOutcome: 'granted',
    });
    expect(result).toEqual({
      nextEnabled: true,
      persist: true,
      attachListeners: true,
      detachListeners: false,
      removePermission: false,
      uiMessage: null,
    });
  });

  it('flip-to-on with deny: revert, no persist, surface message', () => {
    const result = decideToggle({
      desired: true,
      currentlyEnabled: false,
      grantOutcome: 'denied',
    });
    expect(result).toEqual({
      nextEnabled: false,
      persist: false,
      attachListeners: false,
      detachListeners: false,
      removePermission: false,
      uiMessage:
        'Firefox blokkerte forespørselen. Klikk igjen for å prøve på nytt.',
    });
  });

  it('flip-to-off: persist false, detach listeners, remove permission', () => {
    const result = decideToggle({
      desired: false,
      currentlyEnabled: true,
      grantOutcome: 'n/a',
    });
    expect(result).toEqual({
      nextEnabled: false,
      persist: true,
      attachListeners: false,
      detachListeners: true,
      removePermission: true,
      uiMessage: null,
    });
  });

  it('external revoke (currentlyEnabled true, desired false, n/a): no permission.remove (already gone)', () => {
    const result = decideToggle({
      desired: false,
      currentlyEnabled: true,
      grantOutcome: 'n/a',
      externalRevoke: true,
    });
    expect(result).toEqual({
      nextEnabled: false,
      persist: true,
      attachListeners: false,
      detachListeners: true,
      removePermission: false,
      uiMessage: null,
    });
  });

  it('idempotent flip-to-on when already enabled with grant: no-op signal set', () => {
    const result = decideToggle({
      desired: true,
      currentlyEnabled: true,
      grantOutcome: 'granted',
    });
    expect(result).toEqual({
      nextEnabled: true,
      persist: false,
      attachListeners: false,
      detachListeners: false,
      removePermission: false,
      uiMessage: null,
    });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm exec vitest run tests/auto-sync-controller.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `src/lib/auto-sync-controller.ts`:

```ts
// Pure decision logic for the auto-sync toggle. No browser API
// calls — caller is responsible for executing the returned
// side-effect descriptor.

export interface DecideInput {
  desired: boolean;
  currentlyEnabled: boolean;
  grantOutcome: 'granted' | 'denied' | 'n/a';
  externalRevoke?: boolean;
}

export interface DecideOutput {
  nextEnabled: boolean;
  persist: boolean;
  attachListeners: boolean;
  detachListeners: boolean;
  removePermission: boolean;
  uiMessage: string | null;
}

const DENY_MESSAGE =
  'Firefox blokkerte forespørselen. Klikk igjen for å prøve på nytt.';

export function decideToggle(input: DecideInput): DecideOutput {
  const { desired, currentlyEnabled, grantOutcome, externalRevoke } = input;

  if (desired && !currentlyEnabled) {
    if (grantOutcome === 'granted') {
      return {
        nextEnabled: true,
        persist: true,
        attachListeners: true,
        detachListeners: false,
        removePermission: false,
        uiMessage: null,
      };
    }
    return {
      nextEnabled: false,
      persist: false,
      attachListeners: false,
      detachListeners: false,
      removePermission: false,
      uiMessage: DENY_MESSAGE,
    };
  }

  if (!desired && currentlyEnabled) {
    return {
      nextEnabled: false,
      persist: true,
      attachListeners: false,
      detachListeners: true,
      removePermission: !externalRevoke,
      uiMessage: null,
    };
  }

  return {
    nextEnabled: currentlyEnabled,
    persist: false,
    attachListeners: false,
    detachListeners: false,
    removePermission: false,
    uiMessage: null,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/auto-sync-controller.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Run the full gate**

Run: `pnpm typecheck && pnpm lint:ts && pnpm test`
Expected: 41 tests total.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auto-sync-controller.ts tests/auto-sync-controller.test.ts
git commit -m "Add pure auto-sync toggle decision logic"
```

---

## Task 5: Background tab listeners + permission lifecycle

**Why:** Wires the actual auto-sync delivery. Self-contained from
the UI — once this lands, `permissions.request` from anywhere triggers
listener attachment.

**Files:**
- Modify: `src/background/background.ts`

This task does not add unit tests — the wiring is browser-API-heavy
and the testable derivation (`deriveSync`) is already covered. Manual
test gate in step 6 covers behavior.

- [ ] **Step 1: Replace the contents of `src/background/background.ts`**

```ts
// The popup is the entire toolbar UI surface. The service worker
// hosts the context-menu handler and (when granted) the tab-switch
// listeners that drive sidebar auto-refresh.
//
// `tabs` is in optional_permissions. Listeners are attached only
// when the user has both (a) granted tabs and (b) flipped the
// auto-sync toggle on. Both conditions are re-checked at boot
// because the service worker dies and respawns under MV3.

import { AUTO_SYNC_STORAGE_KEY, getAutoSync } from '../lib/auto-sync-settings.js';
import { deriveSync } from '../lib/tab-sync.js';

const MENU_ID = 'show-in-brreg-sidebar';

function registerMenu(): void {
  // menus.create is idempotent only across browser restarts, not within
  // the same session — calling it twice with the same id throws. Both
  // onInstalled and onStartup fire once per session at most, so a
  // single create call from each is safe.
  browser.menus.create({
    id: MENU_ID,
    title: 'Vis i brreg-now sidebar',
    contexts: ['page'],
  });
}

browser.runtime.onInstalled.addListener(registerMenu);
browser.runtime.onStartup.addListener(registerMenu);

async function broadcastSync(
  orgnr: string,
  host: string | undefined,
): Promise<void> {
  try {
    await browser.runtime.sendMessage({ type: 'sync', orgnr, host });
  } catch {
    // No listener (sidebar closed) — sendMessage rejects. Silent: the
    // menu item, refresh button, and auto-sync are all best-effort;
    // the user can re-open the sidebar to pick up the latest state.
  }
}

browser.menus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const sync = deriveSync(tab?.url, tab?.title);
  if (!sync) return;
  void broadcastSync(sync.orgnr, sync.host);
});

// --- auto-sync tab listeners --------------------------------------

async function handleActivated(
  info: browser.tabs._OnActivatedActiveInfo,
): Promise<void> {
  try {
    const tab = await browser.tabs.get(info.tabId);
    const sync = deriveSync(tab.url, tab.title);
    if (!sync) return;
    await broadcastSync(sync.orgnr, sync.host);
  } catch {
    // Tab gone, permission revoked mid-flight, etc. — drop silently.
  }
}

function handleUpdated(
  _tabId: number,
  changeInfo: browser.tabs._OnUpdatedChangeInfo,
  tab: browser.tabs.Tab,
): void {
  // Only fire on URL transitions; title-only updates from media
  // playback or notification badges shouldn't churn the sidebar.
  if (!changeInfo.url) return;
  if (!tab.active) return;
  const sync = deriveSync(tab.url, tab.title);
  if (!sync) return;
  void broadcastSync(sync.orgnr, sync.host);
}

let listenersAttached = false;

function attachTabListeners(): void {
  if (listenersAttached) return;
  browser.tabs.onActivated.addListener(handleActivated);
  browser.tabs.onUpdated.addListener(handleUpdated);
  listenersAttached = true;
}

function detachTabListeners(): void {
  if (!listenersAttached) return;
  browser.tabs.onActivated.removeListener(handleActivated);
  browser.tabs.onUpdated.removeListener(handleUpdated);
  listenersAttached = false;
}

async function reconcileListeners(): Promise<void> {
  const [hasTabs, toggleOn] = await Promise.all([
    browser.permissions.contains({ permissions: ['tabs'] }),
    getAutoSync(),
  ]);
  if (hasTabs && toggleOn) {
    attachTabListeners();
  } else {
    detachTabListeners();
  }
}

browser.permissions.onAdded.addListener((perms) => {
  if (!perms.permissions?.includes('tabs')) return;
  void reconcileListeners();
});

browser.permissions.onRemoved.addListener((perms) => {
  if (!perms.permissions?.includes('tabs')) return;
  // Belt-and-braces: detach immediately even before reconcile lands,
  // so a stray tab event between revoke and storage flush can't fire.
  detachTabListeners();
  void reconcileListeners();
});

// React to the toggle being flipped in the sidebar (storage.local
// write). storage.onChanged fires for both local and session areas;
// gate on areaName to avoid waking on cache writes.
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (!(AUTO_SYNC_STORAGE_KEY in changes)) return;
  void reconcileListeners();
});

// Boot reconciliation — MV3 service workers die and respawn; we
// can't rely on listener registration from a previous session.
browser.runtime.onInstalled.addListener(() => void reconcileListeners());
browser.runtime.onStartup.addListener(() => void reconcileListeners());

// Also reconcile on cold start of this module (covers the case where
// the worker wakes from an event without firing onStartup, e.g. a
// runtime.onMessage). Best-effort; harmless if it runs twice.
void reconcileListeners();
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: green. If `browser.tabs._OnActivatedActiveInfo` /
`_OnUpdatedChangeInfo` types are unavailable in the firefox-webext-browser
typing version pinned, fall back to:

```ts
async function handleActivated(info: { tabId: number }): Promise<void> {
function handleUpdated(
  _tabId: number,
  changeInfo: { url?: string },
  tab: browser.tabs.Tab,
): void {
```

- [ ] **Step 3: Lint**

Run: `pnpm lint:ts`
Expected: green.

- [ ] **Step 4: Build + web-ext lint**

Run: `pnpm build && pnpm lint:ext`
Expected: 0/0/0 from web-ext lint.

- [ ] **Step 5: Tests still pass**

Run: `pnpm test`
Expected: 41 tests pass (no new tests in this task, but no regression).

- [ ] **Step 6: Manual smoke**

Run: `pnpm dev`. Once Firefox boots:

1. Open `about:debugging` → "This Firefox" → brreg-now → "Inspect"
   for the background script.
2. In that DevTools console:

```js
await browser.permissions.request({ permissions: ['tabs'] });
// click "Allow" in the prompt
await browser.storage.local.set({ 'settings.autoSyncOnTabSwitch': true });
```

3. Open the sidebar from the toolbar.
4. Switch between dnb.no and vg.no in the address bar.
5. Sidebar should re-render on each tab switch.
6. Revoke from `about:addons` → brreg-now → Permissions → toggle
   `tabs` off. Tab switches should stop triggering re-render.

- [ ] **Step 7: Commit**

```bash
git add src/background/background.ts
git commit -m "Wire background tab listeners gated by tabs permission"
```

---

## Task 6: Header toolbar UI (HTML + CSS)

**Why:** Adds the surface the controller will hook into. No JS yet —
the input element is inert until Task 7.

**Files:**
- Modify: `src/details/details.html`
- Modify: `src/details/details.css`

- [ ] **Step 1: Edit `src/details/details.html` — add toolbar to header**

Replace the current `<header>` block (lines 11-13):

```html
<header>
  <h1><img id="brand-mark" class="brand-mark" alt="" />Brønnøysund Insight</h1>
</header>
```

with:

```html
<header>
  <h1><img id="brand-mark" class="brand-mark" alt="" />Brønnøysund Insight</h1>
  <div class="toolbar" role="toolbar" aria-label="Sidebar-handlinger">
    <label class="toggle" for="auto-sync-toggle">
      <input type="checkbox" id="auto-sync-toggle" />
      <span class="toggle-track" aria-hidden="true"></span>
      <span class="toggle-label">Auto-oppdater ved fane-bytte</span>
    </label>
    <button
      type="button"
      id="refresh-btn"
      class="icon-btn"
      aria-label="Oppdater data"
      title="Oppdater data"
    >
      ↻
    </button>
  </div>
  <p id="auto-sync-status" class="auto-sync-status" role="status" aria-live="polite" hidden></p>
</header>
```

- [ ] **Step 2: Edit `src/details/details.html` — remove refresh from footer**

Replace the current `<span id="footer-updated">` block (lines 142-156):

```html
<span id="footer-updated" class="footer-updated" hidden>
  <span id="footer-source" hidden
    >Synket fra <span id="source-host"></span> ·
  </span>
  Oppdatert: <time id="updated-time"></time>
  <button
    type="button"
    id="refresh-btn"
    class="icon-btn"
    aria-label="Oppdater data"
    title="Oppdater data"
  >
    ↻
  </button>
</span>
```

with (refresh-btn removed, everything else preserved):

```html
<span id="footer-updated" class="footer-updated" hidden>
  <span id="footer-source" hidden
    >Synket fra <span id="source-host"></span> ·
  </span>
  Oppdatert: <time id="updated-time"></time>
</span>
```

- [ ] **Step 3: Edit `src/details/details.css` — change header layout**

Find the `main > header` rule (currently lines 50-57):

```css
main > header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}
```

Replace with (column layout so toolbar sits under the h1):

```css
main > header {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  margin-bottom: 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}

main > header > h1 {
  align-self: flex-start;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  color: var(--muted);
}

.toggle input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.toggle-track {
  width: 28px;
  height: 16px;
  border-radius: var(--radius-pill);
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  position: relative;
  transition: background 120ms ease, border-color 120ms ease;
}

.toggle-track::after {
  content: '';
  position: absolute;
  top: 1px;
  left: 1px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--muted);
  transition: transform 160ms ease, background 120ms ease;
}

.toggle input:checked ~ .toggle-track {
  background: var(--success-bg);
  border-color: var(--success-border);
}

.toggle input:checked ~ .toggle-track::after {
  transform: translateX(12px);
  background: var(--success);
}

.toggle input:focus-visible ~ .toggle-track {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.toggle-label {
  color: var(--fg);
}

.auto-sync-status {
  margin: 0;
  font-size: 12px;
  color: var(--warn);
}
```

- [ ] **Step 4: Adjust `.icon-btn` margin — refresh no longer needs left margin in the toolbar**

Find `.icon-btn` (currently line 387). Change `margin-left: 6px;` to
`margin-left: 0;`. The toolbar's `gap: 12px` provides the spacing now.
The button still inherits the rotate-on-click animation.

- [ ] **Step 5: Build + manual smoke**

Run: `pnpm build && pnpm dev`. Open the sidebar on any page.

Expected visual: header row with the logo + "Brønnøysund Insight",
then a second row inside the header with the toggle (unchecked) on
the left and the ↻ refresh button on the right. Refresh button still
works (clicking re-fetches displayed orgnr). Toggle does nothing yet —
clicking flips the checkbox visually but nothing else happens.

- [ ] **Step 6: Commit**

```bash
git add src/details/details.html src/details/details.css
git commit -m "Add header toolbar with auto-sync toggle and refresh"
```

---

## Task 7: Wire toggle controller in `details.ts`

**Why:** Connects the UI to the controller and storage. After this,
the toggle is fully functional.

**Files:**
- Modify: `src/details/details.ts`

- [ ] **Step 1: Add imports at the top of `details.ts`**

After the existing imports (line ~22), add:

```ts
import { decideToggle } from '../lib/auto-sync-controller.js';
import { getAutoSync, setAutoSync } from '../lib/auto-sync-settings.js';
```

- [ ] **Step 2: Add DOM references**

In the block declaring element references (around line 24-45), add:

```ts
const autoSyncToggle = $('auto-sync-toggle') as HTMLInputElement;
const autoSyncStatus = $('auto-sync-status');
```

- [ ] **Step 3: Add setup call**

After `setupRefresh();` (line 52), add:

```ts
void setupAutoSyncToggle();
```

- [ ] **Step 4: Implement `setupAutoSyncToggle` and helpers**

Add this block after the `setupRefresh` function (after line 156):

```ts
async function setupAutoSyncToggle(): Promise<void> {
  // Reconcile UI state with reality on load. The toggle is "on" only
  // if both storage says so AND the tabs permission is currently
  // granted (the user can revoke externally via about:addons).
  const [storedOn, hasTabs] = await Promise.all([
    getAutoSync(),
    browser.permissions.contains({ permissions: ['tabs'] }),
  ]);
  const effective = storedOn && hasTabs;
  autoSyncToggle.checked = effective;
  if (storedOn && !hasTabs) {
    // Storage said on but permission was revoked externally. Reset.
    await setAutoSync(false);
  }

  autoSyncToggle.addEventListener('change', () => {
    void handleToggleChange(autoSyncToggle.checked);
  });

  // External revoke (about:addons) — flip the checkbox live and
  // clear stored state so the UI doesn't lie next reload.
  browser.permissions.onRemoved.addListener(async (perms) => {
    if (!perms.permissions?.includes('tabs')) return;
    autoSyncToggle.checked = false;
    await setAutoSync(false);
    showAutoSyncStatus(null);
  });
}

async function handleToggleChange(desired: boolean): Promise<void> {
  const currentlyEnabled = await getAutoSync();

  let grantOutcome: 'granted' | 'denied' | 'n/a' = 'n/a';
  if (desired && !currentlyEnabled) {
    try {
      const granted = await browser.permissions.request({
        permissions: ['tabs'],
      });
      grantOutcome = granted ? 'granted' : 'denied';
    } catch {
      grantOutcome = 'denied';
    }
  }

  const decision = decideToggle({
    desired,
    currentlyEnabled,
    grantOutcome,
  });

  // Visual checkbox state always follows the decision — important
  // when the user denied the prompt and we need to revert the tick.
  autoSyncToggle.checked = decision.nextEnabled;

  if (decision.persist) {
    await setAutoSync(decision.nextEnabled);
  }

  if (decision.removePermission) {
    try {
      await browser.permissions.remove({ permissions: ['tabs'] });
    } catch {
      // permissions.remove can reject if the permission was already
      // revoked externally; treat as success.
    }
  }

  showAutoSyncStatus(decision.uiMessage);
}

function showAutoSyncStatus(message: string | null): void {
  if (!message) {
    autoSyncStatus.hidden = true;
    autoSyncStatus.textContent = '';
    return;
  }
  autoSyncStatus.hidden = false;
  autoSyncStatus.textContent = message;
}
```

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint:ts`
Expected: green.

- [ ] **Step 6: Tests still pass**

Run: `pnpm test`
Expected: 41 tests pass.

- [ ] **Step 7: Manual smoke**

Run: `pnpm dev`. Open sidebar.

1. Toggle is off. Flip it on → Firefox shows permission prompt for
   "Access your tabs". Accept. Toggle stays on.
2. Switch to dnb.no in another tab, then back to a brreg-now-known
   site (any with a known orgnr) — sidebar should follow.
3. Flip toggle off → tab switches no longer update sidebar.
4. Flip toggle on, accept, then in `about:addons` revoke `tabs`.
   Switch back to the sidebar — toggle should now be off (the
   `permissions.onRemoved` listener flipped it).
5. Flip toggle on, then click "Block" (or Esc) on the prompt →
   toggle reverts to off, status message appears.

- [ ] **Step 8: Commit**

```bash
git add src/details/details.ts
git commit -m "Wire auto-sync toggle controller in sidebar"
```

---

## Task 8: Smart refresh button behavior

**Why:** With permission granted, ↻ should re-read the active tab
rather than re-fetch the same orgnr. Without, current behavior.

**Files:**
- Modify: `src/details/details.ts`

- [ ] **Step 1: Replace `doRefresh`**

Find `doRefresh` (currently around line 148-156):

```ts
async function doRefresh(orgnr: string): Promise<void> {
  refreshBtn.disabled = true;
  try {
    await invalidateCache(orgnr);
    await loadOrgnr(orgnr);
  } finally {
    refreshBtn.disabled = false;
  }
}
```

Replace with:

```ts
async function doRefresh(currentOrgnrArg: string): Promise<void> {
  refreshBtn.disabled = true;
  try {
    const hasTabs = await browser.permissions.contains({
      permissions: ['tabs'],
    });
    if (hasTabs) {
      const fromTab = await resolveFromActiveTab();
      if (fromTab.orgnr) {
        setSourceHost(fromTab.host);
        const url = new URL(window.location.href);
        url.searchParams.set('orgnr', fromTab.orgnr);
        window.history.replaceState(null, '', url.toString());
        await invalidateCache(fromTab.orgnr);
        await loadOrgnr(fromTab.orgnr);
        return;
      }
      // No orgnr on the active tab — fall through to refetch
      // whatever's displayed.
    }
    await invalidateCache(currentOrgnrArg);
    await loadOrgnr(currentOrgnrArg);
  } finally {
    refreshBtn.disabled = false;
  }
}
```

- [ ] **Step 2: Update `setupRefresh` to allow refresh even before a load**

Find `setupRefresh` (currently lines 141-146):

```ts
function setupRefresh(): void {
  refreshBtn.addEventListener('click', () => {
    if (!currentOrgnr || refreshBtn.disabled) return;
    void doRefresh(currentOrgnr);
  });
}
```

Replace with (allow refresh when sidebar is in empty state but
tabs permission is granted — clicking refresh after granting
should try to load from the active tab):

```ts
function setupRefresh(): void {
  refreshBtn.addEventListener('click', () => {
    if (refreshBtn.disabled) return;
    // currentOrgnr may be empty if the sidebar opened on an
    // unrecognised page. doRefresh will try the active tab if
    // tabs is granted; otherwise it's a no-op when there's nothing
    // to re-fetch.
    void doRefresh(currentOrgnr ?? '');
  });
}
```

Then in `doRefresh`, guard the fallback path against empty input:

```ts
    if (!currentOrgnrArg) return;
    await invalidateCache(currentOrgnrArg);
    await loadOrgnr(currentOrgnrArg);
```

(Place those three lines just before the `} finally {` closing brace,
replacing the existing two-line fallback.)

- [ ] **Step 3: Typecheck + lint + test**

Run: `pnpm typecheck && pnpm lint:ts && pnpm test`
Expected: all green.

- [ ] **Step 4: Manual smoke**

Run: `pnpm dev`.

1. With toggle OFF (and tabs permission absent): open sidebar on a
   known-orgnr page, click ↻ — refetches same orgnr (today's
   behavior). Switch tabs, click ↻ — still same orgnr (no change).
2. With toggle ON (tabs granted): open sidebar on dnb.no, switch to
   vg.no with toggle OFF (revert before switching) — sidebar still
   shows DNB. Click ↻ — now reads active tab and switches to VG.
   (This exercises the path where the user disabled auto but still
   wants a one-shot refresh.)
3. Sidebar opened on an unrecognised page with permission absent:
   shows empty state. Clicking ↻ does nothing visible. Grant
   permission, click ↻ → tries the active tab; if it's a known
   page, sidebar populates.

- [ ] **Step 5: Commit**

```bash
git add src/details/details.ts
git commit -m "Refresh button reads active tab when tabs granted"
```

---

## Task 9: Update CLAUDE.md and README docs

**Why:** Security narrative is load-bearing for AMO review and for
future-Claude reading the project guidance. Both files have explicit
permission tables that must stay accurate.

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `README.md` permission table**

Find the permission table (lines 15-20):

```md
| Permission | Why |
|---|---|
| `activeTab` | Read URL + title of the current tab **only when you click the icon, the sidebar icon, or a context-menu item** |
| `storage` | Cache brreg responses locally (`storage.session`, 24h TTL) |
| `menus` | Register the "Vis i brreg-now sidebar" right-click item. On Mozilla's no-prompt list — silent at install, does not grant tab snooping (activeTab still required, granted per click). |
| `host_permissions: https://data.brreg.no/*` | Fetch from the public brreg API. Only domain we contact. |
```

Replace with:

```md
| Permission | Why |
|---|---|
| `activeTab` | Read URL + title of the current tab **only when you click the icon, the sidebar icon, or a context-menu item** |
| `storage` | Cache brreg responses locally (`storage.session`, 24h TTL) and persist the "Auto-oppdater" toggle (`storage.local`) |
| `menus` | Register the "Vis i brreg-now sidebar" right-click item. On Mozilla's no-prompt list — silent at install, does not grant tab snooping (activeTab still required, granted per click). |
| `host_permissions: https://data.brreg.no/*` | Fetch from the public brreg API. Only domain we contact. |
| `optional_permissions: tabs` | **Off by default.** Required only if the user opts into "Auto-oppdater ved fane-bytte" in the sidebar. Requested at runtime via a Firefox prompt; revocable from `about:addons` or by flipping the toggle off (which calls `permissions.remove`). Install dialog stays silent. |
```

- [ ] **Step 2: Update `README.md` rule-out list**

Find lines 22-28:

```md
What this rules out:

- No `<all_urls>` host permission
- No content scripts
- No `eval` or remote-loaded code
- No third-party analytics or telemetry
- No DOM access on the pages you visit
```

Append a clarifying note after the bullet list:

```md
What this rules out:

- No `<all_urls>` host permission
- No content scripts
- No `eval` or remote-loaded code
- No third-party analytics or telemetry
- No DOM access on the pages you visit

The optional `tabs` permission grants nothing by itself: the extension
only reads `tab.url` and `tab.title` on switch/update events to resolve
an org-number, and only while the user-facing toggle is on. There is
no `cookies`, `webRequest`, or `<all_urls>` access — the security
posture stays "no DOM, no network beyond data.brreg.no".
```

- [ ] **Step 3: Update `CLAUDE.md` § Security constraints**

Find the permissions bullet (around line 185):

```md
- Permissions are `activeTab` + `storage` + `menus`. No `tabs`, no
  `<all_urls>`, no `cookies`. `menus` is on Mozilla's no-prompt list
  (silent at install) and does not grant tab snooping — the
  context-menu handler only sees a tab when the user explicitly
  right-clicks and selects the item, which triggers `activeTab` for
  that tab only. Same gesture model as the toolbar action.
```

Replace with:

```md
- Install-time permissions are `activeTab` + `storage` + `menus`.
  `tabs` lives in `optional_permissions` and is *runtime opt-in only*:
  the user must flip "Auto-oppdater ved fane-bytte" in the sidebar,
  which calls `permissions.request({permissions: ['tabs']})` on
  click. Flipping off calls `permissions.remove`. No `<all_urls>`,
  no `cookies`, no `webRequest`. `menus` is on Mozilla's no-prompt
  list (silent at install). The install dialog therefore advertises
  only `activeTab` + storage + brreg host — `tabs` does not appear
  until the user explicitly grants it.
```

- [ ] **Step 4: Add tab-sync gotcha to `CLAUDE.md`**

After the "Auto-sync on tab switch is blocked by the permission model"
paragraph (search for "Auto-sync on tab switch"), append:

```md
**Tab-sync via runtime `tabs` opt-in is the supported path.** The
sidebar exposes an "Auto-oppdater ved fane-bytte" toggle that
requests `tabs` at runtime. With grant, background.ts attaches
`tabs.onActivated`/`onUpdated` listeners and broadcasts the same
`{type:'sync', orgnr, host}` shape the popup uses. The listeners
must be re-registered on each service-worker boot — see
`reconcileListeners()` in `background.ts`. Settings live in
`storage.local` (survives browser restarts); the response cache
stays on `storage.session` (in-memory).
```

- [ ] **Step 5: Lint docs (if a markdown linter exists, skip otherwise)**

Run: `git diff --check README.md CLAUDE.md`
Expected: no whitespace errors.

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "Document optional tabs permission and auto-sync wiring"
```

---

## Task 10: Final verification gate

**Why:** Catches regressions before the branch goes to review.
Mirrors `verification-before-completion` discipline from CLAUDE.md.

- [ ] **Step 1: Run the full local gate**

```bash
pnpm typecheck && pnpm lint:ts && pnpm test && pnpm build && pnpm lint:ext && pnpm audit --prod
```

Expected:
- `pnpm typecheck`: no output, exit 0
- `pnpm lint:ts`: no output, exit 0
- `pnpm test`: 41 tests passed (31 baseline + 5 settings + 5 controller)
- `pnpm build`: clean build to `dist/`
- `pnpm lint:ext`: 0 errors, 0 warnings, 0 notices
- `pnpm audit --prod`: 0 vulnerabilities

- [ ] **Step 2: Fresh-install smoke**

Wipe Firefox dev profile so the install dialog runs cleanly:

```bash
rm -rf .web-ext-profile 2>/dev/null
pnpm dev
```

When Firefox loads the temporary add-on, the install prompt should
show only: "Access your data for sites in the data.brreg.no domain"
(plus the activeTab implicit grant — Firefox does not display this).
**It must not mention "Access your tabs".** If it does, `tabs` slipped
into the main `permissions` array somehow — re-check `manifest.json`.

- [ ] **Step 3: End-to-end manual exercise**

1. Open the sidebar on dnb.no (toggle off, no tabs permission).
   Sidebar loads DNB BANK ASA. Switch tabs to vg.no — sidebar stays
   on DNB. (Baseline behavior preserved.)
2. Right-click on vg.no body → "Vis i brreg-now sidebar". Sidebar
   switches to Schibsted/VG. (Context menu still works.)
3. Flip toggle on → Firefox prompts → accept. Switch tabs between
   dnb.no, vg.no, equinor.com — sidebar follows each switch.
4. Flip toggle off → tab switches stop being followed. Permission
   visible in `about:addons` should now be unchecked. (Confirms
   `permissions.remove` ran.)
5. Flip toggle on → re-prompted (because we removed). Accept. Go
   to `about:addons` → brreg-now → Permissions → uncheck `tabs`.
   Switch to the sidebar — the toggle should now be visibly off.
6. Refresh button: with toggle off, click ↻ on a page →
   re-fetches same orgnr. With toggle on, switch to a known-orgnr
   tab, click ↻ → reloads from the active tab.

- [ ] **Step 4: Confirm git state is clean**

```bash
git status
```

Expected: clean working tree, branch ahead of main by 8-10 commits.

- [ ] **Step 5: Push and request review**

Do *not* push without Seb's say-so — the previous milestone is also
unpushed and Seb may want to consolidate or rewrite history before
either lands on main. End the execution session here and prompt for
push approval.

---

## Open questions resolved during planning

1. **Module rename:** Yes, `context-menu.ts` → `tab-sync.ts` (Task 1).
2. **Toggle placement:** Header toolbar row, with the refresh button
   alongside (Tasks 5-6). Refresh moves out of the footer.
3. **Toggle-off policy:** Call `permissions.remove` and stop listening
   (Tasks 5, 7). "Off" truly means revoked; re-enable will re-prompt.

---

## Out of scope (deferred per spec)

- Keyboard shortcut via `commands` API.
- Migration from `storage.local` to anything else (correct already).
- Telemetry on toggle adoption.
- Broadcasting a "cleared" sync when switching to a no-orgnr tab —
  current behavior is "sidebar stays put", same as before, and the
  spec defers this decision. Revisit if Seb asks.
