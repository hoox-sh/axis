/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import './setup';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { DrawingLayer } from '../src/chart/drawing-layer.ts';

function ensureSvgDom() {
  const doc = document as unknown as {
    createElementNS?: (ns: string, name: string) => ReturnType<typeof document.createElement>;
    createElement: (tag: string) => HTMLElement;
  };
  if (typeof doc.createElementNS !== 'function') {
    doc.createElementNS = (_ns: string, name: string) => {
      const el = document.createElement(name) as HTMLElement;
      el.setAttribute = el.setAttribute.bind(el);
      return el;
    };
  }
  const w = globalThis as unknown as {
    window?: {
      addEventListener?: (t: string, fn: (...a: unknown[]) => void) => void;
      removeEventListener?: (t: string, fn: (...a: unknown[]) => void) => void;
    };
    addEventListener?: (t: string, fn: (...a: unknown[]) => void) => void;
    removeEventListener?: (t: string, fn: (...a: unknown[]) => void) => void;
  };
  const noopListen = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  if (!w.window || typeof w.window.addEventListener !== 'function') {
    w.window = { ...(w.window || {}), ...noopListen };
  }
  if (typeof w.addEventListener !== 'function') {
    w.addEventListener = noopListen.addEventListener;
    w.removeEventListener = noopListen.removeEventListener;
  }
}

describe('drawing layer clips to plot pane (not scales)', () => {
  let host: HTMLElement;
  let layer: DrawingLayer;

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
    Object.defineProperty(host, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(host, 'clientHeight', { value: 400, configurable: true });
    document.body.appendChild(host);

    const chart = {
      paneSize: () => ({ width: 700, height: 370 }),
      timeScale: () => ({
        width: () => 700,
        height: () => 30,
        timeToCoordinate: () => 0,
        coordinateToTime: () => 0,
        coordinateToLogical: () => 0,
        logicalToCoordinate: () => 0,
        options: () => ({ rightOffset: 10 }),
        applyOptions: () => {},
        subscribeVisibleLogicalRangeChange: () => {},
        unsubscribeVisibleLogicalRangeChange: () => {},
      }),
      priceScale: (id: string) => ({
        width: () => (id === 'right' ? 100 : 0),
      }),
    };
    const series = {
      priceToCoordinate: (p: number) => 1000 - p,
      coordinateToPrice: (y: number) => 1000 - y,
    };
    layer = new DrawingLayer(host, chart as never, series as never);
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

  it('sizes the SVG to paneSize, not the host (leaves the 100px scale clear)', () => {
    const svg = (layer as unknown as { svg: SVGSVGElement }).svg;
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('width')).toBe('700');
    expect(svg.getAttribute('height')).toBe('370');
    expect(svg.style.left).toBe('0px');
    expect(svg.style.width).toBe('700px');
    expect(svg.style.height).toBe('370px');
  });
});
