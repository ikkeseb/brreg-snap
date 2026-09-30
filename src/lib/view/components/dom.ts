// DOM helpers for the view components: element factories, the sprite
// icons and the TextPart writer. Everything is built with createElement
// / createElementNS / textContent — ESLint bans the HTML sinks — and
// the icons reference the <symbol>s each page inlines once (icons.svg
// in popup.html / details.html).

import type { Tone } from '../../trust/types.js';
import type { TextPart } from '../trust-view.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(className: string, text?: string): HTMLButtonElement {
  const btn = el('button', className, text);
  btn.type = 'button';
  return btn;
}

// <svg class="…" aria-hidden="true"><use href="#id"/></svg>
export function svgUse(id: string, className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${id}`);
  // Firefox < 116 and older Chromium builds still read the xlink form.
  use.setAttributeNS(XLINK_NS, 'xlink:href', `#${id}`);
  svg.appendChild(use);
  return svg;
}

export function icon(id: string, extraClass = ''): SVGSVGElement {
  return svgUse(id, extraClass ? `icon ${extraClass}` : 'icon');
}

export const TONE_SYMBOL: Record<Tone, string> = {
  ok: 'g-ok',
  warn: 'g-warn',
  danger: 'g-danger',
  neutral: 'g-dot',
};

// The tone's shape (✓ ! ✕ ·): the first channel, colour is the second.
export function glyph(tone: Tone, extraClass = ''): SVGSVGElement {
  return svgUse(TONE_SYMBOL[tone], extraClass ? `glyph ${extraClass}` : 'glyph');
}

// Visually hidden text for screen readers.
export function srOnly(text: string): HTMLSpanElement {
  return el('span', 'sr-only', text);
}

// The «↗» after an external link's text, decorative.
export function externalArrow(): HTMLSpanElement {
  const arrow = el('span', undefined, ' ↗');
  arrow.setAttribute('aria-hidden', 'true');
  return arrow;
}

export interface LinkOptions {
  external?: boolean;
  className?: string;
  title?: string;
}

export function link(text: string, href: string, opts: LinkOptions = {}): HTMLAnchorElement {
  const a = el('a', opts.className ?? 'link', text);
  a.href = href;
  if (opts.title) a.title = opts.title;
  if (opts.external) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.appendChild(externalArrow());
  }
  return a;
}

// Writes TextParts into `container`: strong → <b>, negative → the
// danger colour, nowrap → kept on one line.
export function appendParts(container: HTMLElement, parts: readonly TextPart[]): void {
  for (const part of parts) {
    let node: HTMLElement | Text;
    if (part.strong) node = el('b', undefined, part.text);
    else if (part.negative || part.nowrap) node = el('span', undefined, part.text);
    else node = document.createTextNode(part.text);
    if (node instanceof HTMLElement) {
      if (part.negative) node.classList.add('num--neg');
      if (part.nowrap) node.classList.add('nw');
    }
    container.appendChild(node);
  }
}

// A stable id for aria-labelledby, unique per document.
let idCounter = 0;
export function uniqueId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}
