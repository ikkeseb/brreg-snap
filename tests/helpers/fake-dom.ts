// Just enough of the DOM for the shared lib/ui components to run in
// node: element trees, textContent, attributes and event listeners.
// There is no DOM library in this repo's test setup; the components
// only build elements and listen for events, so a tree of plain
// objects is enough to assert what they paint and what a click does.
import { vi } from 'vitest';

type Listener = (ev: FakeEvent) => void;

export interface FakeEvent {
  key?: string;
  target?: unknown;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  defaultPrevented?: boolean;
  preventDefault(): void;
}

export function fakeEvent(init: Partial<FakeEvent> = {}): FakeEvent {
  const ev: FakeEvent = {
    defaultPrevented: false,
    preventDefault() {
      ev.defaultPrevented = true;
    },
    ...init,
  };
  return ev;
}

export class FakeElement {
  className = '';
  type = '';
  title = '';
  value = '';
  hidden = false;
  disabled = false;
  children: Array<FakeElement | string> = [];
  readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly tagName: string) {}

  get textContent(): string {
    return this.children
      .map((c) => (typeof c === 'string' ? c : c.textContent))
      .join('');
  }

  set textContent(text: string) {
    this.children = text ? [text] : [];
  }

  get childNodes(): Array<FakeElement | string> {
    return this.children;
  }

  appendChild<T extends FakeElement | string>(child: T): T {
    this.children.push(child);
    return child;
  }

  append(...children: Array<FakeElement | string>): void {
    this.children.push(...children);
  }

  replaceChildren(...children: Array<FakeElement | string>): void {
    this.children = [...children];
  }

  insertAdjacentElement(_where: string, el: FakeElement): FakeElement {
    return el;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  dispatch(type: string, ev: FakeEvent = fakeEvent({ target: this })): FakeEvent {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
    return ev;
  }

  click(): void {
    this.dispatch('click');
  }

  // Every descendant element with this class, in document order.
  findAll(className: string): FakeElement[] {
    const out: FakeElement[] = [];
    for (const child of this.children) {
      if (typeof child === 'string') continue;
      if (child.className.split(' ').includes(className)) out.push(child);
      out.push(...child.findAll(className));
    }
    return out;
  }
}

// Installs `document` (createElement + document-level listeners) and
// the element classes the components test with instanceof.
export function installFakeDom(): { document: FakeElement } {
  const doc = new FakeElement('#document');
  vi.stubGlobal('document', {
    createElement: (tag: string) => new FakeElement(tag),
    addEventListener: (type: string, fn: Listener) => doc.addEventListener(type, fn),
  });
  vi.stubGlobal('HTMLInputElement', class {});
  vi.stubGlobal('HTMLTextAreaElement', class {});
  return { document: doc };
}
