import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SearchHit } from '../src/types/brreg.js';
import enhetDnb from './fixtures/brreg/enhet-984851006-dnb.json';
import enhetEquinor from './fixtures/brreg/enhet-923609016-equinor.json';
import { FakeElement, fakeEvent, installFakeDom } from './helpers/fake-dom.js';

const { setPickerChoice } = vi.hoisted(() => ({
  setPickerChoice: vi.fn(async (_host: string, _orgnr: string | null) => {}),
}));

vi.mock('../src/lib/hostname-search.js', () => ({
  MAX_PICKER_CANDIDATES: 4,
  setPickerChoice,
  addRejectedChoice: vi.fn(),
  searchByHostnameDetailed: vi.fn(),
}));

const candidates: SearchHit[] = [enhetDnb, enhetEquinor];

async function setupReject() {
  installFakeDom();
  const { setupRejectChoice } = await import('../src/lib/ui/picker.js');
  const { createLoadSequence } = await import('../src/lib/panel-follow.js');
  const { addRejectedChoice, searchByHostnameDetailed } = await import(
    '../src/lib/hostname-search.js'
  );
  const buttonEl = new FakeElement('button');
  const loads = createLoadSequence();
  const showPicker = vi.fn();
  const showEmptyState = vi.fn();
  setupRejectChoice({
    buttonEl: buttonEl as unknown as HTMLButtonElement,
    getContext: () => ({ host: 'dnb.no', orgnr: enhetDnb.organisasjonsnummer }),
    claim: () => loads.begin(),
    showPicker,
    showEmptyState,
  });
  vi.mocked(addRejectedChoice).mockReset().mockResolvedValue(undefined);
  vi.mocked(searchByHostnameDetailed).mockReset();
  return {
    buttonEl,
    loads,
    showPicker,
    showEmptyState,
    addRejectedChoice: vi.mocked(addRejectedChoice),
    search: vi.mocked(searchByHostnameDetailed),
  };
}

async function setup() {
  const { document } = installFakeDom();
  const { createPicker } = await import('../src/lib/ui/picker.js');
  const appEl = new FakeElement('main');
  const listEl = new FakeElement('ul');
  const noneBtn = new FakeElement('button');
  const onChoose = vi.fn();
  const onNone = vi.fn();
  const picker = createPicker({
    appEl: Object.assign(appEl, { dataset: { state: 'picker' } }) as unknown as HTMLElement,
    listEl: listEl as unknown as HTMLUListElement,
    noneBtn: noneBtn as unknown as HTMLButtonElement,
    onChoose,
    onNone,
  });
  picker.render('dnb.no', candidates);
  const press = (key: string) =>
    document.dispatch('keydown', fakeEvent({ key, target: document }));
  return { listEl, noneBtn, onChoose, onNone, press };
}

beforeEach(() => {
  setPickerChoice.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('picker keyboard', () => {
  it('Escape records nothing and leaves the key to the browser', async () => {
    const { onNone, press } = await setup();
    const ev = press('Escape');
    await Promise.resolve();
    expect(setPickerChoice).not.toHaveBeenCalled();
    expect(onNone).not.toHaveBeenCalled();
    // Not swallowed: in the popup, the browser's own Escape handling
    // still runs.
    expect(ev.defaultPrevented).toBe(false);
  });

  it('0 is the explicit «Ingen av disse» and persists it', async () => {
    const { onNone, press } = await setup();
    const ev = press('0');
    await vi.waitFor(() => expect(onNone).toHaveBeenCalledWith('dnb.no'));
    expect(setPickerChoice).toHaveBeenCalledWith('dnb.no', null);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('the «Ingen av disse» button persists it', async () => {
    const { noneBtn, onNone } = await setup();
    noneBtn.click();
    await vi.waitFor(() => expect(onNone).toHaveBeenCalledWith('dnb.no'));
    expect(setPickerChoice).toHaveBeenCalledWith('dnb.no', null);
  });

  it('a digit picks its row', async () => {
    const { onChoose, press } = await setup();
    press('2');
    await vi.waitFor(() =>
      expect(onChoose).toHaveBeenCalledWith('dnb.no', '923609016'),
    );
    expect(setPickerChoice).toHaveBeenCalledWith('dnb.no', '923609016');
  });
});

describe('«Feil bedrift?» reject flow', () => {
  it('records the rejection and reopens the picker over what is left', async () => {
    const { buttonEl, showPicker, addRejectedChoice, search } = await setupReject();
    search.mockResolvedValue({
      band: 'auto',
      candidates: [enhetEquinor],
      choice: enhetEquinor.organisasjonsnummer,
      complete: true,
    });
    buttonEl.click();
    await vi.waitFor(() =>
      expect(showPicker).toHaveBeenCalledWith('dnb.no', [enhetEquinor]),
    );
    expect(addRejectedChoice).toHaveBeenCalledWith(
      'dnb.no',
      enhetDnb.organisasjonsnummer,
    );
  });

  it('a flow that starts during the search wins over the late picker', async () => {
    const { buttonEl, loads, showPicker, showEmptyState, search } =
      await setupReject();
    let answer!: (value: { band: 'none'; candidates: SearchHit[]; complete: boolean }) => void;
    search.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    buttonEl.click();
    await vi.waitFor(() => expect(search).toHaveBeenCalled());
    loads.begin(); // e.g. a tab event or a sync message
    answer({ band: 'none', candidates: [], complete: true });
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(showPicker).not.toHaveBeenCalled();
    expect(showEmptyState).not.toHaveBeenCalled();
    expect(buttonEl.disabled).toBe(false);
  });
});
