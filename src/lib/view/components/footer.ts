// Footer: freshness («Hentet for 2 min siden · Oppdater»), «Rapporter
// feil treff» (a mailto link) and the NLOD attribution — a licence
// condition, so it stays visible (sticky in the popup).
// <footer class="foot"> is the container; the caller owns it.

import { formatRelativeTime } from '../../format.js';
import { COPY } from '../copy.js';
import { button, el, link } from './dom.js';

export interface FooterData {
  // When the data on screen was fetched; undefined = no freshness row.
  fetchedAt?: number;
  now?: number;
  // «Henter …» while loading.
  loading?: boolean;
  // The mailto for «Rapporter feil treff»; undefined hides it.
  reportHref?: string;
}

export interface FooterHandlers {
  onRefresh?: () => void;
}

export function renderFooter(
  container: HTMLElement,
  data: FooterData,
  handlers: FooterHandlers = {},
): void {
  container.replaceChildren();
  const report = data.reportHref ? link(COPY.report, data.reportHref, { className: '' }) : undefined;

  if (data.loading || data.fetchedAt !== undefined) {
    const row = el('div', 'foot__row');
    const left = el('span');
    if (data.loading) {
      left.textContent = COPY.loadingFoot;
    } else if (data.fetchedAt !== undefined) {
      left.append(`${COPY.fetched(formatRelativeTime(data.fetchedAt, data.now ?? Date.now()))} · `);
      const refresh = button('', COPY.refresh);
      refresh.title = COPY.refreshTitle;
      refresh.addEventListener('click', () => handlers.onRefresh?.());
      left.appendChild(refresh);
    }
    row.appendChild(left);
    if (report) row.appendChild(report);
    container.appendChild(row);
  }

  const attribution = el('div', 'foot__row');
  const line = el('span');
  line.append(COPY.attributionPre);
  line.appendChild(
    link(COPY.attributionLink, COPY.nlodUrl, { className: '', title: COPY.attributionTitle }),
  );
  line.append(COPY.attributionPost);
  attribution.appendChild(line);
  // With no freshness row the report link shares the attribution row.
  if (report && !(data.loading || data.fetchedAt !== undefined)) attribution.appendChild(report);
  container.appendChild(attribution);
}
