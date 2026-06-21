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
  // Explicit caution tone (data-sign='warn', amber). Applied only when the
  // sign path didn't already mark the cell red, so red always wins over
  // amber (e.g. negative equity stays red, thin-but-positive goes amber).
  tone?: 'warn';
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
  } else if (opts.tone === 'warn') {
    dd.dataset.sign = 'warn';
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

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(name: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// A "nothing registered here" placeholder: a quiet inline-SVG inbox glyph
// above the message. Built with createElementNS (no innerHTML / no remote
// asset) so it stays within the strict default-src 'self' CSP. The icon is
// aria-hidden; screen readers get the text only. Use for genuinely-empty
// lists (no roles / no underenheter / no regnskap), not for explanatory
// notes — those keep the plain emptyLine.
export function emptyState(text: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';

  const svg = svgEl('svg', {
    class: 'empty-icon',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.5',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  svg.appendChild(
    svgEl('path', {
      d: 'M22 12h-6l-2 3h-4l-2-3H2',
    }),
  );
  svg.appendChild(
    svgEl('path', {
      d: 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
    }),
  );
  wrap.appendChild(svg);

  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = text;
  wrap.appendChild(p);
  return wrap;
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
