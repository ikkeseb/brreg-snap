import { fetchEnhet } from '../../lib/brreg.js';
import { $, makeNavLink } from './dom.js';

const parentSection = $('parent');
const parentBody = $('parent-body');

export async function renderParent(
  parentOrgnr: string | undefined,
  onNavigate: (orgnr: string) => void,
): Promise<void> {
  if (!parentOrgnr) {
    parentSection.hidden = true;
    return;
  }
  parentSection.hidden = false;
  parentBody.innerHTML = '';
  // Show the orgnr immediately; upgrade to the name once it resolves.
  parentBody.appendChild(
    makeNavLink(parentOrgnr, `Org.nr ${parentOrgnr}`, onNavigate),
  );

  try {
    const parent = await fetchEnhet(parentOrgnr);
    parentBody.innerHTML = '';
    parentBody.appendChild(
      makeNavLink(parentOrgnr, `${parent.navn} (${parentOrgnr})`, onNavigate),
    );
  } catch {
    // Already rendered fallback link with just the orgnr.
  }
}
