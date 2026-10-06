// Merknader + «Endret nylig» (panel Oversikt, after the ledger): the
// registry's own annotation quoted verbatim with its date, then the
// recent changes as a dated list. A merknad is a thing to notice (warn
// tone); changes are neutral information and never raise the tone
// (docs/notes/trust.md § answer-priority).
//   <div class="notes" data-tone="warn">  (neutral without a merknad)
//     <figure class="merknad"><figcaption class="note-head">…</figcaption>
//       <blockquote class="quote"><p>…</p></blockquote>
//       <p class="quote__date">Innført <time>…</time></p></figure>
//     <section><h3 class="note-head">Endret nylig</h3>
//       <ul class="changes"><li><time>…</time><span><b>…</b><br>…</span></li>
//       <p class="section__text">Endringer kunne ikke hentes.</p>  (feed failed)

import { COPY } from '../copy.js';
import type { EndringView, MerknadView } from '../trust-view.js';
import { el, glyph } from './dom.js';

export function buildNotes(
  merknader: readonly MerknadView[],
  endringer: readonly EndringView[],
  // The change feed couldn't be fetched: «Endret nylig» says so rather
  // than reading as «nothing changed».
  endringerFailed = false,
): HTMLDivElement | undefined {
  if (merknader.length === 0 && endringer.length === 0 && !endringerFailed) return undefined;
  const notes = el('div', 'notes');
  notes.dataset.tone = merknader.length > 0 ? 'warn' : 'neutral';

  for (const m of merknader) {
    const fig = el('figure', 'merknad');
    const cap = el('figcaption', 'note-head');
    cap.appendChild(glyph('warn'));
    cap.append(COPY.merknadHead(1));
    fig.appendChild(cap);
    const quote = el('blockquote', 'quote');
    quote.appendChild(el('p', undefined, m.text));
    fig.appendChild(quote);
    if (m.since) {
      const date = el('p', 'quote__date', COPY.innfort);
      const time = el('time', undefined, m.since.text);
      time.dateTime = m.since.iso;
      date.appendChild(time);
      fig.appendChild(date);
    }
    notes.appendChild(fig);
  }

  if (endringer.length > 0 || endringerFailed) {
    const sec = el('section');
    const head = el('h3', 'note-head');
    head.appendChild(glyph('neutral'));
    head.append(COPY.endretNylig);
    sec.appendChild(head);
    if (endringerFailed) sec.appendChild(el('p', 'section__text', COPY.endringerFailed));
    const list = el('ul', 'changes');
    for (const e of endringer) {
      const li = el('li');
      const time = el('time', undefined, e.date);
      time.dateTime = e.iso;
      li.appendChild(time);
      const text = el('span');
      text.appendChild(el('b', undefined, e.title));
      if (e.sub) {
        text.appendChild(el('br'));
        text.append(e.sub);
      }
      li.appendChild(text);
      list.appendChild(li);
    }
    if (endringer.length > 0) sec.appendChild(list);
    notes.appendChild(sec);
  }
  return notes;
}
