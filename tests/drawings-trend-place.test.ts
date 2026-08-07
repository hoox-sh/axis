/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Trendline placement: two successive lines + same-tool re-apply must not wipe
 * an in-progress draft (ChartHost store effect re-pushes the active tool).
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { DrawingLayer } from '../src/chart/drawing-layer.ts';
import type { Drawing } from '../src/chart/drawing-types.ts';

/** Extend the AXIS document stub with SVG + event APIs DrawingLayer needs. */
function ensureSvgDom() {
  const doc = document as unknown as {
    createElementNS?: (ns: string, name: string) => ReturnType<typeof document.createElement>;
    createElement: (tag: string) => HTMLElement;
  };
  if (typeof doc.createElementNS !== 'function') {
    doc.createElementNS = (_ns: string, name: string) => {
      const el = document.createElement(name) as HTMLElement & {
        childNodes?: unknown[];
        replaceChildren?: (...nodes: unknown[]) => void;
        setAttribute: (k: string, v: string) => void;
        appendChild: (c: unknown) => unknown;
        textContent?: string;
      };
      // Fake NodeList for replaceChildren / paint
      const kids: unknown[] = [];
      Object.defineProperty(el, 'childNodes', {
        get: () => kids,
        configurable: true,
      });
      el.appendChild = (c: unknown) => {
        kids.push(c);
        return c;
      };
      el.replaceChildren = (...nodes: unknown[]) => {
        kids.length = 0;
        kids.push(...nodes);
      };
      return el as unknown as ReturnType<typeof document.createElement>;
    };
  }
  if (typeof (globalThis as { MouseEvent?: unknown }).MouseEvent !== 'function') {
    (globalThis as { MouseEvent: unknown }).MouseEvent = class MouseEvent {
      type: string;
      clientX: number;
      clientY: number;
      bubbles: boolean;
      constructor(type: string, init?: { clientX?: number; clientY?: number; bubbles?: boolean }) {
        this.type = type;
        this.clientX = init?.clientX ?? 0;
        this.clientY = init?.clientY ?? 0;
        this.bubbles = !!init?.bubbles;
      }
      preventDefault() {}
      stopPropagation() {}
    };
  }
  // DrawingLayer binds pointermove/up on window
  const w = globalThis as unknown as {
    window?: {
      addEventListener?: (t: string, fn: (...a: unknown[]) => void) => void;
      removeEventListener?: (t: string, fn: (...a: unknown[]) => void) => void;
      innerWidth?: number;
    };
    addEventListener?: (t: string, fn: (...a: unknown[]) => void) => void;
    removeEventListener?: (t: string, fn: (...a: unknown[]) => void) => void;
  };
  const noopListen = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  if (!w.window || typeof w.window.addEventListener !== 'function') {
    w.window = {
      ...(w.window || { innerWidth: 1280 }),
      ...noopListen,
    };
  }
  if (typeof w.addEventListener !== 'function') {
    w.addEventListener = noopListen.addEventListener;
    w.removeEventListener = noopListen.removeEventListener;
  }
}

function mockChart() {
  return {
    timeScale: () => ({
      timeToCoordinate: (t: number) => t * 10,
      coordinateToTime: (x: number) => x / 10,
      coordinateToLogical: (x: number) => x / 10,
      logicalToCoordinate: (l: number) => l * 10,
      options: () => ({ rightOffset: 10 }),
      applyOptions: () => {},
      subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {},
    }),
  };
}

function mockSeries() {
  return {
    priceToCoordinate: (p: number) => 1000 - p,
    coordinateToPrice: (y: number) => 1000 - y,
  };
}

function fireClick(layer: DrawingLayer, clientX: number, clientY: number) {
  // Prefer direct private handle via event on svg
  const svg = (layer as unknown as { svg: HTMLElement & {
    listeners?: Map<string, Set<(e: unknown) => void>>;
    getBoundingClientRect: () => DOMRect;
  } }).svg;
  svg.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 800,
      height: 400,
      right: 800,
      bottom: 400,
      toJSON: () => ({}),
    }) as DOMRect;

  const ev = new MouseEvent('click', { clientX, clientY, bubbles: true });
  // FakeEl stores listeners on the element
  const listeners = (svg as unknown as { listeners?: Map<string, Set<(e: unknown) => void>> })
    .listeners;
  if (listeners?.get('click')) {
    for (const fn of listeners.get('click')!) fn(ev);
  } else {
    // Fallback: call through public surface by re-dispatch if available
    (svg as unknown as { dispatchEvent?: (e: unknown) => void }).dispatchEvent?.(ev);
  }
}

describe('trendline placement (two lines + draft preserve)', () => {
  let host: HTMLElement;
  let layer: DrawingLayer;
  let emitted: Drawing[][];

  beforeEach(() => {
    ensureSvgDom();
    host = document.createElement('div');
    (host as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: 800,
        height: 400,
        right: 800,
        bottom: 400,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(host);
    layer = new DrawingLayer(host, mockChart() as never, mockSeries() as never);
    layer.setStayInMode(true);
    emitted = [];
    layer.setOnChange((list) => {
      emitted.push(list.slice());
    });
  });

  afterEach(() => {
    try {
      layer?.destroy();
    } catch {
      /* ignore */
    }
    try {
      host?.remove();
    } catch {
      /* ignore */
    }
  });

  it('places two successive trendlines with stay-in-mode', () => {
    layer.setTool('trend');

    // Line 1: client x=t*10, y=1000-p  → (t=1,p=100) then (t=5,p=200)
    fireClick(layer, 10, 900);
    fireClick(layer, 50, 800);

    expect(layer.getDrawings()).toHaveLength(1);
    expect(layer.getDrawings()[0]!.kind).toBe('trend');

    // Same-tool re-apply (simulates ChartHost store effect) must NOT clear draft
    layer.setTool('trend');
    fireClick(layer, 100, 700); // first anchor of line 2
    layer.setTool('trend'); // re-push same tool mid-draft
    fireClick(layer, 150, 600); // second anchor

    const all = layer.getDrawings();
    expect(all).toHaveLength(2);
    expect(all.every((d) => d.kind === 'trend')).toBe(true);
    expect(all[0]!.id).not.toBe(all[1]!.id);
    for (const d of all) {
      const t = d as {
        p1: { time: number; price: number };
        p2: { time: number; price: number };
        points?: PointLike[];
      };
      expect(t.p1.time).not.toBe(t.p2.time);
      expect(t.points?.length ?? 2).toBeGreaterThanOrEqual(2);
    }
    expect(emitted.at(-1)?.length).toBe(2);
  });

  it('setTool same id without force preserves draft; force clears it', () => {
    layer.setTool('trend');
    fireClick(layer, 10, 900);
    expect(layer.getDrawings()).toHaveLength(0);

    layer.setTool('trend'); // no-op — draft kept
    fireClick(layer, 50, 800);
    expect(layer.getDrawings()).toHaveLength(1);

    layer.setTool('trend');
    fireClick(layer, 20, 850);
    layer.setTool('trend', { force: true }); // explicit rail re-pick cancels draft
    fireClick(layer, 80, 750);
    // force cleared draft; this click started a new 1-pt draft — not committed
    expect(layer.getDrawings()).toHaveLength(1);
    fireClick(layer, 120, 700);
    expect(layer.getDrawings()).toHaveLength(2);
  });

  it('ignores zero-length second click (duplicate anchor)', () => {
    layer.setTool('trend');
    fireClick(layer, 10, 900);
    fireClick(layer, 10, 900); // same point — must not commit
    expect(layer.getDrawings()).toHaveLength(0);
    fireClick(layer, 50, 800);
    expect(layer.getDrawings()).toHaveLength(1);
  });
});

type PointLike = { time: number; price: number };
