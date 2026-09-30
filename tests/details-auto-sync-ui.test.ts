// The «Auto-oppdater» UI binding: a fake AutoSyncUi (no DOM) drives
// the toggle logic through wireAutoSync. The decision rules themselves
// are pinned in auto-sync-toggle.test.ts; this checks the wiring only,
// including that «Slå på» reaches permissions.request synchronously.

import { describe, expect, it, vi } from 'vitest';

import { wireAutoSync, type AutoSyncUi } from '../src/details/auto-sync-ui.js';

function fakeUi() {
  const handlers = { change: [] as Array<() => void>, accept: [] as Array<() => void>, cancel: [] as Array<() => void> };
  const ui: AutoSyncUi & { consent: boolean; status: string | null } = {
    checked: false,
    disabled: false,
    consent: false,
    status: null,
    focus: vi.fn(),
    onChange: (fn) => handlers.change.push(fn),
    onConsentAccept: (fn) => handlers.accept.push(fn),
    onConsentCancel: (fn) => handlers.cancel.push(fn),
    showConsent(show) {
      this.consent = show;
    },
    showStatus(message) {
      this.status = message;
    },
  };
  const fire = (kind: keyof typeof handlers) => handlers[kind].forEach((fn) => fn());
  return { ui, fire };
}

function setup() {
  const { ui, fire } = fakeUi();
  const permissions = {
    request: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    contains: vi.fn(async () => false),
  };
  const watcher = { attach: vi.fn(), detach: vi.fn() };
  const toggle = wireAutoSync(ui, {
    permissions,
    getAutoSync: vi.fn(async () => false),
    setAutoSync: vi.fn(async () => {}),
    watcher,
  });
  return { ui, fire, permissions, watcher, toggle };
}

describe('wireAutoSync', () => {
  it('switching on shows the consent first, and «Slå på» requests synchronously', async () => {
    const { ui, fire, permissions, watcher } = setup();
    ui.checked = true;
    fire('change');
    expect(ui.consent).toBe(true);
    expect(ui.checked).toBe(false);
    expect(permissions.request).not.toHaveBeenCalled();

    fire('accept');
    expect(ui.consent).toBe(false);
    expect(permissions.request).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(watcher.attach).toHaveBeenCalled();
    expect(ui.checked).toBe(true);
  });

  it('«Avbryt» hides the consent, clears the status and refocuses the control', () => {
    const { ui, fire } = setup();
    ui.checked = true;
    fire('change');
    ui.status = 'x';
    fire('cancel');
    expect(ui.consent).toBe(false);
    expect(ui.status).toBeNull();
    expect(ui.focus).toHaveBeenCalled();
  });
});
