// @vitest-environment happy-dom
// The result tablist over the real markup shape: roving tabindex,
// arrow keys / Home / End, and that only a user selection is persisted.

import { describe, expect, it, vi } from 'vitest';

import { setupTabs } from '../src/details/tabs.js';

const KEYS = ['oversikt', 'personer', 'nokkeltall', 'enheter'];

function mount(initial?: string) {
  const root = document.createElement('div');
  const nav = document.createElement('nav');
  nav.setAttribute('role', 'tablist');
  root.appendChild(nav);
  for (const [i, key] of KEYS.entries()) {
    const tab = document.createElement('button');
    tab.id = `tab-${key}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `panel-${key}`);
    tab.setAttribute('aria-selected', String(i === 0));
    tab.tabIndex = i === 0 ? 0 : -1;
    nav.appendChild(tab);
    const panel = document.createElement('section');
    panel.id = `panel-${key}`;
    panel.hidden = i !== 0;
    root.appendChild(panel);
  }
  document.body.replaceChildren(root);
  const onSelect = vi.fn();
  const tabs = setupTabs(nav, { onSelect, initial });
  const tab = (key: string) => document.getElementById(`tab-${key}`) as HTMLButtonElement;
  const panel = (key: string) => document.getElementById(`panel-${key}`) as HTMLElement;
  const selected = () => KEYS.filter((k) => tab(k).getAttribute('aria-selected') === 'true');
  const shown = () => KEYS.filter((k) => !panel(k).hidden);
  const press = (key: string, on: string) =>
    tab(on).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  return { tabs, onSelect, tab, selected, shown, press };
}

describe('setupTabs', () => {
  it('a click selects the tab, shows its panel, persists and focuses it', () => {
    const { tab, selected, shown, onSelect } = mount();
    tab('personer').click();
    expect(selected()).toEqual(['personer']);
    expect(shown()).toEqual(['personer']);
    expect(tab('personer').tabIndex).toBe(0);
    expect(tab('oversikt').tabIndex).toBe(-1);
    expect(onSelect).toHaveBeenCalledWith('personer');
    expect(document.activeElement).toBe(tab('personer'));
  });

  it('arrow keys wrap, Home and End jump, and other keys are left alone', () => {
    const { selected, press, onSelect } = mount();
    press('ArrowLeft', 'oversikt');
    expect(selected()).toEqual(['enheter']);
    press('ArrowRight', 'enheter');
    expect(selected()).toEqual(['oversikt']);
    press('End', 'oversikt');
    expect(selected()).toEqual(['enheter']);
    press('Home', 'enheter');
    expect(selected()).toEqual(['oversikt']);
    expect(onSelect.mock.calls.map(([k]) => k)).toEqual(['enheter', 'oversikt', 'enheter', 'oversikt']);
    const ev = new KeyboardEvent('keydown', { key: 'a', cancelable: true });
    document.getElementById('tab-oversikt')!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(selected()).toEqual(['oversikt']);
  });

  it('restores the initial key on load and via activateByKey without persisting', () => {
    const { tabs, selected, shown, onSelect } = mount('nokkeltall');
    expect(selected()).toEqual(['nokkeltall']);
    expect(shown()).toEqual(['nokkeltall']);
    tabs.activateByKey('enheter');
    expect(selected()).toEqual(['enheter']);
    tabs.activateByKey('unknown');
    expect(selected()).toEqual(['enheter']);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('an unknown initial key leaves the HTML default selected', () => {
    const { selected } = mount('nope');
    expect(selected()).toEqual(['oversikt']);
  });
});
