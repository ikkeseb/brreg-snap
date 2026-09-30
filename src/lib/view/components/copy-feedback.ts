// Copy feedback shared by every copy button (org.nr, «Kopier
// sammendrag»): the write happens inside the click (the gesture is what
// lets navigator.clipboard through without a permission), then the
// button shows the outcome for 1.4 s and the surface's live region says
// it. No floating toast (seat amendment a): the icon swaps to the check
// via .is-copied, and the button's own text or number carries the
// state. A refused write adds .is-failed and says so in the danger
// tone. Reduced-motion safe: the CSS transitions are the only motion,
// and they are off under prefers-reduced-motion.

import { COPY } from '../copy.js';

export const COPY_FEEDBACK_MS = 1400;

export interface CopyHandlers {
  // writeClipboard (src/lib/copy-orgnr.ts) in the product; a stub in
  // tests. Resolves false when the browser refused.
  copy(text: string): Promise<boolean>;
  announce(text: string): void;
}

export interface CopyFeedback {
  // Live-region text on success («Org.nr kopiert»).
  done: string;
  // The element whose text swaps to «Kopiert» / «Kunne ikke kopiere»
  // while the state shows; omitted for the org.nr button, whose number
  // stays and tints instead.
  label?: HTMLElement;
}

const timers = new WeakMap<HTMLElement, number>();

export function attachCopy(
  btn: HTMLElement,
  text: () => string,
  feedback: CopyFeedback,
  handlers: CopyHandlers,
): void {
  const original = feedback.label?.textContent ?? '';
  btn.addEventListener('click', () => {
    void run();
  });

  async function run(): Promise<void> {
    const ok = await handlers.copy(text());
    window.clearTimeout(timers.get(btn));
    btn.classList.remove('is-copied', 'is-failed');
    btn.classList.add(ok ? 'is-copied' : 'is-failed');
    if (feedback.label) feedback.label.textContent = ok ? COPY.copied : COPY.copyFailed;
    handlers.announce(ok ? feedback.done : COPY.copyFailedLive);
    timers.set(
      btn,
      window.setTimeout(() => {
        timers.delete(btn);
        btn.classList.remove('is-copied', 'is-failed');
        if (feedback.label) feedback.label.textContent = original;
      }, COPY_FEEDBACK_MS),
    );
  }
}
