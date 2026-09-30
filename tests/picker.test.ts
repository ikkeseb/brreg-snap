// «Feil bedrift?» (rejectChoice): records the rejection, re-runs the
// host search with the tab title's word hints, and tells the caller
// what is left — or nothing, when the caller moved on meanwhile. The
// picker UI itself is covered in view-components.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Candidate } from '../src/lib/hostname-search.js';
import enhetDnb from './fixtures/brreg/enhet-984851006-dnb.json';
import enhetEquinor from './fixtures/brreg/enhet-923609016-equinor.json';

vi.mock('../src/lib/hostname-search.js', () => ({
  MAX_PICKER_CANDIDATES: 4,
  addRejectedChoice: vi.fn(),
  searchByHostnameDetailed: vi.fn(),
}));

const candidates: Candidate[] = [enhetDnb, enhetEquinor].map((e) => ({
  ...e,
  evidence: 'navn',
}));

async function setup() {
  const { rejectChoice } = await import('../src/lib/ui/picker.js');
  const { createLoadSequence } = await import('../src/lib/panel-follow.js');
  const { addRejectedChoice, searchByHostnameDetailed } = await import(
    '../src/lib/hostname-search.js'
  );
  vi.mocked(addRejectedChoice).mockReset().mockResolvedValue(undefined);
  vi.mocked(searchByHostnameDetailed).mockReset();
  return {
    rejectChoice,
    loads: createLoadSequence(),
    addRejectedChoice: vi.mocked(addRejectedChoice),
    search: vi.mocked(searchByHostnameDetailed),
  };
}

beforeEach(() => {
  vi.resetModules();
});

describe('«Feil bedrift?» reject flow', () => {
  it('records the rejection and reopens the picker over what is left', async () => {
    const { rejectChoice, addRejectedChoice, search } = await setup();
    search.mockResolvedValue({
      band: 'auto',
      candidates: [candidates[1]!],
      choice: enhetEquinor.organisasjonsnummer,
      complete: true,
    });
    // Always the picker, even when one candidate now wins outright: the
    // user just expressed doubt.
    await expect(rejectChoice('dnb.no', enhetDnb.organisasjonsnummer, undefined)).resolves.toEqual({
      kind: 'picker',
      candidates: [candidates[1]],
    });
    expect(addRejectedChoice).toHaveBeenCalledWith('dnb.no', enhetDnb.organisasjonsnummer);
  });

  it('re-runs the host search with the tab title, so its word hints survive', async () => {
    const { rejectChoice, search } = await setup();
    search.mockResolvedValue({ band: 'none', candidates: [], complete: true });
    await expect(
      rejectChoice('dnb.no', enhetDnb.organisasjonsnummer, 'DNB Bank | Privat'),
    ).resolves.toEqual({ kind: 'empty' });
    expect(search).toHaveBeenCalledWith('dnb.no', 'DNB Bank | Privat');
  });

  it('without a title the host search runs on the host alone', async () => {
    const { rejectChoice, search } = await setup();
    search.mockResolvedValue({ band: 'none', candidates: [], complete: true });
    await rejectChoice('dnb.no', enhetDnb.organisasjonsnummer, undefined);
    expect(search).toHaveBeenCalledWith('dnb.no', undefined);
  });

  it('a flow that starts during the search wins over the late picker', async () => {
    const { rejectChoice, loads, search } = await setup();
    let answer!: (value: { band: 'none'; candidates: Candidate[]; complete: boolean }) => void;
    search.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const run = loads.begin();
    const outcome = rejectChoice('dnb.no', enhetDnb.organisasjonsnummer, undefined, () => run.isStale());
    await vi.waitFor(() => expect(search).toHaveBeenCalled());
    loads.begin(); // e.g. a tab event or a sync message
    answer({ band: 'none', candidates: [], complete: true });
    await expect(outcome).resolves.toBeUndefined();
  });
});
