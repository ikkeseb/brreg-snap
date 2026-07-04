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

async function copyOrgnr(orgnr: string, btn: HTMLElement): Promise<void> {
  // Both outcomes get visible feedback — a silent failure reads as
  // "copied" to the user, who then pastes the wrong thing elsewhere.
  let ok = true;
  try {
    await navigator.clipboard.writeText(orgnr);
  } catch {
    ok = false;
  }
  btn.classList.add(ok ? 'copied' : 'copy-failed');
  const original = btn.textContent ?? orgnr;
  btn.textContent = ok ? 'Kopiert!' : 'Kunne ikke kopiere';
  window.setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove('copied', 'copy-failed');
  }, 1500);
}
