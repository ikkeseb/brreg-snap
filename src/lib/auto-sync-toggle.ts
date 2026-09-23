// The panel's «Auto-oppdater» toggle: the consent step, the runtime
// `tabs` request, and attaching / detaching the tab watcher. details.ts
// wires the DOM events to these handlers; the ordering rules live here
// so they can be tested without a DOM or a browser. The decision table
// itself is decideToggle (auto-sync-controller.ts).
//
// Auto-sync is on only when storage says so AND the `tabs` grant is
// held: the user can revoke it outside the panel (about:addons).

import { decideToggle } from './auto-sync-controller.js';

const TABS: browser.permissions.Permissions = { permissions: ['tabs'] };

export interface AutoSyncToggleDeps {
  // The «Auto-oppdater» checkbox.
  toggle: { checked: boolean; disabled: boolean; focus(): void };
  // Shows or hides the consent box; showing it moves focus into it.
  showConsent(show: boolean): void;
  // The status line under the toggle. null clears it.
  showStatus(message: string | null): void;
  permissions: Pick<typeof browser.permissions, 'request' | 'remove' | 'contains'>;
  getAutoSync(): Promise<boolean>;
  setAutoSync(on: boolean): Promise<void>;
  // Undefined when the panel couldn't learn its window: it can't tell
  // its own tabs from other windows', so it follows none.
  watcher: { attach(): void; detach(): void } | undefined;
}

export interface AutoSyncToggle {
  // The checkbox's change event.
  changed(): void;
  // «Slå på» in the consent box: both the consent and the fresh
  // gesture permissions.request needs.
  accept(): void;
  // «Avbryt», or Escape inside the consent box.
  cancel(): void;
  // Match the stored setting and the grant: at startup, and when the
  // toggle flips in another window's panel.
  reconcile(): Promise<void>;
  // permissions.onRemoved: an external revoke.
  permissionsRemoved(perms: browser.permissions.Permissions): Promise<void>;
}

export function createAutoSyncToggle(deps: AutoSyncToggleDeps): AutoSyncToggle {
  const { toggle } = deps;
  // The effective state, cached so the accept click reaches
  // permissions.request without an await in between: Firefox consumes
  // the user activation on the first await and then rejects the
  // request («may only be called from a user input handler»).
  let enabled = false;
  // A click owns the state until its prompt settles. Without this, a
  // second click while the first prompt is pending interleaves the two
  // decisions, and the final state can contradict the last click.
  let inFlight = false;

  function apply(on: boolean): void {
    enabled = on;
    toggle.checked = on;
    if (on) deps.watcher?.attach();
    else deps.watcher?.detach();
  }

  async function setDesired(desired: boolean): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    toggle.disabled = true;
    // Captured before any await: a revoke can flip `enabled` meanwhile.
    const wasEnabled = enabled;
    try {
      let grantOutcome: 'granted' | 'denied' | 'n/a' = 'n/a';
      if (desired && !wasEnabled) {
        // CRITICAL: the first async call after the click (§ gesture-stack).
        try {
          grantOutcome = (await deps.permissions.request(TABS))
            ? 'granted'
            : 'denied';
        } catch {
          grantOutcome = 'denied';
        }
      }

      const decision = decideToggle({
        desired,
        currentlyEnabled: wasEnabled,
        grantOutcome,
      });

      // The checkbox always follows the decision: a declined prompt
      // must untick it again.
      toggle.checked = decision.nextEnabled;
      // Detach first on the way off, so no tab event is resolved while
      // the storage write and permission removal are pending.
      if (decision.detachListeners) apply(false);
      if (decision.persist) {
        await deps.setAutoSync(decision.nextEnabled);
        enabled = decision.nextEnabled;
      }
      if (decision.attachListeners) apply(true);
      if (decision.removePermission) {
        try {
          await deps.permissions.remove(TABS);
        } catch {
          // Best-effort: the grant stays, but storage already says off,
          // so nothing follows tabs. The user can revoke it by hand.
        }
      }
      deps.showStatus(decision.uiMessage);
    } finally {
      toggle.disabled = false;
      inFlight = false;
    }
  }

  return {
    changed(): void {
      // Switching on first says what auto-sync sends and to whom (store
      // policies want the disclosure before the grant, and Firefox < 140
      // has no built-in data-consent prompt). No request yet.
      if (toggle.checked && !enabled) {
        toggle.checked = false;
        deps.showStatus(null);
        deps.showConsent(true);
        return;
      }
      deps.showConsent(false);
      void setDesired(toggle.checked);
    },

    accept(): void {
      deps.showConsent(false);
      toggle.checked = true;
      // No await before this call: setDesired's first await is
      // permissions.request.
      void setDesired(true);
    },

    cancel(): void {
      deps.showConsent(false);
      deps.showStatus(null);
      toggle.focus();
    },

    async reconcile(): Promise<void> {
      const [storedOn, hasTabs] = await Promise.all([
        deps.getAutoSync(),
        deps.permissions.contains(TABS),
      ]);
      if (inFlight) return;
      apply(storedOn && hasTabs);
      // Stored on, but the grant was revoked outside the panel: reset.
      if (storedOn && !hasTabs) await deps.setAutoSync(false);
    },

    async permissionsRemoved(perms): Promise<void> {
      if (!perms.permissions?.includes('tabs')) return;
      // Detach before any await so no tab event slips in after the revoke.
      apply(false);
      await deps.setAutoSync(false);
      deps.showStatus(null);
    },
  };
}
