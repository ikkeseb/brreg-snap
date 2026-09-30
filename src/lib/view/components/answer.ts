// The answer: ONE headline in the tone of the most severe finding.
//   ok      quiet band with a seal, no support line
//   warn    firmer band, support line, the way out inside it
//   danger  the stamp: role="alert", no seal, the headline as plain
//           prose around the stamp word so a screen reader hears the
//           sentence («Nettstedet er ikke koblet til selskapet»)
// Plus the loading skeleton and the error band (always warn, never a
// stamp: a failed lookup says nothing about the company).

import { COPY } from '../copy.js';
import type { AnswerView } from '../trust-view.js';
import { button, el, glyph, icon, link, uniqueId } from './dom.js';

export interface AnswerHandlers {
  // «Feil bedrift? Velg en annen» / «Søk etter riktig selskap».
  onReject?: () => void;
}

export interface Answer {
  section: HTMLElement;
  // The <h2>, for focus after a user-initiated transition.
  heading: HTMLHeadingElement;
}

function section(tone: string): { section: HTMLElement; head: HTMLHeadingElement } {
  const sec = el('section', `answer answer--${tone}`);
  const head = el('h2', 'answer__head');
  head.id = uniqueId('answer');
  sec.setAttribute('aria-labelledby', head.id);
  return { section: sec, head };
}

export function buildAnswer(answer: AnswerView, handlers: AnswerHandlers = {}): Answer {
  const { section: sec, head } = section(answer.tone);
  if (answer.tone === 'danger') {
    sec.setAttribute('role', 'alert');
    const stamp = answer.stamp ?? { word: answer.headline };
    if (stamp.pre) {
      head.appendChild(el('span', 'stamp-pre', stamp.pre));
      head.append(' ');
    }
    const word = el('strong', 'stamp-word');
    word.appendChild(glyph('danger'));
    word.append(stamp.word);
    head.appendChild(word);
    if (stamp.rest) {
      head.append(' ');
      head.appendChild(el('span', 'stamp-rest', stamp.rest));
    }
  } else {
    const seal = el('span', 'answer__seal');
    seal.appendChild(glyph(answer.tone));
    sec.appendChild(seal);
    head.textContent = answer.headline;
  }
  sec.appendChild(head);

  if (answer.supporting) {
    sec.appendChild(buildSupport(answer.supporting));
  }
  if (answer.note) {
    sec.appendChild(el('p', 'answer__support answer__note', answer.note));
  }

  if (answer.actions.length > 0) {
    const actions = el('div', 'answer__actions');
    for (const action of answer.actions) {
      if (action.kind === 'goto') {
        actions.appendChild(
          link(action.text, action.href, { external: true, className: 'btn btn--sm btn--on-fill' }),
        );
        continue;
      }
      const btn =
        answer.tone === 'danger'
          ? button('text-btn text-btn--on-fill', action.text)
          : button('btn btn--tone', action.text);
      if (answer.tone !== 'danger') btn.appendChild(icon('i-chev'));
      btn.addEventListener('click', () => handlers.onReject?.());
      actions.appendChild(btn);
    }
    sec.appendChild(actions);
  }
  return { section: sec, heading: head };
}

// «Registrert hjemmeside er <b>nordvik.no</b>. …» / «Bostyrer: <b>Adv.
// Kari Nordmann</b>»: the name after the label is set in bold, the rest
// stays prose. Anything else is plain text.
function buildSupport(text: string): HTMLParagraphElement {
  const p = el('p', 'answer__support');
  const m =
    /^(Bostyrer: )(.+)$/s.exec(text) ??
    /^(Registrert hjemmeside er )([^\s.]+(?:\.[^\s.]+)*)(\.(?:\s.*)?)?$/s.exec(text);
  if (!m) {
    p.textContent = text;
    return p;
  }
  p.append(m[1] ?? '');
  p.appendChild(el('b', undefined, m[2] ?? ''));
  if (m[3]) p.append(m[3]);
  return p;
}

// The skeleton while loading: same geometry, shimmering values.
export function buildAnswerLoading(): HTMLElement {
  const sec = el('section', 'answer answer--loading');
  sec.setAttribute('aria-hidden', 'true');
  sec.appendChild(el('span', 'sk sk--seal'));
  sec.appendChild(el('span', 'sk sk--lead'));
  return sec;
}

export interface ErrorAnswer {
  head: string;
  support: string;
  // Whether asking again can change the answer.
  retry: boolean;
}

export interface ErrorHandlers {
  onRetry?: () => void;
}

// A calm warn band, never the stamp.
export function buildErrorAnswer(error: ErrorAnswer, handlers: ErrorHandlers = {}): Answer {
  const { section: sec, head } = section('warn');
  const seal = el('span', 'answer__seal');
  seal.appendChild(glyph('warn'));
  sec.appendChild(seal);
  head.textContent = error.head;
  sec.appendChild(head);
  sec.appendChild(el('p', 'answer__support', error.support));
  if (error.retry) {
    const actions = el('div', 'answer__actions');
    const btn = button('btn btn--sm btn--tone');
    btn.appendChild(icon('i-refresh'));
    btn.append(COPY.retry);
    btn.addEventListener('click', () => handlers.onRetry?.());
    actions.appendChild(btn);
    sec.appendChild(actions);
  }
  return { section: sec, heading: head };
}
