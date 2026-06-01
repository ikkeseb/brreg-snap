// Cross-engine `browser.*` bootstrap.
//
// Firefox defines both the promise-based `browser` namespace and the
// legacy `chrome` one. Chromium defines only `chrome`. Modern Chrome
// (MV3) returns native Promises from every extension API this codebase
// awaits (storage, tabs, permissions, runtime, sidePanel — verified at
// the manifest's minimum_chrome_version floor), so `chrome` is a
// drop-in for the promise-based `browser` namespace. We therefore alias
// `globalThis.browser = chrome` on Chromium instead of pulling in
// webextension-polyfill — keeping the shipped bundle free of any
// third-party JavaScript (see CLAUDE.md § Dependencies).
//
// Import this module FOR ITS SIDE EFFECT as the very first import of
// every entry point (background, popup, details) so the global exists
// before any other module touches `browser`. It has no imports of its
// own, so it runs to completion during its own module evaluation —
// ahead of the importing entry's body and its sibling imports.
//
// The only APIs that genuinely differ between engines (the Firefox
// sidebar vs. the Chrome side panel) are isolated behind
// `platform/sidebar.ts`; everything else rides the aliased namespace.

const g = globalThis as { browser?: unknown; chrome?: unknown };
if (g.browser === undefined && g.chrome !== undefined) {
  g.browser = g.chrome;
}

export {};
