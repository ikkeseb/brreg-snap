// Pure decision logic for the auto-sync toggle. No browser API
// calls — caller is responsible for executing the returned
// side-effect descriptor.

export interface DecideInput {
  desired: boolean;
  currentlyEnabled: boolean;
  grantOutcome: 'granted' | 'denied' | 'n/a';
  externalRevoke?: boolean;
}

export interface DecideOutput {
  nextEnabled: boolean;
  persist: boolean;
  attachListeners: boolean;
  detachListeners: boolean;
  removePermission: boolean;
  uiMessage: string | null;
}

const DENY_MESSAGE =
  'Firefox blokkerte forespørselen. Klikk igjen for å prøve på nytt.';

export function decideToggle(input: DecideInput): DecideOutput {
  const { desired, currentlyEnabled, grantOutcome, externalRevoke } = input;

  if (desired && !currentlyEnabled) {
    if (grantOutcome === 'granted') {
      return {
        nextEnabled: true,
        persist: true,
        attachListeners: true,
        detachListeners: false,
        removePermission: false,
        uiMessage: null,
      };
    }
    return {
      nextEnabled: false,
      persist: false,
      attachListeners: false,
      detachListeners: false,
      removePermission: false,
      uiMessage: DENY_MESSAGE,
    };
  }

  if (!desired && currentlyEnabled) {
    return {
      nextEnabled: false,
      persist: true,
      attachListeners: false,
      detachListeners: true,
      removePermission: !externalRevoke,
      uiMessage: null,
    };
  }

  return {
    nextEnabled: currentlyEnabled,
    persist: false,
    attachListeners: false,
    detachListeners: false,
    removePermission: false,
    uiMessage: null,
  };
}
