// Click-to-copy widget for orgnr digits, used in three places: popup
// result row, sidebar header, and the underenheter table. The button
// is the click target so the affordance is on the digits, not the
// surrounding label — and it stays keyboard-reachable.
//
// navigator.clipboard.writeText works in extension contexts without a
// `clipboardWrite` manifest permission as long as the call lives in a
// user-gesture stack (i.e. inside a click handler) — which it does.
export function buildOrgnrCopyButton(orgnr: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'orgnr-copy';
  btn.textContent = orgnr;
  btn.title = 'Klikk for å kopiere';
  btn.setAttribute('aria-label', `Kopier organisasjonsnummer ${orgnr}`);
  btn.addEventListener('click', () => {
    void copyOrgnr(orgnr, btn);
  });
  return btn;
}

// Populate a container with "Org.nr <button>digits</button>". Used in
// the popup row and sidebar header where the orgnr is presented with
// the label inline.
export function renderOrgnrCopy(
  container: HTMLElement,
  orgnr: string,
): void {
  container.textContent = '';
  container.append('Org.nr ');
  container.appendChild(buildOrgnrCopyButton(orgnr));
}

// One pending feedback reset per button. A second click inside the
// 1.5 s window re-arms that timer instead of stacking another, and the
// reset writes back `orgnr` — reading textContent then would capture
// "Kopiert!" and leave it stuck on the button.
const resetTimers = new WeakMap<HTMLElement, number>();

async function copyOrgnr(orgnr: string, btn: HTMLElement): Promise<void> {
  // Both outcomes get visible feedback — a silent failure reads as
  // "copied" to the user, who then pastes the wrong thing elsewhere.
  let ok = true;
  try {
    await navigator.clipboard.writeText(orgnr);
  } catch {
    ok = false;
  }
  window.clearTimeout(resetTimers.get(btn));
  btn.classList.remove('copied', 'copy-failed');
  btn.classList.add(ok ? 'copied' : 'copy-failed');
  btn.textContent = ok ? 'Kopiert!' : 'Kunne ikke kopiere';
  resetTimers.set(
    btn,
    window.setTimeout(() => {
      resetTimers.delete(btn);
      btn.textContent = orgnr;
      btn.classList.remove('copied', 'copy-failed');
    }, 1500),
  );
}
