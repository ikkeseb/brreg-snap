// Which engine we're on, by feature detection — evaluated after
// globals.ts has aliased `browser = chrome` on Chromium. Firefox
// exposes the sidebar API (`sidebarAction`); Chromium exposes the side
// panel instead. Used by the sidebar adapter and to vary the few
// engine-specific call shapes — notably the tabs.onUpdated filter, which
// Firefox supports and Chrome rejects (see background.ts).
//
// Anything importing this must import platform/globals.js first so the
// `browser` alias exists before this reads it.
export const isFirefox =
  typeof browser !== 'undefined' && 'sidebarAction' in browser;
