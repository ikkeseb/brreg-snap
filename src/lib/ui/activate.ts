// Make a non-button element behave like a button for keyboard users.
// The manual-search results and the recents list are clickable <li>s
// (not real buttons), so without this they answer to the mouse and to
// Enter, but Space — which users expect to activate a button — does
// nothing and instead scrolls the page. This wires role=button +
// tabindex + click + Enter/Space so the rows are fully operable from
// the keyboard. The picker already uses real <button>s and doesn't
// need it.
export function makeActivable(el: HTMLElement, activate: () => void): void {
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.addEventListener('click', activate);
  el.addEventListener('keydown', (ev) => {
    // 'Spacebar' is the legacy key name some engines still emit.
    if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
      ev.preventDefault();
      activate();
    }
  });
}
