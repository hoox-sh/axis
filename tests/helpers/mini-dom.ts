/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Small DOM for mounting Solid hyperscript in Bun tests.
 * Enough for `template()`, `cloneNode`, attributes, and `querySelector`.
 * Not a browser.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

class MiniStyle {
  private props = new Map<string, string>();
  setProperty(name: string, value: string) {
    this.props.set(name, String(value));
  }
  removeProperty(name: string) {
    this.props.delete(name);
  }
  getPropertyValue(name: string) {
    return this.props.get(name) ?? '';
  }
  set cssText(_value: string) {
    this.props.clear();
  }
  get cssText() {
    return '';
  }
}

class MiniClassList {
  private tokens = new Set<string>();
  constructor(private el: MiniElement) {}
  add(...xs: string[]) {
    for (const x of xs) if (x) this.tokens.add(x);
    this.flush();
  }
  remove(...xs: string[]) {
    for (const x of xs) this.tokens.delete(x);
    this.flush();
  }
  toggle(token: string, force?: boolean) {
    const on = force === undefined ? !this.tokens.has(token) : force;
    if (on) this.tokens.add(token);
    else this.tokens.delete(token);
    this.flush();
    return on;
  }
  contains(token: string) {
    return this.tokens.has(token);
  }
  resetFrom(value: string) {
    this.tokens = new Set(value.split(/\s+/).filter(Boolean));
  }
  private flush() {
    const value = [...this.tokens].join(' ');
    this.el.writeClass(value);
  }
}

class MiniNodeBase {
  nodeType = 1;
  parentNode: MiniNodeBase | null = null;
  childNodes: MiniNodeBase[] = [];
  ownerDocument: MiniDoc;
  namespaceURI: string | null = null;
  constructor(doc: MiniDoc) {
    this.ownerDocument = doc;
  }
  get nextSibling(): MiniNodeBase | null {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[i + 1] ?? null;
  }
  get previousSibling(): MiniNodeBase | null {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return i > 0 ? (this.parentNode.childNodes[i - 1] ?? null) : null;
  }
  get parentElement(): MiniElement | null {
    return this.parentNode instanceof MiniElement ? this.parentNode : null;
  }
  get firstChild(): MiniNodeBase | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): MiniNodeBase | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get isConnected(): boolean {
    let n: MiniNodeBase | null = this;
    const root = this.ownerDocument.documentElement;
    while (n) {
      if (n === root) return true;
      n = n.parentNode;
    }
    return false;
  }
  contains(other: MiniNodeBase | null): boolean {
    let n = other;
    while (n) {
      if (n === this) return true;
      n = n.parentNode;
    }
    return false;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  appendChild<T extends MiniNodeBase>(node: T): T {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  insertBefore<T extends MiniNodeBase>(node: T, ref: MiniNodeBase | null): T {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    if (!ref) {
      this.childNodes.push(node);
      return node;
    }
    const i = this.childNodes.indexOf(ref);
    if (i < 0) this.childNodes.push(node);
    else this.childNodes.splice(i, 0, node);
    return node;
  }
  removeChild<T extends MiniNodeBase>(node: T): T {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) this.childNodes.splice(i, 1);
    if (node.parentNode === this) node.parentNode = null;
    return node;
  }
  replaceChild<T extends MiniNodeBase>(node: MiniNodeBase, old: T): T {
    const i = this.childNodes.indexOf(old);
    if (node.parentNode) node.parentNode.removeChild(node);
    if (old.parentNode === this) old.parentNode = null;
    node.parentNode = this;
    if (i < 0) this.childNodes.push(node);
    else this.childNodes[i] = node;
    return old;
  }
  get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join('');
  }
  set textContent(value: string) {
    this.childNodes = [];
    if (value) this.appendChild(this.ownerDocument.createTextNode(value));
  }
  cloneNode(_deep?: boolean): MiniNodeBase {
    return this.ownerDocument.createTextNode('');
  }
}

class MiniText extends MiniNodeBase {
  nodeType = 3;
  nodeName = '#text';
  data: string;
  constructor(doc: MiniDoc, data: string) {
    super(doc);
    this.data = data;
  }
  override get textContent() {
    return this.data;
  }
  override set textContent(value: string) {
    this.data = value;
  }
  get nodeValue() {
    return this.data;
  }
  set nodeValue(value: string) {
    this.data = value;
  }
  override cloneNode(): MiniText {
    return this.ownerDocument.createTextNode(this.data);
  }
}

class MiniFragment extends MiniNodeBase {
  nodeType = 11;
  nodeName = '#document-fragment';
  override cloneNode(deep?: boolean): MiniFragment {
    const copy = new MiniFragment(this.ownerDocument);
    if (deep) {
      for (const child of this.childNodes) copy.appendChild(child.cloneNode(true));
    }
    return copy;
  }
}

class MiniElement extends MiniNodeBase {
  localName: string;
  tagName: string;
  nodeName: string;
  id = '';
  private classValue = '';
  style = new MiniStyle();
  classList: MiniClassList;
  value = '';
  checked = false;
  disabled = false;
  readOnly = false;
  selected = false;
  indeterminate = false;
  private attrs = new Map<string, string>();
  private listeners = new Map<string, Set<(ev: Event) => void>>();
  private fragment: MiniFragment | null = null;
  constructor(doc: MiniDoc, tag: string, ns: string | null = null) {
    super(doc);
    this.localName = tag.toLowerCase();
    this.tagName = ns ? tag : tag.toUpperCase();
    this.nodeName = this.tagName;
    this.namespaceURI = ns;
    this.classList = new MiniClassList(this);
  }
  get className() {
    return this.classValue;
  }
  set className(value: string) {
    const next = String(value ?? '');
    this.classList.resetFrom(next);
    this.writeClass(next);
  }
  /** ClassList writes the class attribute without rebuilding itself. */
  writeClass(value: string) {
    this.classValue = value;
    if (value) this.attrs.set('class', value);
    else this.attrs.delete('class');
  }
  get content(): MiniFragment {
    if (!this.fragment) this.fragment = new MiniFragment(this.ownerDocument);
    return this.fragment;
  }
  get dataset(): Record<string, string> {
    const el = this;
    return new Proxy({} as Record<string, string>, {
      set(_target, property, value) {
        if (typeof property !== 'string') return false;
        const key = property.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
        el.setAttribute(`data-${key}`, String(value));
        return true;
      },
      get(_target, property) {
        if (typeof property !== 'string') return undefined;
        const key = property.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
        return el.getAttribute(`data-${key}`) ?? undefined;
      },
    });
  }
  set innerHTML(html: string) {
    const target = this.localName === 'template' ? this.content : this;
    target.childNodes = [];
    parseHTML(this.ownerDocument, html, target, this.namespaceURI === SVG_NS);
  }
  get innerHTML() {
    return '';
  }
  setAttribute(name: string, value: string) {
    const v = String(value);
    if (name === 'class') {
      this.classList.resetFrom(v);
      this.writeClass(v);
      return;
    }
    this.attrs.set(name, v);
    if (name === 'id') this.id = v;
  }
  getAttribute(name: string) {
    if (name === 'class') return this.classValue || null;
    if (name === 'id') return this.id || this.attrs.get('id') || null;
    return this.attrs.get(name) ?? null;
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
    if (name === 'id') this.id = '';
    if (name === 'class') {
      this.classValue = '';
      this.classList.resetFrom('');
    }
  }
  hasAttribute(name: string) {
    return this.getAttribute(name) != null;
  }
  addEventListener(type: string, fn: (ev: Event) => void) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }
  removeEventListener(type: string, fn: (ev: Event) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatchEvent(ev: Event) {
    for (const fn of this.listeners.get(ev.type) ?? []) fn(ev);
    return true;
  }
  focus() {}
  click() {
    this.dispatchEvent({ type: 'click' } as Event);
  }
  getBoundingClientRect() {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  }
  querySelector(selector: string) {
    return queryAll(this, selector)[0] ?? null;
  }
  querySelectorAll(selector: string) {
    return queryAll(this, selector);
  }
  override cloneNode(deep?: boolean): MiniElement {
    const copy = this.namespaceURI
      ? this.ownerDocument.createElementNS(this.namespaceURI, this.localName)
      : this.ownerDocument.createElement(this.localName);
    for (const [name, value] of this.attrs) copy.setAttribute(name, value);
    if (this.classValue) copy.setAttribute('class', this.classValue);
    if (this.id) copy.setAttribute('id', this.id);
    copy.value = this.value;
    copy.checked = this.checked;
    copy.disabled = this.disabled;
    if (deep) {
      for (const child of this.childNodes) copy.appendChild(child.cloneNode(true));
    }
    return copy;
  }
}

class MiniSVGElement extends MiniElement {}

class MiniDoc {
  documentElement: MiniElement;
  body: MiniElement;
  head: MiniElement;
  defaultView: unknown;
  constructor() {
    this.documentElement = new MiniElement(this, 'html');
    this.head = new MiniElement(this, 'head');
    this.body = new MiniElement(this, 'body');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }
  createElement(tag: string, _options?: unknown): MiniElement {
    return new MiniElement(this, tag);
  }
  createElementNS(ns: string, tag: string): MiniElement {
    if (ns === SVG_NS) return new MiniSVGElement(this, tag, ns);
    return new MiniElement(this, tag, ns);
  }
  createTextNode(text: string): MiniText {
    return new MiniText(this, String(text));
  }
  createDocumentFragment(): MiniFragment {
    return new MiniFragment(this);
  }
  importNode(node: MiniNodeBase, deep?: boolean) {
    return node.cloneNode(deep);
  }
  getElementById(id: string): MiniElement | null {
    const walk = (n: MiniNodeBase): MiniElement | null => {
      if (n instanceof MiniElement && n.id === id) return n;
      for (const c of n.childNodes) {
        const hit = walk(c);
        if (hit) return hit;
      }
      return null;
    };
    return walk(this.documentElement);
  }
  querySelector(selector: string) {
    return queryAll(this.documentElement, selector)[0] ?? null;
  }
  querySelectorAll(selector: string) {
    return queryAll(this.documentElement, selector);
  }
  addEventListener(_type: string, _fn: (ev: Event) => void) {}
  removeEventListener(_type: string, _fn: (ev: Event) => void) {}
}

function parseHTML(doc: MiniDoc, html: string, parent: MiniNodeBase, svg: boolean) {
  const re = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z][\w:-]*)([^>]*?)(\/?)>|([^<]+)/g;
  const stack = [parent];
  const top = () => {
    const node = stack[stack.length - 1];
    if (!node) throw new Error('html stack empty');
    return node;
  };
  for (const m of html.matchAll(re)) {
    const text = m[5];
    if (text) {
      if (text.trim()) top().appendChild(doc.createTextNode(text));
      continue;
    }
    if (!m[2]) continue;
    if (m[1]) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const tag = m[2].toLowerCase();
    const isSvg = svg || tag === 'svg' || tag === 'path';
    const el = isSvg ? doc.createElementNS(SVG_NS, tag) : doc.createElement(tag);
    const attrRe = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
    const attrStr = m[3] || '';
    for (const a of attrStr.matchAll(attrRe)) {
      const name = a[1];
      if (!name) continue;
      el.setAttribute(name, a[2] ?? a[3] ?? a[4] ?? '');
    }
    top().appendChild(el);
    const voidish =
      m[4] === '/' || tag === 'path' || tag === 'br' || tag === 'img' || tag === 'input';
    if (!voidish) stack.push(el);
  }
}

function matchCompound(el: MiniElement, compound: string): boolean {
  let rest = compound.trim();
  if (!rest || rest === '*') return true;
  const tag = /^[a-zA-Z][\w-]*/.exec(rest);
  if (tag) {
    if (el.localName !== tag[0].toLowerCase()) return false;
    rest = rest.slice(tag[0].length);
  }
  if (rest.startsWith('#')) {
    const id = rest.slice(1).split(/[.[]/)[0] ?? '';
    if (el.id !== id) return false;
  }
  const attrs = rest.matchAll(/\[([^\]=]+)(?:=["']?([^"'\]]*)["']?)?\]/g);
  for (const attr of attrs) {
    const name = attr[1];
    if (!name) return false;
    if (attr[2] === undefined) {
      if (!el.hasAttribute(name)) return false;
    } else if (el.getAttribute(name) !== attr[2]) return false;
  }
  return true;
}

function matchesChain(el: MiniElement, parts: string[]): boolean {
  const last = parts[parts.length - 1];
  if (!last || !matchCompound(el, last)) return false;
  let parent = el.parentElement;
  for (let i = parts.length - 2; i >= 0; i--) {
    const part = parts[i];
    if (!part) return false;
    while (parent && !matchCompound(parent, part)) parent = parent.parentElement;
    if (!parent) return false;
    parent = parent.parentElement;
  }
  return true;
}

function queryAll(root: MiniNodeBase, selector: string): MiniElement[] {
  const groups = selector
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const out: MiniElement[] = [];
  const walk = (n: MiniNodeBase) => {
    if (n instanceof MiniElement && n !== root) {
      if (groups.some((g) => matchesChain(n, g.split(/\s+/)))) out.push(n);
    }
    for (const c of n.childNodes) walk(c);
  };
  walk(root);
  return out;
}

/** Install document/window globals. Call before importing a component. */
export function installMiniDom(): MiniDoc {
  const doc = new MiniDoc();
  const g = globalThis as unknown as Record<string, unknown>;
  g.Element = MiniElement;
  g.HTMLElement = MiniElement;
  g.SVGElement = MiniSVGElement;
  g.Node = MiniNodeBase;
  g.Text = MiniText;
  g.DocumentFragment = MiniFragment;
  g.HTMLInputElement = class extends MiniElement {};
  g.HTMLButtonElement = class extends MiniElement {};
  g.HTMLTemplateElement = class extends MiniElement {};
  const window = {
    document: doc,
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    matchMedia: () => ({
      matches: false,
      media: '',
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    getComputedStyle: () => ({ getPropertyValue: () => '', position: 'static' }),
    requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    location: { href: 'http://localhost/', origin: 'http://localhost' },
    navigator: { userAgent: 'mini-dom' },
  };
  doc.defaultView = window;
  g.window = window;
  g.document = doc;
  g.Node = MiniNodeBase;
  const store = new Map<string, string>();
  g.localStorage = {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
  return doc;
}

export type { MiniElement };
