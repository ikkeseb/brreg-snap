import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeClipboard } from '../src/lib/copy-orgnr.js';

describe('writeClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes the text and reports success', async () => {
    const write = vi.fn(async (_text: string) => {});
    vi.stubGlobal('navigator', { clipboard: { writeText: write } });
    await expect(writeClipboard('EQUINOR ASA\nOrg.nr. 923 609 016')).resolves.toBe(true);
    expect(write).toHaveBeenCalledWith('EQUINOR ASA\nOrg.nr. 923 609 016');
  });

  it('reports a refused write instead of throwing', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('NotAllowedError'))) },
    });
    await expect(writeClipboard('x')).resolves.toBe(false);
  });
});
