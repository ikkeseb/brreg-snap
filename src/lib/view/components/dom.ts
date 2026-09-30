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

// A section head: <h3 class="section__head">Label<span class="tab__count">N</span>
export function sectionHead(label: string, count?: number | string): HTMLHeadingElement {
  const head = el('h3', 'section__head', label);
  if (count !== undefined) head.appendChild(el('span', 'tab__count', String(count)));
  return head;
}

export function section(label: string, count?: number | string): HTMLElement {
  const sec = el('section', 'section');
  sec.appendChild(sectionHead(label, count));
  return sec;
}

// Amendment c: a branch or subsidiary named after its parent («NORDVIK
// ENERGI ASA AVD FORUS», «EQUINOR ALGERIA AS» under «EQUINOR ASA») —
// the shared prefix is written in a quieter span so the distinguishing
// part reads first. The prefix is the parent's full name or its base
// name (the name minus a legal-form suffix), matched as whole words at
// the start and never the whole name. The text stays the full name;
// only the shape of the nodes changes.
const LEGAL_FORMS = new Set([
  'AS', 'ASA', 'SA', 'DA', 'ANS', 'BA', 'NUF', 'KS', 'SE', 'IKS', 'BBL', 'SF', 'AL', 'ENK', 'FKF', 'KF', 'STI', 'SPA',
]);

export function baseName(name: string): string {
  const words = name.trim().split(/\s+/);
  const last = words[words.length - 1]?.toUpperCase();
  return words.length > 1 && last && LEGAL_FORMS.has(last) ? words.slice(0, -1).join(' ') : name.trim();
}

// What is left after the prefix must say something of its own: at
// least one word that is not a legal form («EQUINOR AS» under «EQUINOR
// ASA» keeps its whole name).
function distinguishes(rest: string): boolean {
  return rest.split(/\s+/).some((w) => w !== '' && !LEGAL_FORMS.has(w.toUpperCase()));
}

function mutedPrefix(name: string, parentName: string | undefined): string | undefined {
  const parent = parentName?.trim();
  if (!parent) return undefined;
  const upper = name.toUpperCase();
  for (const candidate of [parent, baseName(parent)]) {
    const cut = candidate.length + 1;
    if (upper.startsWith(`${candidate.toUpperCase()} `) && distinguishes(name.slice(cut))) {
      return name.slice(0, cut);
    }
  }
  return undefined;
}

export function appendName(container: HTMLElement, name: string, parentName?: string): void {
  const prefix = mutedPrefix(name, parentName);
  if (prefix) {
    container.appendChild(el('span', 'name-prefix', prefix));
    container.append(name.slice(prefix.length));
    return;
  }
  container.append(name);
}
