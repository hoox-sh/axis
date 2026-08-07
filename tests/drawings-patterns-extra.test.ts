/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * XABCD + head & shoulders pattern tools (5-point multi).
 */

import { describe, expect, it } from 'bun:test';
import type { Point } from '../src/chart/drawing-types.ts';
import {
  getToolHandler,
  type ToolHitCtx,
  type ToolViewCtx,
} from '../src/chart/drawings/tools/registry.ts';
import { priceRatio } from '../src/chart/drawings/tools/patterns-extra.ts';
// Side-effect registration (patterns-extra imports register handlers)
import '../src/chart/drawings/tools/patterns-extra.ts';

const five: Point[] = [
  { time: 1, price: 100 },
  { time: 2, price: 120 },
  { time: 3, price: 105 },
  { time: 4, price: 130 },
  { time: 5, price: 110 },
];

function mockView(selected = false): ToolViewCtx & {
  paths: string[];
  labels: string[];
  lines: number;
  circles: number;
} {
  const ctx = {
    paths: [] as string[],
    labels: [] as string[],
    lines: 0,
    circles: 0,
    toXY: (p: Point) => ({ x: p.time * 10, y: 200 - p.price }),
    timeToX: (t: number) => t * 10,
    priceToY: (price: number) => 200 - price,
    width: 400,
    height: 300,
    el: (_name: string, attrs: Record<string, string>) => {
      if (attrs.d) ctx.paths.push(attrs.d);
      return {} as SVGElement;
    },
    line: () => {
      ctx.lines += 1;
    },
    circle: () => {
      ctx.circles += 1;
    },
    label: (_x: number, _y: number, text: string) => {
      ctx.labels.push(text);
    },
    stroke: '#939fff',
    strokeWidth: 1.5,
    fillOpacity: 0.15,
    selected,
  };
  return ctx;
}

function mockHit(x: number, y: number, tol = 6): ToolHitCtx {
  return {
    x,
    y,
    tol,
    toXY: (p) => ({ x: p.time * 10, y: 200 - p.price }),
    timeToX: (t) => t * 10,
    priceToY: (price) => 200 - price,
    width: 400,
    height: 300,
  };
}

describe('priceRatio helper', () => {
  it('formats finite ratios and handles zero den', () => {
    expect(priceRatio(10, 20)).toBe('0.500');
    expect(priceRatio(15, 10)).toBe('1.500');
    expect(priceRatio(1, 0)).toBe('—');
  });
});

describe('xabcd tool', () => {
  const h = () => getToolHandler('xabcd');

  it('registers as n-point with minPoints 5', () => {
    expect(h()?.arity).toBe('n');
    expect(h()?.minPoints).toBe(5);
    expect(h()?.label).toMatch(/XABCD/i);
  });

  it('create rejects fewer than 5 points', () => {
    expect(h()?.create?.(five.slice(0, 4), '#fff')).toBeNull();
    expect(h()?.create?.([], '#fff')).toBeNull();
  });

  it('create accepts >=5 and keeps first 5', () => {
    const extra = [...five, { time: 6, price: 99 }, { time: 7, price: 98 }];
    const d = h()?.create?.(extra, '#abc');
    expect(d).toBeTruthy();
    expect(d!.kind).toBe('xabcd');
    expect(d!.color).toBe('#abc');
    expect((d as { points: Point[] }).points).toHaveLength(5);
    expect((d as { points: Point[] }).points[0]).toEqual(five[0]!);
    expect((d as { points: Point[] }).points[4]).toEqual(five[4]!);
    expect((d as { p1: Point; p2: Point }).p1).toEqual(five[0]!);
    expect((d as { p2: Point }).p2).toEqual(five[4]!);
  });

  it('paint draws polyline, vertex labels, and ratio labels', () => {
    const d = h()!.create!(five, '#fff')!;
    const ctx = mockView(true);
    h()!.paint!(d, ctx);
    expect(ctx.paths.length).toBeGreaterThanOrEqual(1);
    expect(ctx.paths[0]).toMatch(/^M /);
    for (const L of ['X', 'A', 'B', 'C', 'D']) {
      expect(ctx.labels.some((t) => t === L || t.startsWith(L))).toBe(true);
    }
    expect(ctx.labels.some((t) => t.includes('AB/XA'))).toBe(true);
    expect(ctx.labels.some((t) => t.includes('BC/AB'))).toBe(true);
    expect(ctx.labels.some((t) => t.includes('CD/BC'))).toBe(true);
    expect(ctx.labels.some((t) => t.includes('AD/XA'))).toBe(true);
    expect(ctx.circles).toBeGreaterThanOrEqual(5);
  });

  it('paintDraft previews progressive anchors', () => {
    const ctx = mockView();
    h()!.paintDraft!(five.slice(0, 3), ctx);
    expect(ctx.paths.length).toBeGreaterThanOrEqual(1);
    expect(ctx.labels).toContain('X');
    expect(ctx.labels).toContain('A');
    expect(ctx.labels).toContain('B');
    expect(ctx.labels.some((t) => t.includes('AB/XA'))).toBe(true);
  });

  it('hit tests vertices and segments', () => {
    const d = h()!.create!(five, '#fff')!;
    // Near point X (time 1 → x=10, y=100)
    expect(h()!.hit!(d, mockHit(10, 100))).toBe(true);
    // Far away
    expect(h()!.hit!(d, mockHit(350, 10))).toBe(false);
  });
});

describe('headShoulders tool', () => {
  const h = () => getToolHandler('headShoulders');

  it('registers as n-point with minPoints 5', () => {
    expect(h()?.arity).toBe('n');
    expect(h()?.minPoints).toBe(5);
    expect(h()?.label).toMatch(/Head/i);
  });

  it('create rejects <5 and keeps first 5', () => {
    expect(h()?.create?.(five.slice(0, 3), '#fff')).toBeNull();
    const d = h()?.create?.([...five, { time: 9, price: 1 }], '#0f0');
    expect(d?.kind).toBe('headShoulders');
    expect((d as { points: Point[] }).points).toHaveLength(5);
    expect(d?.color).toBe('#0f0');
  });

  it('paint draws silhouette polyline + neckline + labels', () => {
    const d = h()!.create!(five, '#fff')!;
    const ctx = mockView(true);
    h()!.paint!(d, ctx);
    expect(ctx.paths.length).toBeGreaterThanOrEqual(1);
    expect(ctx.lines).toBeGreaterThanOrEqual(1); // neckline
    for (const L of ['LS', 'NL', 'H', 'NR', 'RS']) {
      expect(ctx.labels).toContain(L);
    }
  });

  it('paintDraft progressive without neckline until 5 points', () => {
    const partial = mockView();
    h()!.paintDraft!(five.slice(0, 3), partial);
    expect(partial.paths.length).toBeGreaterThanOrEqual(1);
    expect(partial.lines).toBe(0);
    expect(partial.labels).toContain('LS');
    expect(partial.labels).toContain('H');

    const full = mockView();
    h()!.paintDraft!(five, full);
    expect(full.lines).toBeGreaterThanOrEqual(1);
  });

  it('hit tests polyline and neckline', () => {
    const d = h()!.create!(five, '#fff')!;
    expect(h()!.hit!(d, mockHit(10, 100))).toBe(true); // LS
    // Mid neckline approx between LS (10,100) and RS (50,90)
    expect(h()!.hit!(d, mockHit(30, 95))).toBe(true);
    expect(h()!.hit!(d, mockHit(380, 20))).toBe(false);
  });
});
