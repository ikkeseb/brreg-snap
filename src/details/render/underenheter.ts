import { buildOrgnrCopyButton } from '../../lib/copy-orgnr.js';
import { formatListCount } from '../../lib/format.js';
import type { UnderenheterPage } from '../../types/brreg.js';
import { $, emptyLine, emptyState } from './dom.js';

const underenheterSection = $('underenheter');
const underenheterBody = $('underenheter-body');

// undefined = the fetch failed. That must read as "couldn't check", not
// as the registry fact "none registered".
export function renderUnderenheter(page: UnderenheterPage | undefined): void {
  underenheterSection.hidden = false;
  underenheterBody.replaceChildren();

  if (!page) {
    underenheterBody.appendChild(
      emptyLine('Kunne ikke hente underenheter. Prøv igjen senere.'),
    );
    return;
  }
  const { items } = page;
  if (items.length === 0) {
    underenheterBody.appendChild(
      emptyState('Ingen registrerte underenheter.'),
    );
    return;
  }

  const summary = document.createElement('p');
  summary.className = 'empty';
  summary.style.fontStyle = 'normal';
  summary.style.color = 'var(--muted)';
  summary.textContent = formatListCount(items.length, page.total);
  underenheterBody.appendChild(summary);

  const table = document.createElement('table');
  table.className = 'underenheter';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['Navn', 'Org.nr', 'Sted']) {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const u of items) {
    const tr = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.textContent = u.navn;
    // Most underenheter are live; flag only the dissolved ones inline so
    // the table doesn't carry a near-empty Status column. A nedleggelses-
    // dato is brreg's marker that the sub-unit has been wound down.
    if (u.nedleggelsesdato) {
      const badge = document.createElement('span');
      badge.className = 'underenhet-status';
      badge.textContent = 'Nedlagt';
      badge.title = `Nedlagt ${u.nedleggelsesdato}`;
      nameCell.append(' ', badge);
    }
    tr.appendChild(nameCell);

    const orgnrCell = document.createElement('td');
    orgnrCell.className = 'orgnr-cell';
    orgnrCell.appendChild(buildOrgnrCopyButton(u.organisasjonsnummer));
    tr.appendChild(orgnrCell);

    const placeCell = document.createElement('td');
    placeCell.textContent =
      u.beliggenhetsadresse?.poststed ?? u.beliggenhetsadresse?.kommune ?? '';
    tr.appendChild(placeCell);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  underenheterBody.appendChild(table);
}
