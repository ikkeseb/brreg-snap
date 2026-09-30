// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeBrowser } from './helpers/fake-browser.js';
import {
  attachManualSearch,
  parseOrgnrQuery,
} from '../src/lib/ui/manual-search.js';
import { searchPainter } from '../src/lib/view/components/search.js';
import type { SearchHit } from '../src/types/brreg.js';
import enhetDnb from './fixtures/brreg/enhet-984851006-dnb.json';
import enhetEquinor from './fixtures/brreg/enhet-923609016-equinor.json';
import underenhetAlta from './fixtures/brreg/underenhet-973160834.json';

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

// The rows are the shared search rows (components/search.ts): a
// <button class="recent"> per hit, a .results__note line for a note or
// an error (with its «Prøv igjen» text button).
function setup() {
  const inputEl = document.createElement('input');
  const resultsEl = document.createElement('ul');
  document.body.replaceChildren(inputEl, resultsEl);
  const selected: SearchHit[] = [];
  const announced: string[] = [];
  const controller = attachManualSearch({
    inputEl,
    resultsEl,
    paint: searchPainter,
    announce: (text) => announced.push(text),
    onSelect: (hit) => selected.push(hit),
  });
  // Type, then let the 250 ms debounce elapse.
  const type = async (value: string) => {
    inputEl.value = value;
    inputEl.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(250);
  };
  const hits = () => [...resultsEl.querySelectorAll<HTMLButtonElement>('button.recent')];
  return { inputEl, resultsEl, selected, announced, type, controller, hits };
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
    const { selected, announced, type, hits } = setup();
    await type('923 609 016');
    await vi.waitFor(() => expect(hits()).toHaveLength(1));

    const [hit] = hits();
    expect(hit!.querySelector('b')?.textContent).toBe('EQUINOR ASA');
    expect(hit!.querySelector('.recent__on')?.textContent).toBe(`923${NBSP}609${NBSP}016`);
    expect(announced.at(-1)).toBe('1 treff.');
    // Straight to the entity, never a fuzzy name search on the digits.
    expect(fetchedUrls()).toEqual([`${API}/enheter/923609016`]);

    hit!.click();
    expect(selected.map((h) => h.organisasjonsnummer)).toEqual(['923609016']);
  });

  it('accepts the MVA form printed on invoices', async () => {
    routeBrreg({ [`${API}/enheter/923609016`]: () => json(enhetEquinor) });
    const { resultsEl, type, hits } = setup();
    await type('NO 923 609 016 MVA');
    await vi.waitFor(() => expect(hits()).toHaveLength(1));
    expect(resultsEl.textContent).toContain('EQUINOR ASA');
  });

  it('shows an underenhet with its parent, and selecting it loads the branch orgnr', async () => {
    routeBrreg({
      [`${API}/underenheter/973160834`]: () => json(underenhetAlta),
      [`${API}/enheter/984851006`]: () => json(enhetDnb),
    });
    const { selected, type, hits } = setup();
    await type('973160834');
    await vi.waitFor(() => expect(hits()).toHaveLength(1));

    const [hit] = hits();
    expect(hit!.querySelector('b')?.textContent).toBe(
      'DNB BANK ASA AVD ALTA — avdeling av DNB BANK ASA',
    );
    hit!.click();
    // The load falls back to the parent the same way (company-load).
    expect(selected.map((h) => h.organisasjonsnummer)).toEqual(['973160834']);
  });

  it('says so when the orgnr is neither an enhet nor an underenhet', async () => {
    routeBrreg({});
    const { resultsEl, type, hits } = setup();
    await type('984851006');
    await vi.waitFor(() =>
      expect(resultsEl.textContent).toBe(
        'Fant ingen enhet med organisasjonsnummer 984851006.',
      ),
    );
    expect(hits()).toHaveLength(0);
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
    const { resultsEl, type, hits } = setup();
    await type('dnb bank');
    await vi.waitFor(() => expect(hits()).toHaveLength(1));
    expect(resultsEl.textContent).toContain('DNB BANK ASA');
  });

  it('a failed orgnr lookup is a search error with a retry, not «no hits»', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { resultsEl, type, hits, announced } = setup();
    await type('923609016');
    await vi.waitFor(() => expect(resultsEl.querySelectorAll('.results__note')).toHaveLength(1));
    expect(resultsEl.textContent).toContain('Søket feilet.');
    expect(resultsEl.querySelector('.results__note button')?.textContent).toBe('Prøv igjen');
    expect(hits()).toHaveLength(0);
    expect(announced.at(-1)).toBe('Søket feilet.');
  });

  it('search() prefills the input and searches at once (selection lookup)', async () => {
    routeBrreg({
      [`${API}/enheter?navn=Kiwi+Norge&size=10`]: () =>
        json({ _embedded: { enheter: [enhetDnb] } }),
    });
    const { inputEl, controller, hits } = setup();
    controller.search('Kiwi Norge');
    expect(inputEl.value).toBe('Kiwi Norge');
    // No debounce: the request is already out.
    expect(fetchedUrls()).toEqual([`${API}/enheter?navn=Kiwi+Norge&size=10`]);
    await vi.waitFor(() => expect(hits()).toHaveLength(1));
  });

  it('search() of selected orgnr text looks it up directly', async () => {
    routeBrreg({ [`${API}/enheter/923609016`]: () => json(enhetEquinor) });
    const { controller, hits } = setup();
    controller.search('Org.nr. 923 609 016');
    await vi.waitFor(() => expect(hits()).toHaveLength(1));
    expect(fetchedUrls()).toEqual([`${API}/enheter/923609016`]);
  });

  it('search() below the minimum length prefills but asks brreg nothing', async () => {
    routeBrreg({});
    const { inputEl, controller } = setup();
    controller.search('K');
    expect(inputEl.value).toBe('K');
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
