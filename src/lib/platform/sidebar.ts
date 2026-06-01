// Sidebar / side-panel adapter — the one WebExtension surface that has
// no shared shape across engines.
//
//   Firefox : browser.sidebarAction.{setPanel, open, isOpen}
//   Chrome  : chrome.sidePanel.{setOptions, open}   (no isOpen)
//
// We feature-detect at module load (`sidebarAction` is absent on
// Chromium) rather than build-time aliasing: the surface is three thin
// methods, so shipping both branches costs well under 1 KB and avoids
// any tsc/Vite alias-resolution fragility. The manifest itself is still
// switched at build time (sidebar_action vs. side_panel), which is the
// part that genuinely cannot be unified.
//
// All callers pass an extension-root-RELATIVE path (e.g.
// "details/details.html?orgnr=123"). Firefox needs a fully-qualified
// moz-extension:// URL, so the Firefox branch resolves it via
// runtime.getURL; Chrome's setOptions takes the relative path directly.

import { isFirefox } from './engine.js';

export interface OpenTarget {
  windowId?: number;
  tabId?: number;
}

export interface SidebarAdapter {
  /** Point the panel at `relativePath`. Updates the next-open target
   *  and, on Firefox, the already-open panel's URL. Fire-and-forget. */
  setPanel(relativePath: string): void;
  /** Open the panel. MUST be called synchronously inside a user-gesture
   *  stack — both engines consume the activation token on the first
   *  await, and Chrome's sidePanel.open hard-requires a live gesture. */
  open(target: OpenTarget): void;
  /** Whether a panel is currently visible. Firefox can answer; Chrome
   *  has no query API, so it optimistically returns true — every caller
   *  treats the follow-up setPanel/sendMessage as best-effort and
   *  swallows the "no receiver" rejection when the panel is in fact
   *  closed. */
  isOpen(): Promise<boolean>;
}

// Minimal local typing for chrome.sidePanel — only the two methods we
// call. Declared inline so the build needs no @types/chrome dependency.
interface ChromeSidePanel {
  setOptions(options: {
    path?: string;
    enabled?: boolean;
    tabId?: number;
  }): Promise<void>;
  open(options: { tabId?: number; windowId?: number }): Promise<void>;
}

function chromeSidePanel(): ChromeSidePanel {
  return (globalThis as unknown as { chrome: { sidePanel: ChromeSidePanel } })
    .chrome.sidePanel;
}

const firefoxSidebar: SidebarAdapter = {
  setPanel(relativePath) {
    void browser.sidebarAction.setPanel({
      panel: browser.runtime.getURL(relativePath),
    });
  },
  open() {
    void browser.sidebarAction.open();
  },
  isOpen() {
    return browser.sidebarAction.isOpen({});
  },
};

const chromeSidebar: SidebarAdapter = {
  setPanel(relativePath) {
    void chromeSidePanel().setOptions({ path: relativePath, enabled: true });
  },
  open(target) {
    if (target.windowId === undefined && target.tabId === undefined) return;
    // {windowId} opens the global panel window-wide (matches Firefox's
    // single shared sidebar); fall back to {tabId} when no window id is
    // available. Never await before this call — see open()'s contract.
    void chromeSidePanel().open(
      target.windowId !== undefined
        ? { windowId: target.windowId }
        : { tabId: target.tabId },
    );
  },
  isOpen() {
    return Promise.resolve(true);
  },
};

export const sidebar: SidebarAdapter = isFirefox
  ? firefoxSidebar
  : chromeSidebar;
