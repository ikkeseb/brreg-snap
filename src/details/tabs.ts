// The result tablist: roving tabindex, arrow keys / Home / End, and
// the ?tab= key of the selected tab. Takes the tablist element; the
// history write goes through `onSelect` so this module owns no URL.

// ?tab=<key> where key is the tab id minus its "tab-" prefix
// ('oversikt' | 'personer' | 'okonomi' | 'enheter').
const tabKey = (id: string): string => id.replace(/^tab-/, '');

export interface TabsOptions {
  // The user selected a tab (click or keyboard): persist its key.
  onSelect(key: string): void;
  // Restore the deep-linked / previously-selected tab instead of
  // always booting the first. No-op when absent or unknown, leaving
  // the HTML default selected.
  initial?: string;
}

export interface Tablist {
  // Restoring a tab (on load or via popstate) must not rewrite the
  // history entry's ?tab=, only reflect it in the UI.
  activateByKey(key: string): void;
}

export function setupTabs(tablistEl: HTMLElement, opts: TabsOptions): Tablist {
  const tabs = Array.from(tablistEl.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const doc = tablistEl.ownerDocument;

  function activate(id: string): void {
    for (const tab of tabs) {
      const selected = tab.id === id;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panelId = tab.getAttribute('aria-controls');
      if (panelId) {
        const panel = doc.getElementById(panelId);
        if (panel) panel.hidden = !selected;
      }
    }
  }

  function select(tab: HTMLButtonElement): void {
    activate(tab.id);
    opts.onSelect(tabKey(tab.id));
    tab.focus();
  }

  function activateByKey(key: string): void {
    const match = tabs.find((t) => tabKey(t.id) === key);
    if (match) activate(match.id);
  }

  if (opts.initial) activateByKey(opts.initial);

  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (ev) => {
      const idx = tabs.indexOf(tab);
      let nextIdx: number;
      switch (ev.key) {
        case 'ArrowRight':
          nextIdx = (idx + 1) % tabs.length;
          break;
        case 'ArrowLeft':
          nextIdx = (idx - 1 + tabs.length) % tabs.length;
          break;
        case 'Home':
          nextIdx = 0;
          break;
        case 'End':
          nextIdx = tabs.length - 1;
          break;
        default:
          return;
      }
      ev.preventDefault();
      const next = tabs[nextIdx];
      if (next) select(next);
    });
  }

  return { activateByKey };
}
