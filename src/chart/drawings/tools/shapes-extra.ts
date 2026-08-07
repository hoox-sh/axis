// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Extra shapes pack — rotated rectangle, arc, smooth curve.
 *
 * All tools are two-anchor (p1 → p2). Geometry is computed in pixel space
 * after projection via {@link ToolViewCtx.toXY}.
 */

import type { Drawing, Point, TwoPointDrawing } from '../../drawing-types';
import { distToSegment, nearPoint } from '../geometry';
import { registerToolHandler, type ToolHitCtx, type ToolViewCtx } from './registry';

function asTwo(d: Drawing): TwoPointDrawing | null {
  if (!('p1' in d) || !('p2' in d) || !d.p1 || !d.p2) return null;
  return d as TwoPointDrawing;
}

type XY = { x: number; y: number };

function twoXY(
  d: Drawing,
  toXY: (p: Point) => XY | null,
): { a: XY; b: XY } | null {
  const t = asTwo(d);
  if (!t) return null;
  const a = toXY(t.p1);
  const b = toXY(t.p2);
  if (!a || !b) return null;
  return { a, b };
}

function createTwo(kind: TwoPointDrawing['kind'], points: Point[], color: string): TwoPointDrawing | null {
  if (points.length < 2) return null;
  return {
    id: '',
    kind,
    p1: points[0]!,
    p2: points[1]!,
    color,
    fillOpacity: 0.12,
  };
}

/** Unit direction a→b and left-hand perpendicular (px). */
function chordBasis(a: XY, b: XY): { dx: number; dy: number; len: number; ux: number; uy: number; px: number; py: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular (rotate 90° CCW)
  return { dx, dy, len, ux, uy, px: -uy, py: ux };
}

/** Four corners of a rectangle: side a→b, height = |a→b| * 0.4, centered on chord. */
export function rotatedRectCorners(a: XY, b: XY): [XY, XY, XY, XY] {
  const { len, px, py } = chordBasis(a, b);
  const halfH = (len * 0.4) / 2;
  const ox = px * halfH;
  const oy = py * halfH;
  return [
    { x: a.x + ox, y: a.y + oy },
    { x: b.x + ox, y: b.y + oy },
    { x: b.x - ox, y: b.y - oy },
    { x: a.x - ox, y: a.y - oy },
  ];
}

/**
 * Semicircular arc path from a→b (bulge on the left of the chord).
 * SVG A: radius = half chord length → exact semicircle through the midpoint bulge.
 */
export function arcPathD(a: XY, b: XY): string {
  const { len } = chordBasis(a, b);
  const r = Math.max(1, len / 2);
  // large-arc=0, sweep=1 → left-hand semicircle for standard screen coords
  return `M ${a.x} ${a.y} A ${r} ${r} 0 0 1 ${b.x} ${b.y}`;
}

/** Sample points along the semicircular arc (for hit-test). */
export function sampleArc(a: XY, b: XY, n = 24): XY[] {
  const { len, px, py } = chordBasis(a, b);
  const r = Math.max(1, len / 2);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  // Center of semicircle is midpoint; bulge tip is mid + perp * r
  // Parametrize as semicircle around mid with start at a (angle π) → b (angle 0) via +perp
  const out: XY[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n; // 0..1
    const ang = Math.PI * (1 - t); // π → 0
    // local: cos along a→b from mid, sin along +perp
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    // a is mid - (b-a)/2 = mid - ux*r; at ang=π: cos=-1 → mid - ux*r
    const ux = (b.x - a.x) / (len || 1);
    const uy = (b.y - a.y) / (len || 1);
    out.push({
      x: mx + ux * r * cos + px * r * sin,
      y: my + uy * r * cos + py * r * sin,
    });
  }
  return out;
}

/**
 * Cubic S-curve from a→b: control points offset opposite sides of the chord.
 * Offset magnitude ≈ 0.25 * chord length.
 */
export function curveControls(a: XY, b: XY): { c1: XY; c2: XY } {
  const { dx, dy, len, px, py } = chordBasis(a, b);
  const off = len * 0.25;
  return {
    c1: {
      x: a.x + dx * (1 / 3) + px * off,
      y: a.y + dy * (1 / 3) + py * off,
    },
    c2: {
      x: a.x + dx * (2 / 3) - px * off,
      y: a.y + dy * (2 / 3) - py * off,
    },
  };
}

export function curvePathD(a: XY, b: XY): string {
  const { c1, c2 } = curveControls(a, b);
  return `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
}

/** Sample cubic Bézier for hit-test. */
export function sampleCurve(a: XY, b: XY, n = 24): XY[] {
  const { c1, c2 } = curveControls(a, b);
  const out: XY[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const x =
      u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x;
    const y =
      u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y;
    out.push({ x, y });
  }
  return out;
}

function hitPolyline(x: number, y: number, pts: XY[], tol: number): boolean {
  for (const p of pts) {
    if (nearPoint(x, y, p.x, p.y, tol + 2)) return true;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    if (distToSegment(x, y, pts[i]!.x, pts[i]!.y, pts[i + 1]!.x, pts[i + 1]!.y) <= tol) {
      return true;
    }
  }
  return false;
}

function paintAnchors(a: XY, b: XY, ctx: ToolViewCtx): void {
  if (ctx.selected) {
    ctx.circle(a.x, a.y, 5, ctx.stroke, true);
    ctx.circle(b.x, b.y, 5, ctx.stroke, true);
  }
}

// ── Rotated rectangle ───────────────────────────────────────────────────────

function paintRotatedRect(a: XY, b: XY, ctx: ToolViewCtx): void {
  const corners = rotatedRectCorners(a, b);
  let d = `M ${corners[0].x} ${corners[0].y}`;
  for (let i = 1; i < 4; i++) d += ` L ${corners[i]!.x} ${corners[i]!.y}`;
  d += ' Z';
  ctx.el('path', {
    d,
    fill: ctx.stroke,
    'fill-opacity': String(ctx.fillOpacity),
    stroke: ctx.stroke,
    'stroke-width': String(ctx.strokeWidth),
    'pointer-events': 'all',
    ...(ctx.dash ? { 'stroke-dasharray': ctx.dash } : {}),
  });
  paintAnchors(a, b, ctx);
}

function hitRotatedRect(a: XY, b: XY, ctx: ToolHitCtx): boolean {
  const corners = rotatedRectCorners(a, b);
  const closed = [...corners, corners[0]!];
  return hitPolyline(ctx.x, ctx.y, closed, ctx.tol);
}

registerToolHandler({
  id: 'rotatedRect',
  label: 'Rotated rectangle',
  arity: 2,
  create(points, color) {
    return createTwo('rotatedRect', points, color);
  },
  paint(d, ctx) {
    const ab = twoXY(d, ctx.toXY);
    if (!ab) return;
    paintRotatedRect(ab.a, ab.b, ctx);
  },
  hit(d, ctx) {
    const ab = twoXY(d, ctx.toXY);
    if (!ab) return false;
    return hitRotatedRect(ab.a, ab.b, ctx);
  },
  paintDraft(points, ctx) {
    if (points.length < 2) return;
    const a = ctx.toXY(points[0]!);
    const b = ctx.toXY(points[points.length - 1]!);
    if (!a || !b) return;
    paintRotatedRect(a, b, ctx);
  },
});

// ── Arc ─────────────────────────────────────────────────────────────────────

function paintArc(a: XY, b: XY, ctx: ToolViewCtx): void {
  ctx.el('path', {
    d: arcPathD(a, b),
    fill: 'none',
    stroke: ctx.stroke,
    'stroke-width': String(ctx.strokeWidth),
    'stroke-linecap': 'round',
    'pointer-events': 'stroke',
    ...(ctx.dash ? { 'stroke-dasharray': ctx.dash } : {}),
  });
  paintAnchors(a, b, ctx);
}

function hitArc(a: XY, b: XY, ctx: ToolHitCtx): boolean {
  return hitPolyline(ctx.x, ctx.y, sampleArc(a, b), ctx.tol);
}

registerToolHandler({
  id: 'arc',
  label: 'Arc',
  arity: 2,
  create(points, color) {
    return createTwo('arc', points, color);
  },
  paint(d, ctx) {
    const ab = twoXY(d, ctx.toXY);
    if (!ab) return;
    paintArc(ab.a, ab.b, ctx);
  },
  hit(d, ctx) {
    const ab = twoXY(d, ctx.toXY);
    if (!ab) return false;
    return hitArc(ab.a, ab.b, ctx);
  },
  paintDraft(points, ctx) {
    if (points.length < 2) return;
    const a = ctx.toXY(points[0]!);
    const b = ctx.toXY(points[points.length - 1]!);
    if (!a || !b) return;
    paintArc(a, b, ctx);
  },
});

// ── Curve (cubic S-curve) ───────────────────────────────────────────────────

function paintCurve(a: XY, b: XY, ctx: ToolViewCtx): void {
  ctx.el('path', {
    d: curvePathD(a, b),
    fill: 'none',
    stroke: ctx.stroke,
    'stroke-width': String(ctx.strokeWidth),
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'pointer-events': 'stroke',
    ...(ctx.dash ? { 'stroke-dasharray': ctx.dash } : {}),
  });
  paintAnchors(a, b, ctx);
}

function hitCurve(a: XY, b: XY, ctx: ToolHitCtx): boolean {
  return hitPolyline(ctx.x, ctx.y, sampleCurve(a, b), ctx.tol);
}

registerToolHandler({
  id: 'curve',
  label: 'Curve',
  arity: 2,
  create(points, color) {
    return createTwo('curve', points, color);
  },
  paint(d, ctx) {
    const ab = twoXY(d, ctx.toXY);
    if (!ab) return;
    paintCurve(ab.a, ab.b, ctx);
  },
  hit(d, ctx) {
    const ab = twoXY(d, ctx.toXY);
    if (!ab) return false;
    return hitCurve(ab.a, ab.b, ctx);
  },
  paintDraft(points, ctx) {
    if (points.length < 2) return;
    const a = ctx.toXY(points[0]!);
    const b = ctx.toXY(points[points.length - 1]!);
    if (!a || !b) return;
    paintCurve(a, b, ctx);
  },
});
