// @vitest-environment happy-dom
//
// The popup's 600 px budget (docs/notes/ui.md § popup-budget):
// fitBudget sheds detail one step at a time until the state fits, and
// a repaint starts from nothing shed. happy-dom has no layout, so the
// body's height is stubbed: each step shed takes 20 px off.
import { describe, expect, it } from 'vitest';

import { fitBudget } from '../src/popup/views.js';

function bodyOf(height: number): HTMLElement {
  const body = document.createElement('body');
  body.getBoundingClientRect = () => {
    const shed = [...body.classList].filter((c) => c.startsWith('shed-')).length;
    return { height: height - 20 * shed } as DOMRect;
  };
  return body;
}

describe('fitBudget', () => {
  it('sheds nothing when the state fits', () => {
    const body = bodyOf(600);
    fitBudget(body);
    expect(body.className).toBe('');
  });

  it('sheds in order, and only as far as it must', () => {
    const body = bodyOf(630);
    fitBudget(body);
    expect([...body.classList]).toEqual(['shed-1', 'shed-2']);
  });

  it('stops after the last step, even when still over', () => {
    const body = bodyOf(700);
    fitBudget(body);
    expect([...body.classList]).toEqual(['shed-1', 'shed-2', 'shed-3']);
  });

  it('a repaint that fits clears what an earlier state shed', () => {
    const body = bodyOf(630);
    fitBudget(body);
    body.getBoundingClientRect = () => ({ height: 400 }) as DOMRect;
    fitBudget(body);
    expect(body.className).toBe('');
  });
});
