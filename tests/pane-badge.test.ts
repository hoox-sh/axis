/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pane badge chrome — name chip + script action buttons.
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import { mountPaneBadge } from '../src/chart/pane-badge';
import { setStore, addIndicator, removeIndicator, store } from '../src/store';

/** Tiny DOM tree that supports the methods mountPaneBadge uses. */
function makeHost() {
  const makeEl = (tag: string) => {
    const el: {
      tagName: string;
      className: string;
      textContent: string;
      title: string;
      type?: string;
      dataset: Record<string, string>;
      children: ReturnType<typeof makeEl>[];
      style: Record<string, string>;
      innerHTML: string;
      parent: unknown;
      appendChild: (c: ReturnType<typeof makeEl>) => ReturnType<typeof makeEl>;
      querySelector: (sel: string) => ReturnType<typeof makeEl> | null;
      querySelectorAll: (sel: string) => ReturnType<typeof makeEl>[];
      setAttribute: (k: string, v: string) => void;
      getAttribute: (k: string) => string | null;
      addEventListener: () => void;
      remove: () => void;
    } = {
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      title: '',
      dataset: {},
      children: [],
      style: {},
      innerHTML: '',
      parent: null,
      appendChild(c) {
        el.children.push(c);
        c.parent = el;
        return c;
      },
      querySelector(sel: string) {
        const match = (node: typeof el): typeof el | null => {
          if (sel.startsWith('.') && String(node.className).split(/\s+/).includes(sel.slice(1))) {
            return node;
          }
          if (sel.startsWith('[data-testid=') ) {
            const v = sel.match(/\[data-testid="([^"]+)"\]/)?.[1];
            if (v && node.dataset.testid === v) return node;
          }
          for (const ch of node.children) {
            const f = match(ch);
            if (f) return f;
          }
          return null;
        };
        return match(el);
      },
      querySelectorAll(sel: string) {
        const out: typeof el[] = [];
        const walk = (node: typeof el) => {
          if (sel.startsWith('.') && String(node.className).split(/\s+/).includes(sel.slice(1))) {
            out.push(node);
          }
          for (const ch of node.children) walk(ch);
        };
        walk(el);
        return out;
      },
      setAttribute(k, v) {
        if (k === 'data-testid') el.dataset.testid = v;
        if (k === 'aria-label') el.dataset.ariaLabel = v;
        if (k === 'type') el.type = v;
      },
      getAttribute(k) {
        if (k === 'data-testid') return el.dataset.testid || null;
        return null;
      },
      addEventListener() {},
      remove() {
        const p = el.parent as typeof el | null;
        if (p?.children) {
          p.children = p.children.filter((c) => c !== el);
        }
      },
    };
    return el;
  };

  const host = makeEl('div');
  // document.createElement polyfill for this test
  const prev = globalThis.document.createElement.bind(globalThis.document);
  (globalThis.document as { createElement: (t: string) => ReturnType<typeof makeEl> }).createElement = (
    tag: string,
  ) => {
    if (tag === 'div' || tag === 'span' || tag === 'button') return makeEl(tag);
    return prev(tag) as never;
  };
  return {
    host: host as unknown as HTMLElement,
    restore: () => {
      globalThis.document.createElement = prev;
    },
    findName: () => host.querySelector('.axis-pane-badge-name')?.textContent,
    countRoots: () => host.querySelectorAll('.axis-pane-badge-root').length,
    hasTestId: (id: string) => !!host.querySelector(`[data-testid="${id}"]`),
  };
}

beforeEach(() => {
  setStore('scripts', []);
});

describe('mountPaneBadge', () => {
  it('shows pane name without script actions when no scripts', () => {
    const { host, restore, findName } = makeHost();
    try {
      mountPaneBadge(host, 'volume', 'volume', 'Volume');
      expect(findName()).toBe('Volume');
    } finally {
      restore();
    }
  });

  it('renders settings / eye / re-run / remove for scripts on the pane', () => {
    const id = addIndicator('RSI', 'plot(close)', 'indicator', { plot: { color: '#fff' } });
    const { host, restore, findName, hasTestId } = makeHost();
    try {
      mountPaneBadge(host, 'indicator', 'indicator', 'RSI');
      expect(findName()).toBe('RSI');
      expect(hasTestId(`axis-pane-settings-${id}`)).toBe(true);
      expect(hasTestId(`axis-pane-eye-${id}`)).toBe(true);
      expect(hasTestId(`axis-pane-rerun-${id}`)).toBe(true);
      expect(hasTestId(`axis-pane-remove-${id}`)).toBe(true);
      expect(store.scripts.some((s) => s.id === id)).toBe(true);
    } finally {
      restore();
      removeIndicator(id);
    }
  });

  it('replaces previous badge root on remount', () => {
    const { host, restore, countRoots } = makeHost();
    try {
      mountPaneBadge(host, 'price', 'price', 'Price');
      mountPaneBadge(host, 'price', 'price', 'Price');
      expect(countRoots()).toBe(1);
    } finally {
      restore();
    }
  });
});
