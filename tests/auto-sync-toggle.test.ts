// The panel's «Auto-oppdater» flow without a DOM: the consent step,
// the gesture rule for permissions.request, and when the tab watcher
// is attached or detached. The fakes log every side effect in order.

import { describe, expect, it, vi } from 'vitest';

import { DENY_MESSAGE } from '../src/lib/auto-sync-controller.js';
import { createAutoSyncToggle } from '../src/lib/auto-sync-toggle.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function setup(opts: { storedOn?: boolean; granted?: boolean } = {}) {
  const log: string[] = [];
  const state = {
    storedOn: opts.storedOn ?? false,
    granted: opts.granted ?? false,
    consent: false,
    status: null as string | null,
  };
  const toggle = {
    checked: false,
    disabled: false,
    focus: vi.fn(() => log.push('focus toggle')),
  };
  let answer: Promise<boolean> = Promise.resolve(true);
  const permissions = {
    request: vi.fn(() => {
      log.push('request');
      return answer;
    }),
    remove: vi.fn(async () => {
      log.push('remove');
      state.granted = false;
      return true;
    }),
    contains: vi.fn(async () => state.granted),
  };
  const watcher = {
    attach: vi.fn(() => log.push('attach')),
    detach: vi.fn(() => log.push('detach')),
  };
  const autoSync = createAutoSyncToggle({
    toggle,
    showConsent: (show) => {
      state.consent = show;
    },
    showStatus: (message) => {
      state.status = message;
    },
    permissions,
    getAutoSync: async () => state.storedOn,
    setAutoSync: async (on) => {
      log.push(`store ${on}`);
      state.storedOn = on;
    },
    watcher,
  });
  // What the browser does to the checkbox before the change event.
  const click = (checked: boolean) => {
    toggle.checked = checked;
    autoSync.changed();
  };
  const answerWith = (value: Promise<boolean>) => {
    answer = value;
  };
  return { autoSync, toggle, permissions, watcher, state, log, click, answerWith };
}

async function settle(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}

describe('switching on: the consent step comes first', () => {
  it('ticking the box shows the consent, unticked, and asks the browser nothing', async () => {
    const { state, toggle, permissions, click } = setup();
    state.status = DENY_MESSAGE; // left over from an earlier decline
    click(true);
    await settle();
    expect(state.consent).toBe(true);
    expect(toggle.checked).toBe(false);
    expect(state.status).toBeNull();
    expect(permissions.request).not.toHaveBeenCalled();
  });

  it('«Slå på» calls permissions.request before anything is awaited', () => {
    const { autoSync, permissions, click } = setup();
    click(true);
    autoSync.accept();
    // Synchronously, inside the click: Firefox refuses the request once
    // the handler has awaited anything.
    expect(permissions.request).toHaveBeenCalledWith({ permissions: ['tabs'] });
  });

  it('a granted request stores the setting and starts following tabs', async () => {
    const { autoSync, state, toggle, log, click } = setup();
    click(true);
    autoSync.accept();
    await settle();
    expect(log).toEqual(['request', 'store true', 'attach']);
    expect(toggle.checked).toBe(true);
    expect(state.consent).toBe(false);
    expect(state.status).toBeNull();
  });

  it('a declined request unticks, stores nothing and says so without naming a browser', async () => {
    const { autoSync, state, toggle, log, click, answerWith } = setup();
    answerWith(Promise.resolve(false));
    click(true);
    autoSync.accept();
    await settle();
    expect(log).toEqual(['request']);
    expect(toggle.checked).toBe(false);
    expect(state.status).toBe(DENY_MESSAGE);
    expect(DENY_MESSAGE).not.toMatch(/Firefox|Chrome/);

    // Trying again reopens the consent without the old message beside it.
    click(true);
    expect(state.consent).toBe(true);
    expect(state.status).toBeNull();
  });

  it('a refused request (no user activation) reads as not granted', async () => {
    const { autoSync, state, log, click, answerWith } = setup();
    answerWith(
      Promise.reject(
        new Error('permissions.request may only be called from a user input handler'),
      ),
    );
    click(true);
    autoSync.accept();
    await settle();
    expect(log).toEqual(['request']);
    expect(state.status).toBe(DENY_MESSAGE);
  });

  it('«Avbryt» and Escape close the consent, request nothing, store nothing', async () => {
    const { autoSync, state, toggle, permissions, log, click } = setup();
    state.status = DENY_MESSAGE;
    click(true);
    autoSync.cancel();
    await settle();
    expect(state.consent).toBe(false);
    expect(state.status).toBeNull();
    expect(toggle.checked).toBe(false);
    expect(toggle.focus).toHaveBeenCalled();
    expect(permissions.request).not.toHaveBeenCalled();
    expect(log).toEqual(['focus toggle']);
  });

  it('a second «Slå på» while the prompt is open is ignored', async () => {
    const { autoSync, permissions, click, answerWith } = setup();
    const prompt = deferred<boolean>();
    answerWith(prompt.promise);
    click(true);
    autoSync.accept();
    autoSync.accept();
    expect(permissions.request).toHaveBeenCalledTimes(1);
    prompt.resolve(true);
    await settle();
  });
});

describe('switching off, revokes and other windows', () => {
  async function enabled() {
    const t = setup({ storedOn: true, granted: true });
    await t.autoSync.reconcile();
    t.log.length = 0;
    return t;
  }

  it('startup follows tabs only when stored on AND granted', async () => {
    const on = setup({ storedOn: true, granted: true });
    await on.autoSync.reconcile();
    expect(on.toggle.checked).toBe(true);
    expect(on.log).toEqual(['attach']);

    const revoked = setup({ storedOn: true, granted: false });
    await revoked.autoSync.reconcile();
    expect(revoked.toggle.checked).toBe(false);
    // Stored on without the grant: reset the setting.
    expect(revoked.log).toEqual(['detach', 'store false']);
  });

  it('unticking detaches before the storage write, then gives the grant back', async () => {
    const { log, toggle, permissions, click } = await enabled();
    click(false);
    await settle();
    expect(log).toEqual(['detach', 'store false', 'remove']);
    expect(toggle.checked).toBe(false);
    expect(permissions.request).not.toHaveBeenCalled();
  });

  it('a revoke outside the panel detaches before anything is awaited', async () => {
    const { autoSync, log, toggle, state } = await enabled();
    const done = autoSync.permissionsRemoved({ permissions: ['tabs'] });
    // Synchronously: detached and unticked before the storage write.
    expect(log[0]).toBe('detach');
    expect(toggle.checked).toBe(false);
    await done;
    expect(log).toEqual(['detach', 'store false']);
    expect(state.status).toBeNull();
  });

  it('ignores the removal of other permissions', async () => {
    const { autoSync, log, toggle } = await enabled();
    await autoSync.permissionsRemoved({ origins: ['https://example.com/*'] });
    expect(log).toEqual([]);
    expect(toggle.checked).toBe(true);
  });

  it('a flip in another window does not override a prompt still open here', async () => {
    const { autoSync, toggle, log, click, answerWith } = setup();
    const prompt = deferred<boolean>();
    answerWith(prompt.promise);
    click(true);
    autoSync.accept();
    await autoSync.reconcile(); // storage.onChanged from another panel
    expect(log).toEqual(['request']);
    prompt.resolve(true);
    await settle();
    expect(toggle.checked).toBe(true);
    expect(log).toEqual(['request', 'store true', 'attach']);
  });
});
