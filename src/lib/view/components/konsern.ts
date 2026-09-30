// The konsern drill row: «Morselskap i et konsern med <b>55</b>
// selskaper» / «Del av konsern: <b>EQUINOR ASA</b> (100 %)». One line
// that opens the group (the panel's Enheter tab).

import type { KonsernView } from '../trust-view.js';
import { appendParts, button, el, icon } from './dom.js';

export interface KonsernHandlers {
  onOpen?: () => void;
}

export function buildKonsernRow(konsern: KonsernView, handlers: KonsernHandlers = {}): HTMLButtonElement {
  const btn = button('konsern');
  btn.appendChild(icon('i-tree'));
  const text = el('span', 'konsern__text');
  appendParts(text, konsern.parts);
  btn.appendChild(text);
  btn.appendChild(icon('i-chev', 'konsern__chev'));
  btn.addEventListener('click', () => handlers.onOpen?.());
  return btn;
}
