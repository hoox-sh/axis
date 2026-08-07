/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Trading/measure extras: forecast projection + datePriceRange combined box.
 */

import { describe, expect, it } from 'bun:test';
import { DRAWING_COLORS, toolArity, toolLabel } from '../src/chart/drawing-types.ts';
import {
  getToolHandler,
  listToolHandlers,
  type ToolHitCtx,
  type ToolViewCtx,
} from '../src/chart/drawings/tools';
import { TOOL_GROUPS } from '../src/chart/drawings/tool-catalog.ts';

const p1 = { time: 1_700_000_000, price: 100 };
const p2 = { time: 1_700_000_600, price: 110 };

function mockViewCtx(overrides: Partial<ToolViewCtx> = {}): ToolViewCtx {
  const els: Array<{ name: string; attrs: Record<string, string> }> = [];
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number; dash?: string }> = [];
  const labels: Array<{ text: string }> = [];
  const circles: Array<{ x: number; y: number }> = [];
  const ctx: ToolViewCtx = {
    toXY: (p) => ({ x: p.time - 1_700_000_000, y: 200 - p.price }),
    timeToX: (t) => t - 1_700_000_000,
    priceToY: (price) => 200 - price,
    width: 800,
    height: 400,
    el: (name, attrs) => {
      els.push({ name, attrs });
      return {} as SVGElement;
    },
    line: (x1, y1, x2, y2, _stroke, _sw, dash) => {
      lines.push({ x1, y1, x2, y2, dash });
    },
    circle: (x, y) => {
      circles.push({ x, y });
    },
    label: (_x, _y, text) => {
      labels.push({ text });
    },
    stroke: DRAWING_COLORS.measure,
    strokeWidth: 1.5,
    dash: '6 4',
    fillOpacity: 0.12,
    selected: false,
    barIndexApprox: (t) => Math.floor(t / 60),
    ...overrides,
  };
  // Expose captured paint side-effects for assertions
  (ctx as ToolViewCtx & { _els: typeof els })._els = els;
  (ctx as ToolViewCtx & { _lines: typeof lines })._lines = lines;
  (ctx as ToolViewCtx & { _labels: typeof labels })._labels = labels;
  (ctx as ToolViewCtx & { _circles: typeof circles })._circles = circles;
  return ctx;
}

function mockHitCtx(x: number, y: number, tol = 6): ToolHitCtx {
  return {
    x,
    y,
    tol,
    toXY: (p) => ({ x: p.time - 1_700_000_000, y: 200 - p.price }),
    timeToX: (t) => t - 1_700_000_000,
    priceToY: (price) => 200 - price,
    width: 800,
    height: 400,
  };
}

describe('trading-extra handlers', () => {
  it('registers forecast and datePriceRange', () => {
    const ids = listToolHandlers().map((h) => h.id);
    expect(ids).toContain('forecast');
    expect(ids).toContain('datePriceRange');
    expect(getToolHandler('forecast')?.arity).toBe(2);
    expect(getToolHandler('datePriceRange')?.arity).toBe(2);
    expect(toolArity('forecast')).toBe(2);
    expect(toolArity('datePriceRange')).toBe(2);
    expect(toolLabel('forecast')).toMatch(/Forecast/i);
    expect(toolLabel('datePriceRange')).toMatch(/date/i);
  });

  it('catalog lists forecast under trading and datePriceRange under measure', () => {
    const trading = TOOL_GROUPS.find((g) => g.id === 'trading');
    const measure = TOOL_GROUPS.find((g) => g.id === 'measure');
    expect(trading?.tools).toContain('forecast');
    expect(measure?.tools).toContain('datePriceRange');
  });

  it('forecast create needs 2 points and defaults measure color', () => {
    const h = getToolHandler('forecast')!;
    expect(h.create?.([p1], '#fff')).toBeNull();
    const d = h.create?.([p1, p2], '');
    expect(d).toBeTruthy();
    expect(d!.kind).toBe('forecast');
    if (d && 'p1' in d) {
      expect(d.p1).toEqual(p1);
      expect(d.p2).toEqual(p2);
    }
    expect(d!.color).toBe(DRAWING_COLORS.measure);
    expect(d!.lineStyle).toBe('dashed');
  });

  it('forecast paints dashed projection, arrow head, and Forecast label', () => {
    const h = getToolHandler('forecast')!;
    const d = h.create!([p1, p2], DRAWING_COLORS.measure)!;
    const ctx = mockViewCtx();
    h.paint?.(d, ctx);
    const lines = (ctx as ToolViewCtx & { _lines: Array<{ dash?: string }> })._lines;
    const labels = (ctx as ToolViewCtx & { _labels: Array<{ text: string }> })._labels;
    const els = (ctx as ToolViewCtx & { _els: Array<{ name: string }> })._els;
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.some((l) => l.dash)).toBe(true);
    // Projection extends past p2 (x of p2 is 600 in mock coords)
    const last = lines[lines.length - 1]!;
    expect(last.x2).toBeGreaterThan(600);
    expect(els.some((e) => e.name === 'polygon')).toBe(true);
    expect(labels.some((l) => /Forecast/i.test(l.text))).toBe(true);
    expect(labels.some((l) => /\+10\.00/.test(l.text) && /10\.00%/.test(l.text))).toBe(true);
  });

  it('forecast hit-tests along segment and extension', () => {
    const h = getToolHandler('forecast')!;
    const d = h.create!([p1, p2], DRAWING_COLORS.measure)!;
    // On segment midpoint
    expect(h.hit?.(d, mockHitCtx(300, 95))).toBe(true);
    // Far away
    expect(h.hit?.(d, mockHitCtx(50, 300))).toBe(false);
  });

  it('datePriceRange create builds filled two-point box', () => {
    const h = getToolHandler('datePriceRange')!;
    expect(h.create?.([p1], '#fff')).toBeNull();
    const d = h.create!([p1, p2], '#abc')!;
    expect(d.kind).toBe('datePriceRange');
    expect(d.color).toBe('#abc');
    expect(d.fillOpacity).toBe(0.12);
    if ('p1' in d) {
      expect(d.p1).toEqual(p1);
      expect(d.p2).toEqual(p2);
    }
  });

  it('datePriceRange paints rect and bars + price range label', () => {
    const h = getToolHandler('datePriceRange')!;
    const d = h.create!([p1, p2], DRAWING_COLORS.measure)!;
    const ctx = mockViewCtx();
    h.paint?.(d, ctx);
    const els = (ctx as ToolViewCtx & { _els: Array<{ name: string; attrs: Record<string, string> }> })
      ._els;
    const labels = (ctx as ToolViewCtx & { _labels: Array<{ text: string }> })._labels;
    const rect = els.find((e) => e.name === 'rect');
    expect(rect).toBeTruthy();
    expect(Number(rect!.attrs.width)).toBeGreaterThan(0);
    expect(Number(rect!.attrs.height)).toBeGreaterThan(0);
    // barIndexApprox: floor(t/60) → |0 - 10| = 10 bars; +10 price / 10%
    expect(labels.some((l) => /10 bars/.test(l.text))).toBe(true);
    expect(labels.some((l) => /\+10\.00/.test(l.text) && /10\.00%/.test(l.text))).toBe(true);
  });

  it('datePriceRange hit-tests interior of the box', () => {
    const h = getToolHandler('datePriceRange')!;
    const d = h.create!([p1, p2], DRAWING_COLORS.measure)!;
    // p1 → (0, 100), p2 → (600, 90) in mock space
    expect(h.hit?.(d, mockHitCtx(300, 95))).toBe(true);
    expect(h.hit?.(d, mockHitCtx(10, 10))).toBe(false);
  });
});
