# Permissions model

Source: `manifest.json`, `src/background/background.ts`,
`src/details/details.ts`, `src/lib/auto-sync-*.ts`.

<!-- SECTION: active-tab-limits -->
## Auto-sync on tab switch is blocked by activeTab — by design

`activeTab` grants extension UI access to *one* tab on user gesture
(popup click, sidebar toggle, shortcut). When the sidebar is open
and the user switches tabs in Firefox, no new gesture fires against
the extension, so `tabs.query` returns empty URL/title for the new
tab. `tabs.onActivated` fires without `tabs` permission but its
`Tab` object is stripped of URL/title for the same reason.

The permissionless paths out: (a) require a fresh gesture against
the *toolbar/shortcut* surface (click sidebar icon, ctrl+shift+B), or
(b) accept the limitation. Escalating to `tabs` as a static
install-time permission would relax the security differentiator —
see `security.md` (or `CLAUDE.md § Security constraints`). Don't
burn cycles re-investigating `webNavigation`, `tabs.onUpdated`, or
focus events; they all need `tabs` or content scripts.

<!-- SECTION: tabs-runtime-optin -->
## Tab-sync via runtime `tabs` opt-in is the supported path

The sidebar exposes an "Auto-oppdater ved fane-bytte" toggle that
requests `tabs` at runtime. With grant, background.ts attaches
`tabs.onActivated`/`onUpdated` listeners and broadcasts the same
`{type:'sync', orgnr, host}` shape the popup uses. MV3 kills and
respawns the service worker on idle, so listener registration must
run on every boot — see `reconcileListeners()` in
`src/background/background.ts`.

The same function is called from a `storage.onChanged` handler
(gated on `areaName === 'local'` and the relevant key) so external
revoke / toggle flips also reconcile without a reload. Settings live
in `storage.local` (survives browser restarts); the response cache
stays on `storage.session` (in-memory).

<!-- SECTION: gesture-stack -->
## Never await between a user gesture and `permissions.request`

Firefox consumes the user-activation token on the first await in a
click handler. If `permissions.request` lands *after* that first
await, the browser blocks the prompt with "Firefox blokkerte
forespørselen".

Same constraint for `sidebarAction.open` from the context menu.
That's why `background.ts` menu handler does a sync `deriveSync`
before `setPanel + open` and only kicks the async resolver into a
detached promise afterward.

<!-- SECTION: iframe-not-a-gesture-surface -->
## A button *inside* the sidebar iframe does NOT grant activeTab

Tested empirically: a sync button rendered inside the sidebar that
called `tabs.query({active:true, currentWindow:true})` got the same
empty `url`/`title` as `tabs.onActivated`. The user-gesture grant is
scoped to the toolbar/sidebar-action surface, not clicks inside the
already-loaded panel. A sync button existed in the sidebar header
for this — it was removed because the hypothesis was wrong. Don't
re-add it.

<!-- SECTION: android-lint-warning -->
## `pnpm lint:ext` will warn `ANDROID_INCOMPATIBLE_API` — expected

The extension is desktop-only by design: `sidebar_action` isn't
implemented on Firefox for Android, and the whole UX is built around
the sidebar. The `permissions.request` warning is noise; don't try
to silence it by dropping the optional `tabs` permission or the
runtime opt-in flow. If we ever target Android, the entire surface
needs a re-think, not a manifest tweak.
