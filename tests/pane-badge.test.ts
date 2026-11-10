/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pane badge chrome — name chip + script action buttons.
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import { mountPaneBadge, panePlotHost } from '../src/chart/pane-badge';
import { setStore, addIndicator, removeIndicator, setIndicatorSeries, store } from '../src/store';
import { paneStretchWeights } from '../src/chart/pane-manager';

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
      listeners: Record<string, Array<(ev: Event) => void>>;
      addEventListener: (type: string, fn: (ev: Event) => void) => void;
      dispatch: (type: string) => void;
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
      listeners: {} as Record<string, Array<(ev: Event) => void>>,
      addEventListener(type: string, fn: (ev: Event) => void) {
        const list = el.listeners[type] ?? [];
        list.push(fn);
        el.listeners[type] = list;
      },
      dispatch(type: string) {
        const ev = {
          type,
          stopPropagation() {},
          preventDefault() {},
        } as Event;
        for (const fn of el.listeners[type] ?? []) fn(ev);
      },
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
    button: (id: string) => host.querySelector(`[data-testid="${id}"]`),
  };
}

beforeEach(() => {
  setStore('scripts', []);
});

describe('pane stretch', () => {
  it('keeps every sub-pane at the minimum when the stack is tall enough', () => {
    // Price + volume + six indicators = 8 panes, the retest layout.
    const weights = paneStretchWeights(900, 7);
    expect(weights.sub).toBeGreaterThanOrEqual(72);
    expect(weights.price).toBeGreaterThan(120);
  });

  it('splits a short stack instead of crushing panes to the library floor', () => {
    const weights = paneStretchWeights(420, 7);
    expect(weights.sub).toBeGreaterThan(30);
    expect(weights.price + weights.sub * 7).toBeCloseTo(420, 5);
  });
});

describe('pane badge removal', () => {
  it('drops the script from the store when the trash control is released', async () => {
      const id = addIndicator('AXIS SMA', 'plot(close)', 'price', { plot: { color: '#fff' } });
    const { host, restore, button } = makeHost();
    try {
      mountPaneBadge(host, 'price', 'price', 'Price');
      const trash = button(`axis-pane-remove-${id}`) as { dispatch?: (type: string) => void } | null;
      expect(trash?.dispatch).toBeTypeOf('function');
      trash!.dispatch!('pointerdown');
      trash!.dispatch!('pointerup');
      for (let i = 0; i < 40 && store.scripts.some((s) => s.id === id); i++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(store.scripts.some((s) => s.id === id)).toBe(false);
      expect(store.scripts.length).toBe(0);
    } finally {
      restore();
      if (store.scripts.some((s) => s.id === id)) removeIndicator(id);
    }
  });
});

describe('panePlotHost', () => {
  it('uses the middle cell of a Lightweight Charts pane row', () => {
    const canvas = { tagName: 'CANVAS' };
    const left = { tagName: 'TD', children: [], querySelector: () => null };
    const plot = {
      tagName: 'TD',
      children: [canvas],
      querySelector: (sel: string) => (sel === 'canvas' ? canvas : null),
    };
    const right = { tagName: 'TD', children: [], querySelector: () => null };
    const row = { tagName: 'TR', children: [left, plot, right] };
    expect(panePlotHost(row as unknown as HTMLElement)).toBe(plot);
  });

  it('leaves a multi-chart pane div alone', () => {
    const div = { tagName: 'DIV', children: [] };
    expect(panePlotHost(div as unknown as HTMLElement)).toBe(div);
  });
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

  it('suppresses bare PRICE label on the price pane (slot badge owns title)', () => {
    const { host, restore, findName, countRoots } = makeHost();
    try {
      const root = mountPaneBadge(host, 'price', 'price', 'Price');
      expect(countRoots()).toBe(1);
      expect(findName()).toBeFalsy();
      expect(String(root.className)).toContain('is-empty');
      expect((root as unknown as { dataset: Record<string, string> }).dataset.paneType).toBe(
        'price',
      );
    } finally {
      restore();
    }
  });

  it('renders settings / source / eye / tables / re-run / remove for scripts on the pane', () => {
    const id = addIndicator('RSI', 'plot(close)', 'indicator', { plot: { color: '#fff' } });
    const { host, restore, findName, hasTestId } = makeHost();
    try {
      mountPaneBadge(host, 'indicator', 'indicator', 'RSI');
      expect(findName()).toBe('RSI');
      expect(hasTestId(`axis-pane-settings-${id}`)).toBe(true);
      expect(hasTestId(`axis-pane-source-${id}`)).toBe(true);
      expect(hasTestId(`axis-pane-eye-${id}`)).toBe(true);
      expect(hasTestId(`axis-pane-tables-${id}`)).toBe(true);
      expect(hasTestId(`axis-pane-rerun-${id}`)).toBe(true);
      expect(hasTestId(`axis-pane-remove-${id}`)).toBe(true);
      const btns = host.querySelectorAll('.axis-pane-badge-btn');
      expect(btns.map((b) => b.dataset.testid)).toEqual([
        `axis-pane-settings-${id}`,
        `axis-pane-source-${id}`,
        `axis-pane-eye-${id}`,
        `axis-pane-tables-${id}`,
        `axis-pane-rerun-${id}`,
        `axis-pane-remove-${id}`,
      ]);
      expect(store.scripts.some((s) => s.id === id)).toBe(true);
    } finally {
      restore();
      removeIndicator(id);
    }
  });

  it('shows the last computed value on the script chip', () => {
    const id = addIndicator('RSI', 'plot(close)', 'indicator', { plot: { color: '#fff' } });
    setIndicatorSeries(id, { name: 'RSI', series: { RSI: [40, 55.5] } });
    const { host, restore } = makeHost();
    try {
      mountPaneBadge(host, 'indicator', 'indicator', 'RSI');
      const values = host.querySelectorAll('.axis-pane-badge-value');
      expect(values.length).toBe(1);
      expect(values[0]?.textContent).toBe('55.50');
    } finally {
      restore();
      removeIndicator(id);
    }
  });

  it('shows overlay scripts on price without a PRICE chip', () => {
    const id = addIndicator('EMA', 'plot(close)', 'price', { plot: { color: '#fff' } });
    // Force paneId price (addIndicator may use type as pane)
    setStore('scripts', (list) =>
      list.map((s) => (s.id === id ? { ...s, paneId: 'price' } : s)),
    );
    const { host, restore, findName, hasTestId, countRoots } = makeHost();
    try {
      const root = mountPaneBadge(host, 'price', 'price', 'Price');
      expect(countRoots()).toBe(1);
      expect(findName()).toBe('EMA');
      expect(String(root.className)).not.toContain('is-empty');
      expect(hasTestId(`axis-pane-settings-${id}`)).toBe(true);
      // Only one name chip (script), not PRICE + script
      const names = host.querySelectorAll('.axis-pane-badge-name');
      expect(names.length).toBe(1);
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
