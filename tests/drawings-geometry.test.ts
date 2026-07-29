/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import { FIB_LEVELS } from '../src/chart/drawing-types.ts';
import { fibPrices as layerFibPrices } from '../src/chart/drawing-layer.ts';
import {
  channelEdges,
  distToSegment,
  ellipseBBox,
  extendSegment,
  fibExtensionPrices,
  fibPrices,
  nearPoint,
  nearRectEdge,
  rayExtendPixels,
  resizePoint,
  shiftPoints,
  type ChartPoint,
} from '../src/chart/drawings/geometry.ts';

describe('drawings geometry', () => {
  describe('distToSegment', () => {
    it('is zero on the segment and endpoint', () => {
      expect(distToSegment(0, 0, 0, 0, 10, 0)).toBeCloseTo(0);
      expect(distToSegment(5, 0, 0, 0, 10, 0)).toBeCloseTo(0);
      expect(distToSegment(10, 0, 0, 0, 10, 0)).toBeCloseTo(0);
    });

    it('measures perpendicular distance to the segment', () => {
      expect(distToSegment(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
    });

    it('clamps to the nearest endpoint beyond the segment', () => {
      expect(distToSegment(15, 4, 0, 0, 10, 0)).toBeCloseTo(Math.hypot(5, 4));
      expect(distToSegment(-3, 4, 0, 0, 10, 0)).toBeCloseTo(Math.hypot(3, 4));
    });

    it('handles zero-length segments as point distance', () => {
      expect(distToSegment(3, 4, 0, 0, 0, 0)).toBeCloseTo(5);
    });
  });

  describe('nearPoint / nearRectEdge', () => {
    it('nearPoint within tolerance', () => {
      expect(nearPoint(10, 10, 12, 10, 3)).toBe(true);
      expect(nearPoint(10, 10, 20, 10, 3)).toBe(false);
    });

    it('nearRectEdge hits edges but not deep interior', () => {
      // rect 0,0 – 100,50
      expect(nearRectEdge(0, 25, 0, 0, 100, 50, 4)).toBe(true); // left edge
      expect(nearRectEdge(100, 25, 0, 0, 100, 50, 4)).toBe(true); // right
      expect(nearRectEdge(50, 0, 0, 0, 100, 50, 4)).toBe(true); // top
      expect(nearRectEdge(50, 50, 0, 0, 100, 50, 4)).toBe(true); // bottom
      expect(nearRectEdge(50, 25, 0, 0, 100, 50, 4)).toBe(false); // interior
      expect(nearRectEdge(200, 25, 0, 0, 100, 50, 4)).toBe(false); // outside
    });
  });

  describe('extendSegment / rayExtendPixels', () => {
    it('none leaves endpoints unchanged', () => {
      const s = extendSegment(0, 0, 10, 0, 'none', 100, 100);
      expect(s).toEqual({ x1: 0, y1: 0, x2: 10, y2: 0 });
    });

    it('right extends beyond b; left beyond a', () => {
      const right = extendSegment(0, 0, 10, 0, 'right', 100, 50);
      expect(right.x1).toBe(0);
      expect(right.x2).toBeGreaterThan(10);
      const left = extendSegment(0, 0, 10, 0, 'left', 100, 50);
      expect(left.x1).toBeLessThan(0);
      expect(left.x2).toBe(10);
    });

    it('rayExtendPixels matches right-extend far point', () => {
      const r = rayExtendPixels(0, 0, 10, 0, 100, 100);
      const s = extendSegment(0, 0, 10, 0, 'right', 100, 100);
      expect(r.x).toBeCloseTo(s.x2);
      expect(r.y).toBeCloseTo(s.y2);
    });
  });

  describe('shiftPoints / resizePoint', () => {
    const pts: ChartPoint[] = [
      { time: 1, price: 10 },
      { time: 2, price: 20 },
    ];

    it('shiftPoints translates all points', () => {
      expect(shiftPoints(pts, 5, -1)).toEqual([
        { time: 6, price: 9 },
        { time: 7, price: 19 },
      ]);
      // original unmodified
      expect(pts[0]!.time).toBe(1);
    });

    it('resizePoint replaces a single index', () => {
      const next = resizePoint(pts, 1, { time: 99, price: 0 });
      expect(next[0]).toEqual({ time: 1, price: 10 });
      expect(next[1]).toEqual({ time: 99, price: 0 });
    });
  });

  describe('fibPrices (retrace identity)', () => {
    it('matches drawing-layer fibPrices from high to low', () => {
      const a = fibPrices(100, 0);
      const b = layerFibPrices(100, 0);
      expect(a).toHaveLength(FIB_LEVELS.length);
      expect(a[0]).toBeCloseTo(100);
      expect(a[a.length - 1]!).toBeCloseTo(0);
      expect(a[3]).toBeCloseTo(50); // 0.5
      for (let i = 0; i < a.length; i++) {
        expect(a[i]).toBeCloseTo(b[i]!);
      }
    });

    it('matches drawing-layer fibPrices from low to high', () => {
      const a = fibPrices(0, 100);
      const b = layerFibPrices(0, 100);
      expect(a[0]).toBeCloseTo(0);
      expect(a[a.length - 1]!).toBeCloseTo(100);
      for (let i = 0; i < a.length; i++) {
        expect(a[i]).toBeCloseTo(b[i]!);
      }
    });

    it('accepts custom levels', () => {
      expect(fibPrices(100, 0, [0, 0.5, 1])).toEqual([100, 50, 0]);
    });
  });

  describe('fibExtensionPrices', () => {
    it('starts at 100% endpoint and continues beyond', () => {
      // high → low: 100% is 0; level 0 extension = 0; level 1 = -100
      const ext = fibExtensionPrices(100, 0, [0, 0.5, 1]);
      expect(ext[0]).toBeCloseTo(0);
      expect(ext[1]).toBeCloseTo(-50);
      expect(ext[2]).toBeCloseTo(-100);
    });

    it('extends upward when p1 is low', () => {
      const ext = fibExtensionPrices(0, 100, [0, 1]);
      expect(ext[0]).toBeCloseTo(100);
      expect(ext[1]).toBeCloseTo(200);
    });

    it('default levels length matches FIB_LEVELS', () => {
      expect(fibExtensionPrices(100, 0)).toHaveLength(FIB_LEVELS.length);
    });
  });

  describe('channelEdges', () => {
    it('builds parallel rails through p3', () => {
      const p1: ChartPoint = { time: 0, price: 0 };
      const p2: ChartPoint = { time: 10, price: 10 };
      const p3: ChartPoint = { time: 0, price: 5 };
      const { a1, a2, b1, b2 } = channelEdges(p1, p2, p3);

      expect(a1).toEqual(p1);
      expect(a2).toEqual(p2);
      expect(b1).toEqual(p3);
      expect(b2).toEqual({ time: 10, price: 15 });

      // direction vectors equal → parallel
      expect(a2.time - a1.time).toBeCloseTo(b2.time - b1.time);
      expect(a2.price - a1.price).toBeCloseTo(b2.price - b1.price);
    });
  });

  describe('ellipseBBox', () => {
    it('centers and radii from two corners', () => {
      const box = ellipseBBox({ time: 0, price: 0 }, { time: 10, price: 4 });
      expect(box.cx).toBeCloseTo(5);
      expect(box.cy).toBeCloseTo(2);
      expect(box.rx).toBeCloseTo(5);
      expect(box.ry).toBeCloseTo(2);
    });

    it('order of corners does not matter', () => {
      const a = ellipseBBox({ time: 10, price: 4 }, { time: 0, price: 0 });
      const b = ellipseBBox({ time: 0, price: 0 }, { time: 10, price: 4 });
      expect(a).toEqual(b);
    });
  });
});
