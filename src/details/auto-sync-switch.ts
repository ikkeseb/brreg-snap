// The masthead's «Auto-oppdater» switch (button[role=switch]) and its
// consent band, as the AutoSyncUi the toggle logic binds to
// (auto-sync-ui.ts). The band sits under the mast: the disclosure, then
// «Slå på» (whose click must reach permissions.request synchronously —
// the gesture-stack rule) and «Avbryt». The status line is visible text
// AND goes through the surface's one live region.

import { COPY } from '../lib/view/copy.js';
import { button, el } from '../lib/view/components/dom.js';
import type { LiveRegion } from '../lib/view/components/live.js';
import type { AutoSyncUi } from './auto-sync-ui.js';

export function createSwitchAutoSyncUi(
  toggle: HTMLButtonElement,
  host: HTMLElement,
  live: LiveRegion,
): AutoSyncUi {
  let checked = toggle.getAttribute('aria-checked') === 'true';
  const changeHandlers: Array<() => void> = [];
  const acceptHandlers: Array<() => void> = [];
  const cancelHandlers: Array<() => void> = [];

  const band = el('div', 'consent');
  band.setAttribute('role', 'group');
  const text = el('p', 'consent__text', COPY.autoSyncConsent);
  text.id = 'auto-sync-consent-text';
  band.setAttribute('aria-labelledby', text.id);
  band.appendChild(text);
  const actions = el('div', 'consent__actions');
  const accept = button('btn btn--sm btn--primary', COPY.autoSyncAccept);
  accept.addEventListener('click', () => {
    for (const fn of acceptHandlers) fn();
  });
  const cancel = button('text-btn', COPY.autoSyncCancel);
  cancel.addEventListener('click', () => {
    for (const fn of cancelHandlers) fn();
  });
  actions.append(accept, cancel);
  band.appendChild(actions);
  band.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    for (const fn of cancelHandlers) fn();
  });
  band.hidden = true;
  const status = el('p', 'consent__status');
  status.hidden = true;
  host.append(band, status);

  toggle.addEventListener('click', () => {
    if (toggle.disabled) return;
    // Like a checkbox: the control flips, then the logic reads it.
    ui.checked = !checked;
    for (const fn of changeHandlers) fn();
  });

  const ui: AutoSyncUi = {
    get checked() {
      return checked;
    },
    set checked(value: boolean) {
      checked = value;
      toggle.setAttribute('aria-checked', String(value));
    },
    get disabled() {
      return toggle.disabled;
    },
    set disabled(value: boolean) {
      toggle.disabled = value;
    },
    focus: () => toggle.focus(),
    onChange: (fn) => changeHandlers.push(fn),
    showConsent(show): void {
      band.hidden = !show;
      if (show) accept.focus();
    },
    onConsentAccept: (fn) => acceptHandlers.push(fn),
    onConsentCancel: (fn) => cancelHandlers.push(fn),
    showStatus(message): void {
      status.hidden = !message;
      status.textContent = message ?? '';
      if (message) live.announce(message);
    },
  };
  return ui;
}
