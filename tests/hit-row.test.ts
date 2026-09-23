// @vitest-environment happy-dom
//
// First real-DOM test (happy-dom, opted in per file; everything else
// stays on the node environment). appendHitSummary paints search hits
// whose fields are written by the registrants themselves, so markup in
// a company name must land as text, never as elements.
import { describe, expect, it } from 'vitest';

import { appendHitSummary } from '../src/lib/ui/hit-row.js';
import type { SearchHit } from '../src/types/brreg.js';

function hit(extra: Partial<SearchHit> = {}): SearchHit {
  return {
    organisasjonsnummer: '923609016',
    navn: 'EQUINOR ASA',
    ...extra,
  };
}

describe('appendHitSummary (happy-dom)', () => {
  it('renders registrant-supplied markup in the name as text', () => {
    const li = document.createElement('li');
    const navn = '<img src=x onerror="alert(1)">EVIL AS';
    appendHitSummary(li, hit({ navn }), { avdelingAv: '<b>MOR AS</b>' });

    expect(li.querySelector('img')).toBeNull();
    expect(li.querySelector('b')).toBeNull();
    const name = li.querySelector('.picker-item-name');
    expect(name?.textContent).toBe(`${navn} — avdeling av <b>MOR AS</b>`);
  });

  it('shows næring when present and appends ansatte only when asked', () => {
    const li = document.createElement('li');
    appendHitSummary(
      li,
      hit({
        naeringskode1: { kode: '06.100', beskrivelse: 'Utvinning av råolje' },
        antallAnsatte: 21000,
      }),
      { includeAnsatte: true },
    );
    expect([...li.children].map((el) => el.className)).toEqual([
      'picker-item-name',
      'picker-item-naering',
      'picker-item-meta',
    ]);
    expect(li.querySelector('.picker-item-naering')?.textContent).toBe('Utvinning av råolje');
    expect(li.querySelector('.picker-item-meta')?.textContent).toBe('923609016, 21000 ansatte');

    const plain = document.createElement('li');
    appendHitSummary(plain, hit({ antallAnsatte: 21000 }));
    expect(plain.querySelector('.picker-item-naering')).toBeNull();
    expect(plain.querySelector('.picker-item-meta')?.textContent).toBe('923609016');
  });
});
