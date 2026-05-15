// Shared DOM helpers used by the render/ modules. Module-scoped so
// details.ts can import the same $ for its top-level element lookups.

export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

export function addRow(
  dl: HTMLDListElement,
  label: string,
  value: string | undefined,
): void {
  if (!value) return;
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
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
