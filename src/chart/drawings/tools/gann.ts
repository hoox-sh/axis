// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Gann tools pack — fan, box, square.
 *
 * Geometric constructions in chart time/price + pixel space. Not affiliated
 * with TradingView®; naming follows classic Gann angle ratios only.
 */

import type { Drawing, Point, TwoPointDrawing } from '../../drawing-types';
import { distToSegment, extendSegment, nearRectEdge } from '../geometry';
import { registerToolHandler, type ToolHitCtx, type ToolViewCtx } from './registry';

/** Classic Gann angle ratios (time × price) relative to the 1×1 baseline. */
const GANN_RATIOS: readonly { t: number; p: number; label: string }[] = [
  { t: 1, p: 1, label: '1x1' },
  { t: 1, p: 2, label: '1x2' },
  { t: 2, p: 1, label: '2x1' },
  { t: 1, p: 3, label: '1x3' },
  { t: 3, p: 1, label: '3x1' },
  { t: 1, p: 4, label: '1x4' },
  { t: 4, p: 1, label: '4x1' },
];

/** Internal grid fractions for Gann box (excludes outer 0/1 edges). */
const BOX_GRID = [0.25, 0.5, 0.75] as const;

function asTwo(d: Drawing): TwoPointDrawing | null {
  if (!('p1' in d) || !('p2' in d) || !d.p1 || !d.p2) return null;
  return d as TwoPointDrawing;
}

function twoPoint(
  kind: 'gannFan' | 'gannBox' | 'gannSquare',
  points: Point[],
  color: string,
  extra?: Partial<TwoPointDrawing>,
): TwoPointDrawing | null {
  if (points.length < 2) return null;
  return {
    id: '',
    kind,
    p1: points[0]!,
    p2: points[1]!,
    color,
    ...extra,
  };
}

/**
 * Pixel-space direction vectors for each Gann ratio.
 * p1→p2 is the 1×1 unit; ratio t×p scales (dx, dy) by (t, p).
 */
function fanDirections(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number; label: string }[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Degenerate baseline: tiny unit so rays still paint
  const ux = dx === 0 && dy === 0 ? 1 : dx;
  const uy = dx === 0 && dy === 0 ? 0 : dy;
  return GANN_RATIOS.map((r) => ({
    x: a.x + ux * r.t,
    y: a.y + uy * r.p,
    label: r.label,
  }));
}

function fanRaySegments(
  a: { x: number; y: number },
  b: { x: number; y: number },
  w: number,
  h: number,
): { x1: number; y1: number; x2: number; y2: number; label: string }[] {
  return fanDirections(a, b).map((d) => {
    const e = extendSegment(a.x, a.y, d.x, d.y, 'right', w, h);
    return { ...e, label: d.label };
  });
}

// ── Gann fan ────────────────────────────────────────────────────────────────

registerToolHandler({
  id: 'gannFan',
  label: 'Gann fan',
  arity: 2,
  create(points, color) {
    return twoPoint('gannFan', points, color);
  },
  paint(d, ctx) {
    const t = asTwo(d);
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    const rays = fanRaySegments(a, b, ctx.width, ctx.height);
    for (const r of rays) {
      const is11 = r.label === '1x1';
      ctx.line(
        r.x1,
        r.y1,
        r.x2,
        r.y2,
        ctx.stroke,
        is11 ? ctx.strokeWidth : Math.max(1, ctx.strokeWidth - 0.25),
        is11 ? ctx.dash : '3 3',
      );
    }
    // Anchor + 1×1 tip markers
    ctx.circle(a.x, a.y, ctx.selected ? 5 : 3, ctx.stroke, true);
    ctx.circle(b.x, b.y, ctx.selected ? 5 : 3, ctx.stroke, ctx.selected);
    if (ctx.selected) {
      // Light labels near origin for the outer rays
      for (const r of rays) {
        if (r.label === '1x1') continue;
        const dx = r.x2 - r.x1;
        const dy = r.y2 - r.y1;
        const len = Math.hypot(dx, dy) || 1;
        const lx = r.x1 + (dx / len) * 48;
        const ly = r.y1 + (dy / len) * 48;
        ctx.label(lx + 2, ly - 2, r.label, ctx.stroke, 9);
      }
    }
  },
  hit(d, ctx) {
    const t = asTwo(d);
    if (!t) return false;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return false;
    let best = Infinity;
    for (const r of fanRaySegments(a, b, ctx.width, ctx.height)) {
      best = Math.min(best, distToSegment(ctx.x, ctx.y, r.x1, r.y1, r.x2, r.y2));
      if (best <= ctx.tol) return true;
    }
    return best <= ctx.tol;
  },
  paintDraft(points, ctx) {
    if (points.length < 2) return;
    const a = ctx.toXY(points[0]!);
    const b = ctx.toXY(points[1]!);
    if (!a || !b) return;
    for (const r of fanRaySegments(a, b, ctx.width, ctx.height)) {
      ctx.line(r.x1, r.y1, r.x2, r.y2, ctx.stroke, ctx.strokeWidth, '4 4');
    }
  },
});

// ── Gann box ────────────────────────────────────────────────────────────────

function boxCorners(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x1: number; y1: number; x2: number; y2: number } {
  return {
    x1: Math.min(a.x, b.x),
    y1: Math.min(a.y, b.y),
    x2: Math.max(a.x, b.x),
    y2: Math.max(a.y, b.y),
  };
}

registerToolHandler({
  id: 'gannBox',
  label: 'Gann box',
  arity: 2,
  create(points, color) {
    return twoPoint('gannBox', points, color, { fillOpacity: 0.08 });
  },
  paint(d, ctx) {
    const t = asTwo(d);
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    const { x1, y1, x2, y2 } = boxCorners(a, b);
    const w = x2 - x1;
    const h = y2 - y1;
    // Fill
    ctx.el('rect', {
      x: String(x1),
      y: String(y1),
      width: String(Math.max(1, w)),
      height: String(Math.max(1, h)),
      fill: ctx.stroke,
      'fill-opacity': String(Math.min(0.2, Math.max(0.04, ctx.fillOpacity))),
      stroke: 'none',
      'pointer-events': 'none',
    });
    // Outer border
    ctx.el('rect', {
      x: String(x1),
      y: String(y1),
      width: String(Math.max(1, w)),
      height: String(Math.max(1, h)),
      fill: 'none',
      stroke: ctx.stroke,
      'stroke-width': String(ctx.strokeWidth),
      'pointer-events': 'stroke',
      ...(ctx.dash ? { 'stroke-dasharray': ctx.dash } : {}),
    });
    // Internal grid at 0.25 / 0.5 / 0.75 (time = vertical lines, price = horizontal)
    for (const f of BOX_GRID) {
      const x = x1 + w * f;
      const y = y1 + h * f;
      const dash = f === 0.5 ? undefined : '3 3';
      const sw = f === 0.5 ? ctx.strokeWidth : Math.max(1, ctx.strokeWidth - 0.5);
      ctx.line(x, y1, x, y2, ctx.stroke, sw, dash);
      ctx.line(x1, y, x2, y, ctx.stroke, sw, dash);
    }
    if (ctx.selected) {
      ctx.circle(a.x, a.y, 5, ctx.stroke, true);
      ctx.circle(b.x, b.y, 5, ctx.stroke, true);
    }
  },
  hit(d, ctx) {
    const t = asTwo(d);
    if (!t) return false;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return false;
    const { x1, y1, x2, y2 } = boxCorners(a, b);
    if (nearRectEdge(ctx.x, ctx.y, x1, y1, x2, y2, ctx.tol)) return true;
    const w = x2 - x1;
    const h = y2 - y1;
    for (const f of BOX_GRID) {
      const x = x1 + w * f;
      const y = y1 + h * f;
      if (distToSegment(ctx.x, ctx.y, x, y1, x, y2) <= ctx.tol) return true;
      if (distToSegment(ctx.x, ctx.y, x1, y, x2, y) <= ctx.tol) return true;
    }
    return false;
  },
  paintDraft(points, ctx) {
    if (points.length < 2) return;
    const a = ctx.toXY(points[0]!);
    const b = ctx.toXY(points[1]!);
    if (!a || !b) return;
    const { x1, y1, x2, y2 } = boxCorners(a, b);
    ctx.el('rect', {
      x: String(x1),
      y: String(y1),
      width: String(Math.max(1, x2 - x1)),
      height: String(Math.max(1, y2 - y1)),
      fill: ctx.stroke,
      'fill-opacity': '0.06',
      stroke: ctx.stroke,
      'stroke-width': String(ctx.strokeWidth),
      'stroke-dasharray': '4 4',
      'pointer-events': 'none',
    });
  },
});

// ── Gann square ─────────────────────────────────────────────────────────────

/**
 * Pixel-space square: p1 is the corner origin; side length is max(|dx|,|dy|)
 * so width ≈ height regardless of chart scale. Sign follows p2.
 */
function squarePixelCorners(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x1: number; y1: number; x2: number; y2: number; side: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy), 1);
  const sx = dx === 0 ? (dy === 0 ? 1 : 1) : Math.sign(dx);
  const sy = dy === 0 ? (dx === 0 ? 1 : 1) : Math.sign(dy);
  return {
    x1: a.x,
    y1: a.y,
    x2: a.x + sx * side,
    y2: a.y + sy * side,
    side,
  };
}

function squareEdges(c: { x1: number; y1: number; x2: number; y2: number }): [
  [number, number, number, number],
  [number, number, number, number],
  [number, number, number, number],
  [number, number, number, number],
  [number, number, number, number],
  [number, number, number, number],
] {
  const { x1, y1, x2, y2 } = c;
  return [
    [x1, y1, x2, y1], // top
    [x2, y1, x2, y2], // right
    [x2, y2, x1, y2], // bottom
    [x1, y2, x1, y1], // left
    [x1, y1, x2, y2], // diag \
    [x2, y1, x1, y2], // diag /
  ];
}

registerToolHandler({
  id: 'gannSquare',
  label: 'Gann square',
  arity: 2,
  create(points, color) {
    return twoPoint('gannSquare', points, color, { fillOpacity: 0.06 });
  },
  paint(d, ctx) {
    const t = asTwo(d);
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    const sq = squarePixelCorners(a, b);
    const minX = Math.min(sq.x1, sq.x2);
    const minY = Math.min(sq.y1, sq.y2);
    const side = sq.side;
    // Fill
    ctx.el('rect', {
      x: String(minX),
      y: String(minY),
      width: String(side),
      height: String(side),
      fill: ctx.stroke,
      'fill-opacity': String(Math.min(0.15, Math.max(0.03, ctx.fillOpacity))),
      stroke: 'none',
      'pointer-events': 'none',
    });
    // Outline
    ctx.el('rect', {
      x: String(minX),
      y: String(minY),
      width: String(side),
      height: String(side),
      fill: 'none',
      stroke: ctx.stroke,
      'stroke-width': String(ctx.strokeWidth),
      'pointer-events': 'stroke',
      ...(ctx.dash ? { 'stroke-dasharray': ctx.dash } : {}),
    });
    // Diagonals
    ctx.line(sq.x1, sq.y1, sq.x2, sq.y2, ctx.stroke, Math.max(1, ctx.strokeWidth - 0.25), '3 3');
    ctx.line(sq.x2, sq.y1, sq.x1, sq.y2, ctx.stroke, Math.max(1, ctx.strokeWidth - 0.25), '3 3');
    if (ctx.selected) {
      ctx.circle(a.x, a.y, 5, ctx.stroke, true);
      // Far corner of the square (pixel-sized)
      ctx.circle(sq.x2, sq.y2, 5, ctx.stroke, true);
    }
  },
  hit(d, ctx) {
    const t = asTwo(d);
    if (!t) return false;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return false;
    const sq = squarePixelCorners(a, b);
    for (const [x1, y1, x2, y2] of squareEdges(sq)) {
      if (distToSegment(ctx.x, ctx.y, x1, y1, x2, y2) <= ctx.tol) return true;
    }
    return false;
  },
  paintDraft(points, ctx) {
    if (points.length < 2) return;
    const a = ctx.toXY(points[0]!);
    const b = ctx.toXY(points[1]!);
    if (!a || !b) return;
    const sq = squarePixelCorners(a, b);
    const minX = Math.min(sq.x1, sq.x2);
    const minY = Math.min(sq.y1, sq.y2);
    ctx.el('rect', {
      x: String(minX),
      y: String(minY),
      width: String(sq.side),
      height: String(sq.side),
      fill: 'none',
      stroke: ctx.stroke,
      'stroke-width': String(ctx.strokeWidth),
      'stroke-dasharray': '4 4',
      'pointer-events': 'none',
    });
    ctx.line(sq.x1, sq.y1, sq.x2, sq.y2, ctx.stroke, 1, '4 4');
    ctx.line(sq.x2, sq.y1, sq.x1, sq.y2, ctx.stroke, 1, '4 4');
  },
});

// Keep type imports live for TS unused checks in some configs
void 0 as unknown as ToolHitCtx;
void 0 as unknown as ToolViewCtx;
