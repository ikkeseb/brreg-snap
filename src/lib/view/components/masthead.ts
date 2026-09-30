// Masthead: the brand mark, then per surface
//   popup — the looked-up host (registrable domain in <b>) and the
//           search icon button that opens the search view
//   panel — the search field and the Auto-oppdater switch
// <header class="mast"> is the container; the caller owns it.

import { registrableDomain } from '../../hostname-score.js';
import { COPY } from '../copy.js';
import { button, el, icon, svgUse } from './dom.js';

export type MastheadData =
  | {
      kind: 'popup';
      // The tab's hostname; undefined = nothing to look up.
      host?: string;
      // Whether the search icon button is shown (hidden while the
      // search view itself is open).
      search: boolean;
    }
  | {
      kind: 'panel';
      query?: string;
      autoSync: { on: boolean; title?: string };
    };

export interface MastheadHandlers {
  // Popup: the search icon button.
  onSearch?: () => void;
  // Panel: the switch.
  onToggleAutoSync?: () => void;
}

export interface Masthead {
  // Panel: the search input, for the controller's manual-search hookup.
  input?: HTMLInputElement;
  // Panel: the switch, for aria-checked updates.
  toggle?: HTMLButtonElement;
  // Popup: the search icon button (focus returns here after a search).
  searchButton?: HTMLButtonElement;
}

// «www.<b>dnb.no</b>»: the registrable domain is what the lookup keyed
// on, so it is the part in ink.
export function appendSiteLabel(container: HTMLElement, host: string): void {
  const site = registrableDomain(host);
  const lower = host.toLowerCase().replace(/\.+$/, '');
  if (site && lower.endsWith(site) && lower !== site) {
    container.append(lower.slice(0, lower.length - site.length));
    container.appendChild(el('b', undefined, site));
  } else {
    container.appendChild(el('b', undefined, site ?? lower));
  }
}

export function renderMasthead(
  container: HTMLElement,
  data: MastheadData,
  handlers: MastheadHandlers = {},
): Masthead {
  container.replaceChildren();
  const mark = svgUse('mark', 'mast__mark');
  mark.removeAttribute('aria-hidden');
  mark.setAttribute('role', 'img');
  mark.setAttribute('aria-label', COPY.brand);
  container.appendChild(mark);
  const out: Masthead = {};

  if (data.kind === 'popup') {
    const site = el('span', 'mast__site');
    if (data.host) appendSiteLabel(site, data.host);
    else site.textContent = COPY.noSite;
    container.appendChild(site);
    if (data.search) {
      const btn = button('icon-btn');
      btn.setAttribute('aria-label', COPY.searchLabel);
      btn.title = COPY.searchLabel;
      btn.appendChild(icon('i-search'));
      btn.addEventListener('click', () => handlers.onSearch?.());
      container.appendChild(btn);
      out.searchButton = btn;
    }
    return out;
  }

  const field = el('label', 'search');
  field.appendChild(icon('i-search'));
  const input = el('input');
  input.type = 'search';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = COPY.searchPlaceholderPanel;
  input.setAttribute('aria-label', COPY.searchLabel);
  if (data.query) input.value = data.query;
  field.appendChild(input);
  container.appendChild(field);
  out.input = input;

  const toggle = button('toggle');
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', String(data.autoSync.on));
  toggle.title = data.autoSync.title ?? COPY.autoSyncTitle;
  toggle.appendChild(el('span', 'toggle__track'));
  toggle.append(COPY.autoSync);
  toggle.addEventListener('click', () => handlers.onToggleAutoSync?.());
  container.appendChild(toggle);
  out.toggle = toggle;
  return out;
}
