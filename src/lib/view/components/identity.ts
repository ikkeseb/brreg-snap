// Identity block: over (form · city) OR eyebrow (provenance) · name ·
// org.nr line (copy button, optional meta, brreg.no link) · popup
// leaders line · avdeling note. The org.nr button copies the digits and
// shows the outcome (copy-feedback.ts).

import { COPY } from '../copy.js';
import type { IdentityView } from '../trust-view.js';
import { attachCopy, type CopyHandlers } from './copy-feedback.js';
import { button, el, icon, link } from './dom.js';

export interface Identity {
  // The <h1>, for focus after a user-initiated transition.
  heading: HTMLHeadingElement;
}

export function buildOrgnrButton(
  orgnr: { digits: string; spaced: string },
  handlers: CopyHandlers,
  small = false,
): HTMLButtonElement {
  const btn = button(small ? 'orgnr orgnr--sm' : 'orgnr');
  btn.setAttribute('aria-label', COPY.orgnrAria(orgnr.spaced));
  btn.title = COPY.orgnrTitle;
  btn.appendChild(el('span', 'orgnr__label', COPY.orgnrLabel));
  btn.appendChild(el('span', 'orgnr__num', orgnr.spaced));
  const icons = el('span', 'orgnr__icon');
  icons.appendChild(icon('i-copy', 'icon--copy'));
  icons.appendChild(icon('i-check', 'icon--done'));
  btn.appendChild(icons);
  attachCopy(btn, () => orgnr.digits, { done: COPY.orgnrCopied }, handlers);
  return btn;
}

export function renderIdentity(
  container: HTMLElement,
  identity: IdentityView,
  handlers: CopyHandlers,
): Identity {
  container.replaceChildren();
  container.classList.add('ident');

  if (identity.eyebrow) {
    const eyebrow = el('p', 'ident__eyebrow');
    eyebrow.appendChild(icon('i-link'));
    eyebrow.append(identity.eyebrow);
    container.appendChild(eyebrow);
  } else if (identity.over) {
    container.appendChild(el('p', 'ident__over', identity.over));
  }

  const heading = el('h1', identity.claim ? 'ident__name ident__name--claim' : 'ident__name');
  heading.textContent = identity.name;
  container.appendChild(heading);

  const line = el('p', 'ident__line');
  line.appendChild(buildOrgnrButton(identity.orgnr, handlers));
  if (identity.meta) line.appendChild(el('span', 'ident__meta', identity.meta));
  line.appendChild(link(COPY.brregLink, identity.brregUrl, { external: true }));
  container.appendChild(line);

  if (identity.leaders.length > 0) {
    const leaders = el('p', 'ident__leaders');
    for (const leader of identity.leaders) {
      const pair = el('span');
      pair.append(`${leader.label} `);
      pair.appendChild(el('b', undefined, leader.name));
      leaders.appendChild(pair);
    }
    container.appendChild(leaders);
  }

  if (identity.avdeling) {
    container.appendChild(el('p', 'ident__note', identity.avdeling));
  }

  return { heading };
}
