import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildOrgnrCopyButton } from '../src/lib/copy-orgnr.js';

// Minimal stand-in for the one <button> the module builds: no DOM
// library in this repo's test setup, and the bug under test is pure
// timer/label logic.
function installFakeDom() {
  const listeners: Array<() => void> = [];
  const classes = new Set<string>();
  const btn = {
    type: '',
    className: '',
    textContent: '',
    title: '',
    setAttribute: vi.fn(),
    addEventListener: (_type: string, fn: () => void) => listeners.push(fn),
    classList: {
      add: (...names: string[]) => names.forEach((n) => classes.add(n)),
      remove: (...names: string[]) => names.forEach((n) => classes.delete(n)),
    },
    click: () => listeners.forEach((fn) => fn()),
  };
  vi.stubGlobal('document', { createElement: () => btn });
  vi.stubGlobal('window', globalThis);
  return { btn, classes };
}

const ORGNR = '923609016';
const writeText = vi.fn(async (_text: string) => {});

describe('orgnr copy button', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows «Kopiert!» and restores the digits after 1.5 s', async () => {
    const { btn, classes } = installFakeDom();
    buildOrgnrCopyButton(ORGNR);
    btn.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).toHaveBeenCalledWith(ORGNR);
    expect(btn.textContent).toBe('Kopiert!');
    expect(classes.has('copied')).toBe(true);

    await vi.advanceTimersByTimeAsync(1500);
    expect(btn.textContent).toBe(ORGNR);
    expect(classes.size).toBe(0);
  });

  it('a second click inside the window does not leave «Kopiert!» stuck', async () => {
    const { btn, classes } = installFakeDom();
    buildOrgnrCopyButton(ORGNR);
    btn.click();
    await vi.advanceTimersByTimeAsync(500);
    btn.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(btn.textContent).toBe('Kopiert!');

    // Long after both windows would have closed.
    await vi.advanceTimersByTimeAsync(5000);
    expect(btn.textContent).toBe(ORGNR);
    expect(classes.size).toBe(0);
  });

  it('says so when the clipboard write fails, then restores', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    const { btn, classes } = installFakeDom();
    buildOrgnrCopyButton(ORGNR);
    btn.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(btn.textContent).toBe('Kunne ikke kopiere');
    expect(classes.has('copy-failed')).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(btn.textContent).toBe(ORGNR);
  });
});
