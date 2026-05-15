import { describe, expect, it } from 'vitest';
import { decideToggle } from '../src/lib/auto-sync-controller.js';

describe('decideToggle', () => {
  it('flip-to-on with grant: persist true, signal listener-attach', () => {
    const result = decideToggle({
      desired: true,
      currentlyEnabled: false,
      grantOutcome: 'granted',
    });
    expect(result).toEqual({
      nextEnabled: true,
      persist: true,
      attachListeners: true,
      detachListeners: false,
      removePermission: false,
      uiMessage: null,
    });
  });

  it('flip-to-on with deny: revert, no persist, surface message', () => {
    const result = decideToggle({
      desired: true,
      currentlyEnabled: false,
      grantOutcome: 'denied',
    });
    expect(result).toEqual({
      nextEnabled: false,
      persist: false,
      attachListeners: false,
      detachListeners: false,
      removePermission: false,
      uiMessage:
        'Firefox blokkerte forespørselen. Klikk igjen for å prøve på nytt.',
    });
  });

  it('flip-to-off: persist false, detach listeners, remove permission', () => {
    const result = decideToggle({
      desired: false,
      currentlyEnabled: true,
      grantOutcome: 'n/a',
    });
    expect(result).toEqual({
      nextEnabled: false,
      persist: true,
      attachListeners: false,
      detachListeners: true,
      removePermission: true,
      uiMessage: null,
    });
  });

  it('external revoke (currentlyEnabled true, desired false, n/a): no permission.remove (already gone)', () => {
    const result = decideToggle({
      desired: false,
      currentlyEnabled: true,
      grantOutcome: 'n/a',
      externalRevoke: true,
    });
    expect(result).toEqual({
      nextEnabled: false,
      persist: true,
      attachListeners: false,
      detachListeners: true,
      removePermission: false,
      uiMessage: null,
    });
  });

  it('idempotent flip-to-on when already enabled with grant: no-op signal set', () => {
    const result = decideToggle({
      desired: true,
      currentlyEnabled: true,
      grantOutcome: 'granted',
    });
    expect(result).toEqual({
      nextEnabled: true,
      persist: false,
      attachListeners: false,
      detachListeners: false,
      removePermission: false,
      uiMessage: null,
    });
  });

  it('flip-to-on with n/a outcome falls through to deny (documents caller contract: only granted/denied valid on flip-to-on)', () => {
    const result = decideToggle({
      desired: true,
      currentlyEnabled: false,
      grantOutcome: 'n/a',
    });
    expect(result).toEqual({
      nextEnabled: false,
      persist: false,
      attachListeners: false,
      detachListeners: false,
      removePermission: false,
      uiMessage:
        'Firefox blokkerte forespørselen. Klikk igjen for å prøve på nytt.',
    });
  });

  it('no-op when already off: nextEnabled false, no side-effects', () => {
    const result = decideToggle({
      desired: false,
      currentlyEnabled: false,
      grantOutcome: 'n/a',
    });
    expect(result).toEqual({
      nextEnabled: false,
      persist: false,
      attachListeners: false,
      detachListeners: false,
      removePermission: false,
      uiMessage: null,
    });
  });
});
