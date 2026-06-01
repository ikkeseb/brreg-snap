// Which engine we're on, by feature detection — evaluated after
// globals.ts has aliased `browser = chrome` on Chromium. Firefox
// exposes the sidebar API (`sidebarAction`); Chromium exposes the side
// panel instead. Used both by the sidebar adapter and to gate the
// Firefox-only auto-sync (`tabs` opt-in) feature, which is deferred on
// Chrome to a post-launch update (see docs/chrome-port.md Phase 6).
//
// Anything importing this must import platform/globals.js first so the
// `browser` alias exists before this reads it.
export const isFirefox =
  typeof browser !== 'undefined' && 'sidebarAction' in browser;
