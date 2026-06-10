// "kilde: <host>" / "Synket fra <host>" footer label shared by popup
// and sidebar. Owns the current source host so callers stop carrying a
// parallel module-level variable.

export interface SourceLabel {
  set(host: string | undefined): void;
  get(): string | undefined;
}

export function createSourceLabel(
  containerEl: HTMLElement,
  hostEl: HTMLElement,
): SourceLabel {
  let current: string | undefined;
  return {
    set(host: string | undefined): void {
      current = host;
      if (!host) {
        containerEl.hidden = true;
        hostEl.textContent = '';
        return;
      }
      containerEl.hidden = false;
      hostEl.textContent = host;
    },
    get(): string | undefined {
      return current;
    },
  };
}
