/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Fib circles elliptical X/Y + fills, n-point shift/resize, fill signature.
 */

import { describe, expect, it } from 'bun:test';
import '../src/chart/drawings/tools/fib-extra.ts';
import { getToolHandler } from '../src/chart/drawings/tools/registry.ts';
import { plotFillsSignature, shiftDrawing } from '../src/chart/drawing-layer.ts';

function mockCtx(a: { x: number; y: number }, b: { x: number; y: number }) {
  const els: Array<{ name: string; attrs: Record<string, string> }> = [];
  const map = new Map<string, { x: number; y: number }>([
    ['a', a],
    ['b', b],
  ]);
  return {
    els,
    ctx: {
      toXY: (p: { time: number; price: number }) => {
        if (p.time === 1 && p.price === 100) return map.get('a')!;
        if (p.time === 2 && p.price === 50) return map.get('b')!;
        return null;
      },
      timeToX: () => null,
      priceToY: () => null,
      width: 800,
      height: 600,
      el: (name: string, attrs: Record<string, string>) => {
        els.push({ name, attrs });
        return {} as never;
      },
      line: () => {},
      circle: () => {},
      label: () => {},
      stroke: '#939fff',
      strokeWidth: 1.5,
      dash: undefined,
      fillOpacity: 0.08,
      selected: false,
    } as never,
  };
}

describe('fibCircles elliptical x/y', () => {
  it('create includes points[] mirror', () => {
    const h = getToolHandler('fibCircles')!;
    const d = h.create!(
      [
        { time: 1, price: 100 },
        { time: 2, price: 50 },
      ],
      '#abc',
    ) as unknown as { points?: unknown[] } | null;
    expect(d).toBeTruthy();
    expect(Array.isArray((d as { points?: unknown[] }).points)).toBe(true);
    expect(((d as { points?: unknown[] }).points as unknown[]).length).toBe(2);
  });

  it('paints ellipses with independent rx/ry (dx=100, dy=60)', () => {
    const h = getToolHandler('fibCircles')!;
    const d = h.create!(
      [
        { time: 1, price: 100 },
        { time: 2, price: 50 },
      ],
      '#abc',
    )!;
    const { els, ctx } = mockCtx({ x: 100, y: 100 }, { x: 200, y: 160 });
    h.paint!(d, ctx);
    const strokes = els.filter(
      (e) => (e.name === 'ellipse' || e.name === 'circle') && e.attrs['stroke'] !== 'none',
    );
    expect(strokes.length).toBeGreaterThan(0);
    // Level 1: rx=100, ry=60 → ellipse, not circle
    const lvl1 = strokes.find((e) => e.attrs['rx'] === '100' || e.attrs['r'] === String(Math.hypot(100, 60)));
    expect(lvl1).toBeTruthy();
    expect(lvl1!.name).toBe('ellipse');
    expect(lvl1!.attrs['rx']).toBe('100');
    expect(lvl1!.attrs['ry']).toBe('60');
  });

  it('falls back to circles on degenerate horizontal trend (dy=0)', () => {
    const h = getToolHandler('fibCircles')!;
    const d = h.create!(
      [
        { time: 1, price: 100 },
        { time: 2, price: 50 },
      ],
      '#abc',
    )!;
    const { els, ctx } = mockCtx({ x: 100, y: 100 }, { x: 200, y: 100 });
    h.paint!(d, ctx);
    const strokes = els.filter(
      (e) => (e.name === 'ellipse' || e.name === 'circle') && e.attrs['stroke'] !== 'none',
    );
    // Horizontal → circular fallback (rx==ry==hypot*lvl)
    expect(strokes[0]!.name).toBe('circle');
  });

  it('paints background fills that relocate with strokes', () => {
    const h = getToolHandler('fibCircles')!;
    const d = h.create!(
      [
        { time: 1, price: 100 },
        { time: 2, price: 50 },
      ],
      '#abc',
    )!;
    const { els, ctx } = mockCtx({ x: 100, y: 100 }, { x: 200, y: 160 });
    h.paint!(d, ctx);
    const fills = els.filter((e) => e.attrs['fill'] !== 'none' && e.attrs['stroke'] === 'none');
    expect(fills.length).toBeGreaterThan(0);
    // Fills use same elliptical geometry as strokes
    const fillEllipse = fills.find((e) => e.name === 'ellipse');
    expect(fillEllipse).toBeTruthy();
  });

  it('hit recognizes edge in x vs y independently', () => {
    const h = getToolHandler('fibCircles')!;
    const d = h.create!(
      [
        { time: 1, price: 100 },
        { time: 2, price: 50 },
      ],
      '#abc',
    )!;
    const base = { x: 100, y: 100 };
    const tip = { x: 200, y: 160 }; // dx=100, dy=60
    const mkHit = (x: number, y: number) => ({
      x,
      y,
      tol: 8,
      toXY: (p: { time: number; price: number }) => {
        if (p.time === 1 && p.price === 100) return base;
        if (p.time === 2 && p.price === 50) return tip;
        return null;
      },
      timeToX: () => null,
      priceToY: () => null,
      width: 800,
      height: 600,
    });
    // Right edge of level-1 ellipse (cx+rx, cy) = (200,100)
    expect(h.hit!(d, mkHit(200, 100) as never)).toBe(true);
    // Bottom edge (cx, cy+ry) = (100,160)
    expect(h.hit!(d, mkHit(100, 160) as never)).toBe(true);
    // Far outside
    expect(h.hit!(d, mkHit(400, 400) as never)).toBe(false);
  });
});

describe('n-point shift keeps p2=last so fills relocate', () => {
  it('shiftDrawing preserves first/last mirrors for 5-pt', () => {
    const d = {
      id: 'x1',
      kind: 'xabcd',
      points: [
        { time: 1, price: 1 },
        { time: 2, price: 2 },
        { time: 3, price: 3 },
        { time: 4, price: 4 },
        { time: 5, price: 5 },
      ],
      p1: { time: 1, price: 1 },
      p2: { time: 5, price: 5 },
      color: '#fff',
    } as never;
    const next = shiftDrawing(d, 10, 100) as unknown as {
      points: Array<{ time: number; price: number }>;
      p1: { time: number; price: number };
      p2: { time: number; price: number };
    };
    expect(next.points[0]).toEqual({ time: 11, price: 101 });
    expect(next.points[4]).toEqual({ time: 15, price: 105 });
    expect(next.p1).toEqual({ time: 11, price: 101 });
    expect(next.p2).toEqual({ time: 15, price: 105 });
  });
});

describe('plotFillsSignature catches interior rewrites', () => {
  it('changes when interior values change but tips stay', () => {
    const mk = (upper: number[]) => ({
      name: 'band',
      times: [1, 2, 3, 4, 5, 6, 7, 8],
      upper,
      lower: [1, 1, 1, 1, 1, 1, 1, 1],
      color: 'x',
    });
    const a = plotFillsSignature([mk([10, 10, 10, 10, 10, 10, 10, 10])]);
    const b = plotFillsSignature([mk([10, 10, 10, 99, 10, 10, 10, 10])]);
    expect(a).not.toBe(b);
  });
});
