/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Extra shape tools: rotatedRect, arc, curve — registry + geometry + paint/hit.
 */

import { describe, expect, it } from 'bun:test';
import type { Point, TwoPointDrawing } from '../src/chart/drawing-types.ts';
import {
  arcPathD,
  curveControls,
  curvePathD,
  rotatedRectCorners,
  sampleArc,
  sampleCurve,
} from '../src/chart/drawings/tools/shapes-extra.ts';
import { getToolHandler } from '../src/chart/drawings/tools/registry.ts';
import type { ToolHitCtx, ToolViewCtx } from '../src/chart/drawings/tools/registry.ts';

const p1: Point = { time: 100, price: 50 };
const p2: Point = { time: 200, price: 100 };

/** Identity-ish projection: time→x, price→y (flipped-friendly numeric map). */
function toXY(p: Point): { x: number; y: number } {
  return { x: p.time, y: p.price };
}

function mockView(capture: { els: Array<{ name: string; attrs: Record<string, string> }> }): ToolViewCtx {
  return {
    toXY,
    timeToX: (t) => t,
    priceToY: (price) => price,
    width: 800,
    height: 400,
    el(name, attrs) {
      capture.els.push({ name, attrs });
      return {} as SVGElement;
    },
    line() {},
    circle() {},
    label() {},
    stroke: '#939fff',
    strokeWidth: 1.5,
    fillOpacity: 0.12,
    selected: false,
  };
}

function mockHit(x: number, y: number, tol = 6): ToolHitCtx {
  return {
    x,
    y,
    tol,
    toXY,
    timeToX: (t) => t,
    priceToY: (price) => price,
    width: 800,
    height: 400,
  };
}

describe('shapes-extra geometry', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };

  it('rotatedRectCorners: side follows p1→p2, height = 0.4 * length', () => {
    const corners = rotatedRectCorners(a, b);
    // height 40, half 20 → y = ±20 for horizontal base
    expect(corners[0]!.y).toBeCloseTo(20);
    expect(corners[1]!.y).toBeCloseTo(20);
    expect(corners[2]!.y).toBeCloseTo(-20);
    expect(corners[3]!.y).toBeCloseTo(-20);
    expect(corners[0]!.x).toBeCloseTo(0);
    expect(corners[1]!.x).toBeCloseTo(100);
    // side length between c0-c1 equals chord
    const side = Math.hypot(corners[1]!.x - corners[0]!.x, corners[1]!.y - corners[0]!.y);
    expect(side).toBeCloseTo(100);
    const height = Math.hypot(corners[3]!.x - corners[0]!.x, corners[3]!.y - corners[0]!.y);
    expect(height).toBeCloseTo(40);
  });

  it('arcPathD uses SVG A with semicircle radius', () => {
    const d = arcPathD(a, b);
    expect(d).toMatch(/^M 0 0 A 50 50 /);
    expect(d).toContain('100 0');
  });

  it('sampleArc starts near a and ends near b; bulges off the chord', () => {
    const pts = sampleArc(a, b, 16);
    expect(pts[0]!.x).toBeCloseTo(0, 0);
    expect(pts[0]!.y).toBeCloseTo(0, 0);
    expect(pts[pts.length - 1]!.x).toBeCloseTo(100, 0);
    expect(pts[pts.length - 1]!.y).toBeCloseTo(0, 0);
    const mid = pts[Math.floor(pts.length / 2)]!;
    expect(Math.abs(mid.y)).toBeGreaterThan(20);
  });

  it('curveControls offset opposite sides of the chord (S-curve)', () => {
    const { c1, c2 } = curveControls(a, b);
    // opposite signs on y for horizontal chord
    expect(c1.y * c2.y).toBeLessThan(0);
    expect(c1.x).toBeGreaterThan(a.x);
    expect(c1.x).toBeLessThan(b.x);
    expect(c2.x).toBeGreaterThan(a.x);
    expect(c2.x).toBeLessThan(b.x);
  });

  it('curvePathD is cubic Bézier', () => {
    const d = curvePathD(a, b);
    expect(d.startsWith('M 0 0 C ')).toBe(true);
    expect(d.endsWith('100 0')).toBe(true);
  });

  it('sampleCurve endpoints match anchors', () => {
    const pts = sampleCurve(a, b, 20);
    expect(pts[0]).toEqual(a);
    expect(pts[pts.length - 1]).toEqual(b);
  });
});

describe('shapes-extra tool handlers', () => {
  const ids = ['rotatedRect', 'arc', 'curve'] as const;

  for (const id of ids) {
    it(`${id}: registered with arity 2`, () => {
      const h = getToolHandler(id);
      expect(h).toBeTruthy();
      expect(h!.arity).toBe(2);
      expect(h!.create).toBeTypeOf('function');
      expect(h!.paint).toBeTypeOf('function');
      expect(h!.hit).toBeTypeOf('function');
    });

    it(`${id}: create builds TwoPointDrawing`, () => {
      const h = getToolHandler(id)!;
      const d = h.create!([p1, p2], '#abc') as TwoPointDrawing | null;
      expect(d).toBeTruthy();
      expect(d!.kind).toBe(id);
      expect(d!.p1).toEqual(p1);
      expect(d!.p2).toEqual(p2);
      expect(d!.color).toBe('#abc');
      expect(d!.fillOpacity).toBe(0.12);
    });

    it(`${id}: create returns null with fewer than 2 points`, () => {
      const h = getToolHandler(id)!;
      expect(h.create!([], '#fff')).toBeNull();
      expect(h.create!([p1], '#fff')).toBeNull();
    });
  }

  it('rotatedRect paint emits filled path', () => {
    const capture = { els: [] as Array<{ name: string; attrs: Record<string, string> }> };
    const h = getToolHandler('rotatedRect')!;
    const d = h.create!([p1, p2], '#939fff')!;
    h.paint!(d, mockView(capture));
    const path = capture.els.find((e) => e.name === 'path');
    expect(path).toBeTruthy();
    expect(path!.attrs.d).toMatch(/^M /);
    expect(path!.attrs.d).toContain('Z');
    expect(path!.attrs.fill).toBe('#939fff');
    expect(path!.attrs['fill-opacity']).toBe('0.12');
  });

  it('arc paint emits A path', () => {
    const capture = { els: [] as Array<{ name: string; attrs: Record<string, string> }> };
    const h = getToolHandler('arc')!;
    const d = h.create!([p1, p2], '#939fff')!;
    h.paint!(d, mockView(capture));
    const path = capture.els.find((e) => e.name === 'path');
    expect(path).toBeTruthy();
    expect(path!.attrs.d).toMatch(/ A /);
    expect(path!.attrs.fill).toBe('none');
  });

  it('curve paint emits C path', () => {
    const capture = { els: [] as Array<{ name: string; attrs: Record<string, string> }> };
    const h = getToolHandler('curve')!;
    const d = h.create!([p1, p2], '#939fff')!;
    h.paint!(d, mockView(capture));
    const path = capture.els.find((e) => e.name === 'path');
    expect(path).toBeTruthy();
    expect(path!.attrs.d).toMatch(/ C /);
    expect(path!.attrs.fill).toBe('none');
  });

  it('rotatedRect hit: edge near, deep interior miss', () => {
    const h = getToolHandler('rotatedRect')!;
    // horizontal chord 0,0 → 100,0 → edges at y=±20
    const d = {
      id: '1',
      kind: 'rotatedRect' as const,
      p1: { time: 0, price: 0 },
      p2: { time: 100, price: 0 },
      color: '#fff',
    };
    expect(h.hit!(d, mockHit(50, 20, 4))).toBe(true); // top edge
    expect(h.hit!(d, mockHit(50, 0, 2))).toBe(false); // deep interior
  });

  it('arc hit near midpoint bulge', () => {
    const h = getToolHandler('arc')!;
    const d = {
      id: '1',
      kind: 'arc' as const,
      p1: { time: 0, price: 0 },
      p2: { time: 100, price: 0 },
      color: '#fff',
    };
    // semicircle bulge at (50, 50) for horizontal diameter
    expect(h.hit!(d, mockHit(50, 50, 8))).toBe(true);
    expect(h.hit!(d, mockHit(50, -80, 4))).toBe(false);
  });

  it('curve hit near mid control region', () => {
    const h = getToolHandler('curve')!;
    const d = {
      id: '1',
      kind: 'curve' as const,
      p1: { time: 0, price: 0 },
      p2: { time: 100, price: 0 },
      color: '#fff',
    };
    const samples = sampleCurve({ x: 0, y: 0 }, { x: 100, y: 0 }, 24);
    const mid = samples[Math.floor(samples.length / 2)]!;
    expect(h.hit!(d, mockHit(mid.x, mid.y, 6))).toBe(true);
    expect(h.hit!(d, mockHit(50, 200, 4))).toBe(false);
  });
});
