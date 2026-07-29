// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure geometry helpers for AXIS chart drawings.
 *
 * Operates in pixel space (hit tests, ray extend) or time/price space
 * (shift, fib, channel, ellipse). Used by paint and interaction layers.
 *
 * Does **not**:
 * - Touch the DOM, SVG, or Lightweight Charts APIs
 * - Own drawing entities or style (see `types` / `defaults`)
 * - Compute Pine Script™ plot geometry
 */

import { FIB_LEVELS } from '../drawing-types';

/** Chart coordinate in time/price space. */
export type ChartPoint = { time: number; price: number };

/**
 * How far to project a pixel segment past its anchors when painting rays
 * and infinite lines (`extendSegment`).
 */
export type SegmentExtend = 'none' | 'left' | 'right' | 'both';

/** Distance from point (px,py) to segment (x1,y1)–(x2,y2). */
export function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** True if (px,py) is within `tol` of point (x,y). */
export function nearPoint(px: number, py: number, x: number, y: number, tol: number): boolean {
  return Math.hypot(px - x, py - y) <= tol;
}

/**
 * True if (px,py) is within `tol` of any edge of the axis-aligned rect
 * defined by corners (x1,y1) and (x2,y2). Interior (away from edges) is false.
 */
export function nearRectEdge(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  tol: number,
): boolean {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);

  // Outside the expanded box → miss
  if (px < minX - tol || px > maxX + tol || py < minY - tol || py > maxY + tol) {
    return false;
  }

  const nearLeft = Math.abs(px - minX) <= tol && py >= minY - tol && py <= maxY + tol;
  const nearRight = Math.abs(px - maxX) <= tol && py >= minY - tol && py <= maxY + tol;
  const nearTop = Math.abs(py - minY) <= tol && px >= minX - tol && px <= maxX + tol;
  const nearBottom = Math.abs(py - maxY) <= tol && px >= minX - tol && px <= maxX + tol;
  return nearLeft || nearRight || nearTop || nearBottom;
}

/**
 * Extend a pixel-space segment past endpoints for ray/line painting.
 * Scale factor matches drawing-layer: max(w,h)*4 / length.
 */
export function extendSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  extend: SegmentExtend,
  w: number,
  h: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const scale = (Math.max(w, h) * 4) / len;
  let x1 = ax;
  let y1 = ay;
  let x2 = bx;
  let y2 = by;
  if (extend === 'right' || extend === 'both') {
    x2 = bx + dx * scale;
    y2 = by + dy * scale;
  }
  if (extend === 'left' || extend === 'both') {
    x1 = ax - dx * scale;
    y1 = ay - dy * scale;
  }
  return { x1, y1, x2, y2 };
}

/**
 * Far endpoint of a ray from (ax,ay) through (bx,by), scaled out for viewport (w,h).
 */
export function rayExtendPixels(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  w: number,
  h: number,
): { x: number; y: number } {
  const { x2, y2 } = extendSegment(ax, ay, bx, by, 'right', w, h);
  return { x: x2, y: y2 };
}

/** Translate points in time/price space. */
export function shiftPoints(pts: ChartPoint[], dTime: number, dPrice: number): ChartPoint[] {
  return pts.map((p) => ({ time: p.time + dTime, price: p.price + dPrice }));
}

/** Replace the point at `index` (immutable). Out-of-range index returns a shallow copy. */
export function resizePoint(pts: ChartPoint[], index: number, pt: ChartPoint): ChartPoint[] {
  return pts.map((p, i) => (i === index ? { time: pt.time, price: pt.price } : p));
}

/**
 * Fibonacci **retracement** prices between two endpoints.
 *
 * Same semantics as drawing-layer `fibPrices`:
 * - Span is `|p1 − p2|` (degenerate span treated as 1)
 * - When `p1 >= p2`, levels run from high down; otherwise from low up
 * - Level `0` lands on `p1`; level `1` on the far endpoint (full span)
 *
 * Default ratios: classic retracement set (`FIB_LEVELS`: 0 … 1).
 * Contrast with {@link fibExtensionPrices}, which projects **beyond** 100%.
 */
export function fibPrices(
  p1: number,
  p2: number,
  levels: readonly number[] = FIB_LEVELS,
): number[] {
  const lo = Math.min(p1, p2);
  const hi = Math.max(p1, p2);
  const span = hi - lo || 1;
  const fromHigh = p1 >= p2;
  return levels.map((lvl) => (fromHigh ? p1 - span * lvl : p1 + span * lvl));
}

/**
 * Fibonacci **extension** prices beyond the 100% retracement (far endpoint).
 *
 * Uses the same span and direction rule as {@link fibPrices}, but each level
 * is offset by an extra full span: `price = p1 ± span * (1 + lvl)`.
 * - Level `0` lands on the 100% price (far endpoint of the base move)
 * - Level `1` is another full span past that (200% of the move)
 *
 * Pass extension ratios (e.g. `FIB_EXT_LEVELS`) when you need 1.272 / 1.618 /
 * 2.618 style projections rather than in-range retracement.
 */
export function fibExtensionPrices(
  p1: number,
  p2: number,
  levels: readonly number[] = FIB_LEVELS,
): number[] {
  const lo = Math.min(p1, p2);
  const hi = Math.max(p1, p2);
  const span = hi - lo || 1;
  const fromHigh = p1 >= p2;
  return levels.map((lvl) => (fromHigh ? p1 - span * (1 + lvl) : p1 + span * (1 + lvl)));
}

/**
 * Parallel channel rails from three points.
 * a1→a2 is the base (p1→p2); b1→b2 is the parallel rail through p3.
 */
export function channelEdges(
  p1: ChartPoint,
  p2: ChartPoint,
  p3: ChartPoint,
): { a1: ChartPoint; a2: ChartPoint; b1: ChartPoint; b2: ChartPoint } {
  const dt = p2.time - p1.time;
  const dp = p2.price - p1.price;
  return {
    a1: { time: p1.time, price: p1.price },
    a2: { time: p2.time, price: p2.price },
    b1: { time: p3.time, price: p3.price },
    b2: { time: p3.time + dt, price: p3.price + dp },
  };
}

/**
 * Axis-aligned ellipse bounds in time/price space from two corner points.
 * Center (cx,cy), radii (rx, ry).
 */
export function ellipseBBox(
  p1: ChartPoint,
  p2: ChartPoint,
): { cx: number; cy: number; rx: number; ry: number } {
  const cx = (p1.time + p2.time) / 2;
  const cy = (p1.price + p2.price) / 2;
  const rx = Math.abs(p2.time - p1.time) / 2;
  const ry = Math.abs(p2.price - p1.price) / 2;
  return { cx, cy, rx, ry };
}
