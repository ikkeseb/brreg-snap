// The action buttons under the ledger: «Åpne i sidepanel» (popup; a
// link so middle-click and keyboard still open the page, the click
// docks it) and «Kopier sammendrag» (buildSummary + writeClipboard
// inside the click, with the copy feedback).

import { COPY } from '../copy.js';
import { attachCopy, type CopyHandlers } from './copy-feedback.js';
import { button, el, icon } from './dom.js';

export interface ActionsData {
  // The panel link's href (keyboard / middle-click target); undefined
  // hides the button.
  panelHref?: string;
  // The text «Kopier sammendrag» puts on the clipboard.
  summary: string;
}

export interface ActionsHandlers extends CopyHandlers {
  // The click: dock the panel and close the popup. Receives the event
  // so it can preventDefault the link.
  onOpenPanel?: (ev: MouseEvent) => void;
}

export interface Actions {
  container: HTMLDivElement;
  openPanel?: HTMLAnchorElement;
  copySummary: HTMLButtonElement;
}

export function buildActions(data: ActionsData, handlers: ActionsHandlers): Actions {
  const container = el('div', 'actions');
  const out: Actions = { container, copySummary: button('btn') };

  if (data.panelHref) {
    const a = el('a', 'btn btn--primary');
    a.href = data.panelHref;
    a.appendChild(icon('i-panel'));
    a.append(COPY.openPanel);
    a.addEventListener('click', (ev) => handlers.onOpenPanel?.(ev));
    container.appendChild(a);
    out.openPanel = a;
  }

  const copy = out.copySummary;
  copy.appendChild(icon('i-summary', 'icon--copy'));
  copy.appendChild(icon('i-check', 'icon--done'));
  const label = el('span', undefined, COPY.copySummary);
  copy.appendChild(label);
  attachCopy(copy, () => data.summary, { done: COPY.summaryCopied, label }, handlers);
  container.appendChild(copy);
  return out;
}
