import { buildOrgnrCopyButton } from '../../lib/copy-orgnr.js';
import type { Underenhet } from '../../types/brreg.js';
import { $, emptyLine } from './dom.js';

const underenheterSection = $('underenheter');
const underenheterBody = $('underenheter-body');

export function renderUnderenheter(items: Underenhet[]): void {
  underenheterSection.hidden = false;
  underenheterBody.innerHTML = '';

  if (items.length === 0) {
    underenheterBody.appendChild(emptyLine('Ingen registrerte underenheter.'));
    return;
  }

  const summary = document.createElement('p');
  summary.className = 'empty';
  summary.style.fontStyle = 'normal';
  summary.style.color = 'var(--muted)';
  summary.textContent = `${items.length} registrert${items.length === 1 ? '' : 'e'}.`;
  underenheterBody.appendChild(summary);

  const table = document.createElement('table');
  table.className = 'underenheter';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Navn</th><th>Org.nr</th><th>Sted</th></tr>';
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
