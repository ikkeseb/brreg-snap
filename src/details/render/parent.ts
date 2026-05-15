import { fetchEnhet } from '../../lib/brreg.js';
import { $ } from './dom.js';

const parentSection = $('parent');
const parentBody = $('parent-body');

export async function renderParent(parentOrgnr: string | undefined): Promise<void> {
  if (!parentOrgnr) {
    parentSection.hidden = true;
    return;
  }
  parentSection.hidden = false;
  parentBody.innerHTML = '';
  const link = document.createElement('a');
  link.href = `?orgnr=${parentOrgnr}`;
  link.textContent = `Org.nr ${parentOrgnr}`;
  parentBody.appendChild(link);

  try {
    const parent = await fetchEnhet(parentOrgnr);
    parentBody.innerHTML = '';
    const a = document.createElement('a');
    a.href = `?orgnr=${parentOrgnr}`;
    a.textContent = `${parent.navn} (${parentOrgnr})`;
    parentBody.appendChild(a);
  } catch {
    // Already rendered fallback link with just the orgnr.
  }
}
