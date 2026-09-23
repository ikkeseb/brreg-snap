// The verdict strip's DOM writer. The derivation moved to
// src/lib/trust/signals.ts (deriveSignals); deriveVerdict stays as an
// alias so the current surfaces keep compiling until the 1.4 UI rewrite
// renders the trust view instead.

import { deriveSignals } from '../trust/signals.js';
import type { Signal, Tone } from '../trust/types.js';
import type { Enhet, RegnskapResponse } from '../../types/brreg.js';

export { yearsSince } from '../trust/signals.js';

export type VerdictTone = Tone;
export type VerdictSignal = Signal;

export function deriveVerdict(
  enhet: Enhet,
  regnskap: RegnskapResponse | undefined,
  now: Date = new Date(),
): VerdictSignal[] {
  return deriveSignals(enhet, regnskap, now);
}

// DOM writer. Clears the container and paints one cell per signal.
export function renderVerdict(
  container: HTMLElement,
  signals: VerdictSignal[],
): void {
  container.replaceChildren();
  container.classList.add('verdict');
  for (const signal of signals) {
    const cell = document.createElement('div');
    cell.className = 'verdict-cell';
    cell.dataset.tone = signal.tone;

    const label = document.createElement('span');
    label.className = 'verdict-label';
    label.textContent = signal.label;
    cell.appendChild(label);

    const value = document.createElement('span');
    value.className = 'verdict-value';
    value.textContent = signal.value;
    // Ellipsised cells keep the full text reachable on hover.
    value.title = signal.value;
    cell.appendChild(value);

    if (signal.detail) {
      const detail = document.createElement('span');
      detail.className = 'verdict-detail';
      detail.textContent = signal.detail;
      detail.title = signal.detail;
      cell.appendChild(detail);
    }
    container.appendChild(cell);
  }
}
