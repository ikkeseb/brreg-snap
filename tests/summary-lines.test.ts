import { describe, expect, it } from 'vitest';

import { avdelingNote } from '../src/lib/ui/summary-lines.js';
import underenhetAlta from './fixtures/brreg/underenhet-973160834.json';

describe('avdelingNote', () => {
  it('names the branch and its orgnr', () => {
    expect(avdelingNote(underenhetAlta)).toBe(
      'Avdeling: DNB BANK ASA AVD ALTA (973160834)',
    );
  });
});
