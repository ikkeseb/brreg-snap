// The surface's one permanent sr-only live region, and the focus helper.
//
// Both surfaces keep exactly one <p class="sr-only" aria-live="polite">
// for the whole document (SPEC root) and route every announcement
// through it: copy feedback, load progress, search result counts. A
// second live region would make screen readers race.
//
// Focus moves only on user-initiated transitions (a pick, a search, a
// retry): the controller calls focusElement on the result heading or
// the first picker row. Background repaints never call it.

export interface LiveRegion {
  readonly el: HTMLElement;
  // An arrow, so it can be passed around unbound.
  readonly announce: (text: string) => void;
}

// Wrap a region that already exists in the page (popup.html ships one
// so it is present before any script runs).
export function liveRegionOf(region: HTMLElement): LiveRegion {
  return {
    el: region,
    announce: (text: string): void => {
      // Clearing first makes a repeated message (two copies in a row)
      // announce again; the write lands in the next task.
      region.textContent = '';
      if (!text) return;
      setTimeout(() => {
        region.textContent = text;
      }, 0);
    },
  };
}

// Focus an element that is not natively focusable (a heading, a row
// container): tabindex="-1" keeps it out of the tab order while letting
// it take focus, and preventScroll keeps the popup from jumping.
export function focusElement(target: Element | null | undefined): void {
  if (!(target instanceof HTMLElement)) return;
  if (!target.hasAttribute('tabindex') && !isNativelyFocusable(target)) {
    target.setAttribute('tabindex', '-1');
  }
  target.focus({ preventScroll: true });
}

function isNativelyFocusable(el: HTMLElement): boolean {
  return (
    el instanceof HTMLButtonElement ||
    el instanceof HTMLInputElement ||
    el instanceof HTMLAnchorElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  );
}
