import { fetchEnhet } from '../../lib/brreg.js';
import { $, makeNavLink } from './dom.js';

const parentSection = $('parent');
const parentBody = $('parent-body');

export async function renderParent(
  parentOrgnr: string | undefined,
  onNavigate: (orgnr: string) => void,
  // True once a newer load has superseded this one. This renderer is
  // the only one that does its own post-render async fetch, so it
  // escapes loadOrgnr's myRunId guard and must re-check it itself —
  // otherwise a slow parent fetch from a previous company clobbers the
  // current company's Morselskap card after an in-panel drill-in.
  isStale?: () => boolean,
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
    if (isStale?.()) return;
    parentBody.innerHTML = '';
    parentBody.appendChild(
      makeNavLink(parentOrgnr, `${parent.navn} (${parentOrgnr})`, onNavigate),
    );
  } catch {
    // Already rendered fallback link with just the orgnr.
  }
}
