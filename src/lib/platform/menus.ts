// Cross-engine context-menu accessor.
//
// The two engines expose the same API under different namespaces, gated
// by which permission the manifest requests:
//
//   Firefox : `browser.menus`         (under the `menus` permission)
//   Chromium: `chrome.contextMenus`   (under the `contextMenus` permission,
//             aliased to `browser.contextMenus` by platform/globals.ts)
//
// Crucially, Firefox does NOT expose `browser.contextMenus` under the
// `menus` permission — it is `undefined`. A hardcoded
// `browser.contextMenus.onClicked` access therefore throws a TypeError
// during the background module's top-level evaluation on Firefox, which
// aborts the rest of the module — taking the auto-sync tab listeners
// with it (so auto-sync silently dies on Firefox while Chrome works).
//
// Prefer the engine-native name and fall back, so a single accessor
// works on both. Anything importing this must import platform/globals.js
// first so the `browser` alias exists before this reads it.

const candidate = browser as {
  menus?: typeof browser.contextMenus;
  contextMenus?: typeof browser.contextMenus;
};

export const menus = (candidate.menus ?? candidate.contextMenus)!;
