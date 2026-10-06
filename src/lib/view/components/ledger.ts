// The ledger: the signals as a compact, scannable list.
// <dl class="ledger"><div class="ledger-row" data-tone="ok">
//   <dt><svg class="glyph"/>Kobling<span class="sr-only">, ok</span></dt>
//   <dd>value <span class="ledger-row__aux">· stiftet 1972</span>
//       <span class="ledger-row__detail">…</span></dd></div>
// Tone is never colour alone: the glyph shape and the sr-only text
// carry it. For a spoof, the caption + facts line replace the
// company's rows (buildFacts).

import { COPY } from '../copy.js';
import type { LedgerRow, RowAction, TextPart } from '../trust-view.js';
import { appendParts, button, el, glyph, link, srOnly } from './dom.js';

export interface LedgerHandlers {
  onReject?: () => void;
  onForget?: () => void;
  // «Rapporter feil treff» is a mailto link, never a fetch.
  reportHref?: string;
}

function buildAction(action: RowAction, handlers: LedgerHandlers): HTMLElement | undefined {
  switch (action.kind) {
    case 'reject': {
      const btn = button('text-btn', COPY.reject);
      btn.addEventListener('click', () => handlers.onReject?.());
      return btn;
    }
    case 'forget': {
      const btn = button('text-btn', COPY.forget);
      btn.addEventListener('click', () => handlers.onForget?.());
      return btn;
    }
    case 'report':
      return handlers.reportHref ? link(COPY.report, handlers.reportHref) : undefined;
    case 'link':
      return link(action.text, action.href, { external: true });
    default:
      return undefined;
  }
}

export function buildLedgerRow(row: LedgerRow, handlers: LedgerHandlers = {}): HTMLDivElement {
  const div = el('div', 'ledger-row');
  div.dataset.tone = row.tone;
  div.dataset.key = row.key;
  if (row.inline) div.classList.add('ledger-row--inline');
  if (row.dangerValue) div.classList.add('ledger-row--danger-value');

  const dt = el('dt');
  dt.appendChild(glyph(row.tone));
  dt.append(row.label);
  const sr = COPY.toneSr[row.tone];
  if (sr) dt.appendChild(srOnly(sr));
  div.appendChild(dt);

  const dd = el('dd');
  // The value (and its aux) is one node, so an inline row can lay the
  // value and its action out as flex items: when the action wraps it
  // starts flush with the value, never after a stray space or margin.
  const value = el('span', 'ledger-row__value', row.value);
  if (row.aux) {
    value.append(' ');
    value.appendChild(el('span', 'ledger-row__aux', row.aux));
  }
  dd.appendChild(value);
  const actions = row.actions
    .map((a) => buildAction(a, handlers))
    .filter((a): a is HTMLElement => a !== undefined);
  const hasDetail = row.detail !== undefined || row.figures !== undefined || actions.length > 0;
  if (hasDetail) {
    if (!row.inline) dd.append(' ');
    const detail = el('span', 'ledger-row__detail');
    if (row.detail) detail.appendChild(el('span', 'ledger-row__note', row.detail));
    if (row.figures) {
      row.figures.forEach((group, i) => {
        if (i > 0 || row.detail) detail.append(' · ');
        appendParts(detail, group);
      });
    }
    if (actions.length > 0) {
      // On an inline row the first action sits on the value line; any
      // further ones (and every action under a detail text) get their
      // own line so the row reads value → detail → way out.
      const inlineFirst = row.inline && !row.detail && !row.figures;
      actions.forEach((action, i) => {
        if (inlineFirst && i === 0) {
          detail.appendChild(action);
          return;
        }
        const act = el('span', 'ledger-row__act');
        act.appendChild(action);
        detail.appendChild(act);
      });
    }
    dd.appendChild(detail);
  }
  div.appendChild(dd);
  return div;
}

export function buildLedger(rows: readonly LedgerRow[], handlers: LedgerHandlers = {}): HTMLDListElement {
  const dl = el('dl', 'ledger');
  for (const row of rows) dl.appendChild(buildLedgerRow(row, handlers));
  return dl;
}

// Spoof: «Om selskapet — sier ingenting om dette nettstedet» + one
// prose line of the company's own facts, no glyphs, no tone.
export function buildFacts(facts: readonly TextPart[]): [HTMLParagraphElement, HTMLParagraphElement] {
  const cap = el('p', 'ledger-cap', COPY.aboutCompany);
  cap.append(' ');
  cap.appendChild(el('span', undefined, COPY.aboutCompanyNote));
  const line = el('p', 'facts');
  appendParts(line, facts);
  return [cap, line];
}
