// «Auto-oppdater»: the toggle and its consent disclosure, behind an
// interface that names no DOM type. The ordering rules (consent before
// the grant, the gesture-stack rule for permissions.request, attach /
// detach of the tab watcher) live in lib/auto-sync-toggle.ts; this
// module only binds a UI to them. The UI is the masthead's
// button[role=switch] and its consent band (auto-sync-switch.ts).
//
// With «Auto-oppdater» on (toggle stored on AND the runtime `tabs`
// grant), the panel follows the active tab of its own window: it
// registers tabs.onActivated / onUpdated itself and resolves through
// the same cascade as startup. The panel document exists only while
// the sidebar / side panel is open (MDN "Sidebars": unloaded when the
// user closes the sidebar), so closing it stops every lookup by
// construction. See docs/notes/sidebar-sync.md § panel-hosted-auto-sync.

import {
  createAutoSyncToggle,
  type AutoSyncToggle,
  type AutoSyncToggleDeps,
} from '../lib/auto-sync-toggle.js';

export interface AutoSyncUi {
  // The control's state. The toggle logic writes it back after every
  // decision (a declined prompt unticks it again).
  checked: boolean;
  disabled: boolean;
  focus(): void;
  // The user flipped the control.
  onChange(fn: () => void): void;
  // Shows or hides the consent box; showing it moves focus into it.
  showConsent(show: boolean): void;
  // «Slå på» — must reach the toggle logic synchronously (the gesture
  // stack rule: no await before permissions.request).
  onConsentAccept(fn: () => void): void;
  // «Avbryt», or Escape inside the consent box.
  onConsentCancel(fn: () => void): void;
  // The status line under the control. null clears it.
  showStatus(message: string | null): void;
}

export type AutoSyncDeps = Omit<AutoSyncToggleDeps, 'toggle' | 'showConsent' | 'showStatus'>;

// Binds the UI's events to the toggle logic. The caller still runs
// `reconcile()` and hooks the browser events (permissions.onRemoved,
// storage.onChanged) that re-run it.
export function wireAutoSync(ui: AutoSyncUi, deps: AutoSyncDeps): AutoSyncToggle {
  const toggle = createAutoSyncToggle({
    ...deps,
    toggle: ui,
    showConsent: (show) => ui.showConsent(show),
    showStatus: (message) => ui.showStatus(message),
  });
  ui.onChange(() => toggle.changed());
  ui.onConsentAccept(() => toggle.accept());
  ui.onConsentCancel(() => toggle.cancel());
  return toggle;
}
