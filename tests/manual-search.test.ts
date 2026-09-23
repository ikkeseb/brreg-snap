import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeBrowser } from './helpers/fake-browser.js';
import {
  attachManualSearch,
  parseOrgnrQuery,
} from '../src/lib/ui/manual-search.js';
import type { SearchHit } from '../src/types/brreg.js';
import enhetDnb from './fixtures/brreg/enhet-984851006-dnb.json';
import enhetEquinor from './fixtures/brreg/enhet-923609016-equinor.json';
import underenhetAlta from './fixtures/brreg/underenhet-973160834.json';
import { FakeElement, installFakeDom } from './helpers/fake-dom.js';

const API = 'https://data.brreg.no/enhetsregisteret/api';
// A non-breaking space, as in a rendered footer's "923 609 016".
const NBSP = String.fromCharCode(0xa0);

describe('parseOrgnrQuery', () => {
  it.each([
    ['923609016'],
    ['923 609 016'],
    ['923.609.016'],
    [['923', '609', '016'].join(NBSP)],
    ['NO 923 609 016 MVA'],
    ['no923609016mva'],
    ['  923 609 016  '],
    // The label a site footer prints before the number.
    ['Org.nr. 923 609 016'],
    ['Org nr: 923609016'],
    ['Org.nr: 923 609 016'],
    ['Orgnr 923609016'],
    ['ORG.NR.923609016'],
    ['org. nr. 923.609.016'],
    ['Org.nr.: NO 923 609 016 MVA'],
    [`Org.nr.${NBSP}${['923', '609', '016'].join(NBSP)}`],
  ])('reads %j as orgnr 923609016', (query) => {
    expect(parseOrgnrQuery(query)).toEqual({ kind: 'orgnr', orgnr: '923609016' });
  });

  it('flags nine digits that fail the check digit', () => {
    expect(parseOrgnrQuery('923 609 017')).toEqual({
      kind: 'invalid',
      digits: '923609017',
    });
  });

  it('flags a labelled number that fails the check digit', () => {
    expect(parseOrgnrQuery('Org.nr. 923 609 017')).toEqual({
      kind: 'invalid',
      digits: '923609017',
    });
  });

  it.each([
    ['Equinor'],
    ['dnb bank'],
    ['12345'],
    ['9236090161'],
    ['7-eleven'],
    ['Orgnr'],
    ['Org.nr. 12345'],
    ['Organic 923609016'],
  ])(
    'leaves %j to the name search',
    (query) => {
      expect(parseOrgnrQuery(query)).toBeUndefined();
    },
  );
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn();

function routeBrreg(routes: Record<string, () => Response>): void {
  fetchMock.mockImplementation(async (input: string | URL) => {
    return routes[String(input)]?.() ?? new Response('', { status: 404 });
  });
}

function fetchedUrls(): string[] {
  return fetchMock.mock.calls.map(([u]) => String(u));
}

function setup() {
  installFakeDom();
  const inputEl = new FakeElement('input');
  const resultsEl = new FakeElement('ul');
  const selected: SearchHit[] = [];
  attachManualSearch({
    inputEl: inputEl as unknown as HTMLInputElement,
    resultsEl: resultsEl as unknown as HTMLUListElement,
    onSelect: (hit) => selected.push(hit),
  });
  // Type, then let the 250 ms debounce elapse.
  const type = async (value: string) => {
    inputEl.value = value;
    inputEl.dispatch('input');
    await vi.advanceTimersByTimeAsync(250);
  };
  return { resultsEl, selected, type };
}

beforeEach(() => {
  // Only the debounce timer is faked; response bodies still stream.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // The lookups cache in storage.session; start every test cold.
  fakeBrowser();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('manual search', () => {
  it('looks a spaced orgnr up directly and shows the company as the hit', async () => {
    routeBrreg({ [`${API}/enheter/923609016`]: () => json(enhetEquinor) });
    const { resultsEl, selected, type } = setup();
    await type('923 609 016');
    await vi.waitFor(() => expect(resultsEl.findAll('manual-hit')).toHaveLength(1));

    const [hit] = resultsEl.findAll('manual-hit');
    expect(hit!.findAll('picker-item-name')[0]!.textContent).toBe('EQUINOR ASA');
    expect(hit!.findAll('picker-item-meta')[0]!.textContent).toBe('923609016');
    // Straight to the entity, never a fuzzy name search on the digits.
    expect(fetchedUrls()).toEqual([`${API}/enheter/923609016`]);

    hit!.click();
    expect(selected.map((h) => h.organisasjonsnummer)).toEqual(['923609016']);
  });

  it('accepts the MVA form printed on invoices', async () => {
    routeBrreg({ [`${API}/enheter/923609016`]: () => json(enhetEquinor) });
    const { resultsEl, type } = setup();
    await type('NO 923 609 016 MVA');
    await vi.waitFor(() => expect(resultsEl.findAll('manual-hit')).toHaveLength(1));
    expect(resultsEl.textContent).toContain('EQUINOR ASA');
  });

  it('shows an underenhet with its parent, and selecting it loads the branch orgnr', async () => {
    routeBrreg({
      [`${API}/underenheter/973160834`]: () => json(underenhetAlta),
      [`${API}/enheter/984851006`]: () => json(enhetDnb),
    });
    const { resultsEl, selected, type } = setup();
    await type('973160834');
    await vi.waitFor(() => expect(resultsEl.findAll('manual-hit')).toHaveLength(1));

    const [hit] = resultsEl.findAll('manual-hit');
    expect(hit!.findAll('picker-item-name')[0]!.textContent).toBe(
      'DNB BANK ASA AVD ALTA — avdeling av DNB BANK ASA',
    );
    hit!.click();
    // The load falls back to the parent the same way (company-load).
    expect(selected.map((h) => h.organisasjonsnummer)).toEqual(['973160834']);
  });

  it('says so when the orgnr is neither an enhet nor an underenhet', async () => {
    routeBrreg({});
    const { resultsEl, type } = setup();
    await type('984851006');
    await vi.waitFor(() =>
      expect(resultsEl.textContent).toBe(
        'Fant ingen enhet med organisasjonsnummer 984851006.',
      ),
    );
    expect(resultsEl.findAll('manual-hit')).toHaveLength(0);
  });

  it('rejects a bad check digit without asking brreg', async () => {
    routeBrreg({});
    const { resultsEl, type } = setup();
    await type('923609017');
    await vi.waitFor(() =>
      expect(resultsEl.textContent).toBe(
        '923609017 er ikke et gyldig organisasjonsnummer.',
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still searches names', async () => {
    routeBrreg({
      [`${API}/enheter?navn=dnb+bank&size=10`]: () =>
        json({ _embedded: { enheter: [enhetDnb] } }),
    });
    const { resultsEl, type } = setup();
    await type('dnb bank');
    await vi.waitFor(() => expect(resultsEl.findAll('manual-hit')).toHaveLength(1));
    expect(resultsEl.textContent).toContain('DNB BANK ASA');
  });

  it('a failed orgnr lookup is a search error with a retry, not «no hits»', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { resultsEl, type } = setup();
    await type('923609016');
    await vi.waitFor(() => expect(resultsEl.findAll('search-error')).toHaveLength(1));
    expect(resultsEl.textContent).toContain('Søket feilet.');
    expect(resultsEl.findAll('retry-button')).toHaveLength(1);
  });
});
