/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Gann tool handlers: registration, create(), paint/hit smoke.
 */

import { describe, expect, it } from 'bun:test';
import type { Point } from '../src/chart/drawing-types.ts';
import { getToolHandler } from '../src/chart/drawings/tools/registry.ts';
// Side-effect: register gannFan / gannBox / gannSquare
import '../src/chart/drawings/tools/gann.ts';

const P1: Point = { time: 1_700_000_000, price: 100 };
const P2: Point = { time: 1_700_000_600, price: 120 };
const COLOR = '#939fff';

function mockViewCtx(overrides: Record<string, unknown> = {}) {
  const lines: unknown[] = [];
  const els: unknown[] = [];
  return {
    toXY: (p: Point) => ({
      x: (p.time - 1_700_000_000) / 10,
      y: 400 - (p.price - 100) * 2,
    }),
    timeToX: (t: number) => (t - 1_700_000_000) / 10,
    priceToY: (price: number) => 400 - (price - 100) * 2,
    width: 800,
    height: 400,
    el: (name: string, attrs: Record<string, string>) => {
      els.push({ name, attrs });
      return {} as SVGElement;
    },
    line: (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      stroke: string,
      sw: number,
      dash?: string,
    ) => {
      lines.push({ x1, y1, x2, y2, stroke, sw, dash });
    },
    circle: () => {},
    label: () => {},
    stroke: COLOR,
    strokeWidth: 1.5,
    fillOpacity: 0.08,
    selected: false,
    _lines: lines,
    _els: els,
    ...overrides,
  };
}

function mockHitCtx(x: number, y: number, tol = 6) {
  return {
    x,
    y,
    tol,
    toXY: (p: Point) => ({
      x: (p.time - 1_700_000_000) / 10,
      y: 400 - (p.price - 100) * 2,
    }),
    timeToX: (t: number) => (t - 1_700_000_000) / 10,
    priceToY: (price: number) => 400 - (price - 100) * 2,
    width: 800,
    height: 400,
  };
}

describe('Gann drawing tools', () => {
  it('registers gannFan, gannBox, gannSquare handlers', () => {
    for (const id of ['gannFan', 'gannBox', 'gannSquare'] as const) {
      const h = getToolHandler(id);
      expect(h).toBeDefined();
      expect(h!.id).toBe(id);
      expect(h!.arity).toBe(2);
      expect(typeof h!.create).toBe('function');
      expect(typeof h!.paint).toBe('function');
      expect(typeof h!.hit).toBe('function');
    }
  });

  it('create() returns valid two-point drawings', () => {
    for (const id of ['gannFan', 'gannBox', 'gannSquare'] as const) {
      const h = getToolHandler(id)!;
      expect(h.create!([], COLOR)).toBeNull();
      expect(h.create!([P1], COLOR)).toBeNull();
      const d = h.create!([P1, P2], COLOR);
      expect(d).toBeTruthy();
      expect(d!.kind).toBe(id);
      expect(d!.color).toBe(COLOR);
      expect('p1' in d! && (d as { p1: Point }).p1).toEqual(P1);
      expect('p2' in d! && (d as { p2: Point }).p2).toEqual(P2);
    }
  });

  it('gannBox create sets low fillOpacity', () => {
    const d = getToolHandler('gannBox')!.create!([P1, P2], COLOR);
    expect(d).toBeTruthy();
    expect((d as { fillOpacity?: number }).fillOpacity).toBeLessThanOrEqual(0.15);
  });

  it('gannFan paint emits multiple extended rays', () => {
    const h = getToolHandler('gannFan')!;
    const d = h.create!([P1, P2], COLOR)!;
    const ctx = mockViewCtx();
    h.paint!(d, ctx as never);
    // Classic set: 1x1, 1x2, 2x1, 1x3, 3x1, 1x4, 4x1 → 7 rays
    expect(ctx._lines.length).toBeGreaterThanOrEqual(7);
  });

  it('gannFan hit is true near the 1x1 ray and false far away', () => {
    const h = getToolHandler('gannFan')!;
    const d = h.create!([P1, P2], COLOR)!;
    // p1 → (0, 400), p2 → (60, 360) in mock coords — 1x1 passes through both
    expect(h.hit!(d, mockHitCtx(30, 380) as never)).toBe(true);
    expect(h.hit!(d, mockHitCtx(700, 50) as never)).toBe(false);
  });

  it('gannBox paint draws fill + border + grid lines', () => {
    const h = getToolHandler('gannBox')!;
    const d = h.create!([P1, P2], COLOR)!;
    const ctx = mockViewCtx();
    h.paint!(d, ctx as never);
    // fill rect + border rect
    expect(ctx._els.filter((e) => (e as { name: string }).name === 'rect').length).toBeGreaterThanOrEqual(2);
    // 3 vertical + 3 horizontal internals
    expect(ctx._lines.length).toBeGreaterThanOrEqual(6);
  });

  it('gannBox hit near edge or grid', () => {
    const h = getToolHandler('gannBox')!;
    const d = h.create!([P1, P2], COLOR)!;
    // a=(0,400), b=(60,360) → box [0,360]–[60,400]
    expect(h.hit!(d, mockHitCtx(0, 380) as never)).toBe(true); // left edge
    expect(h.hit!(d, mockHitCtx(30, 380) as never)).toBe(true); // mid grid-ish
    expect(h.hit!(d, mockHitCtx(400, 100) as never)).toBe(false);
  });

  it('gannSquare paint draws square outline + diagonals', () => {
    const h = getToolHandler('gannSquare')!;
    const d = h.create!([P1, P2], COLOR)!;
    const ctx = mockViewCtx();
    h.paint!(d, ctx as never);
    expect(ctx._els.some((e) => (e as { name: string }).name === 'rect')).toBe(true);
    // two diagonals at minimum
    expect(ctx._lines.length).toBeGreaterThanOrEqual(2);
  });

  it('gannSquare hit on edge / diagonal', () => {
    const h = getToolHandler('gannSquare')!;
    const d = h.create!([P1, P2], COLOR)!;
    // a=(0,400); dx=60, dy=-40 → side=60, square to (60, 340)
    expect(h.hit!(d, mockHitCtx(30, 400) as never)).toBe(true); // top edge (y1)
    expect(h.hit!(d, mockHitCtx(30, 370) as never)).toBe(true); // diagonal-ish
    expect(h.hit!(d, mockHitCtx(500, 50) as never)).toBe(false);
  });
});
