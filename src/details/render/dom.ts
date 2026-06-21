// Shared DOM helpers used by the render/ modules. Module-scoped so
// details.ts can import the same $ for its top-level element lookups.

export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

export interface AddRowOptions {
  // When provided, a negative number tags the value cell with
  // data-sign='neg' so CSS can color losses / negative equity red.
  // Positives are left unstyled to avoid a noisy all-green column.
  sign?: number;
}

export function addRow(
  dl: HTMLDListElement,
  label: string,
  value: string | undefined,
  opts: AddRowOptions = {},
): void {
  if (!value) return;
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  if (typeof opts.sign === 'number' && opts.sign < 0) {
    dd.dataset.sign = 'neg';
  }
  dl.append(dt, dd);
}

export function addLink(
  dl: HTMLDListElement,
  label: string,
  href: string,
  text: string,
  external = false,
): void {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  if (external) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  dd.appendChild(a);
  dl.append(dt, dd);
}

export function emptyLine(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = text;
  return p;
}

// Same-document orgnr link for in-panel drill-in (parent enhet, a
// company role-holder). A plain left-click is intercepted and routed to
// onNavigate (pushState + re-render in place); cmd/ctrl/shift-click is
// left alone so power users can still branch by opening the details
// page fresh. Middle-click fires 'auxclick', not 'click', so it also
// falls through to the default. The href keeps the panel useful without
// JS and gives the link a real target for those modified opens.
export function makeNavLink(
  orgnr: string,
  text: string,
  onNavigate: (orgnr: string) => void,
): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = `?orgnr=${orgnr}`;
  a.textContent = text;
  a.addEventListener('click', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    onNavigate(orgnr);
  });
  return a;
}
