// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Trading / measure extras — forecast projection + combined date×price range.
 */

import { DRAWING_COLORS, type Drawing, type TwoPointDrawing } from '../../drawing-types';
import { distToSegment, nearRectEdge } from '../geometry';
import { arrowEndOf, arrowStartOf, showStatsOf } from '../tool-settings';
import { registerToolHandler, type ToolHitCtx, type ToolViewCtx } from './registry';
import {
  clampOpacity,
  clampStrokeWidth,
  isFinitePoint,
  sanitizePoints,
  sanitizeStrokeColor,
} from './safe';

function asTwo(d: Drawing, kind?: TwoPointDrawing['kind']): TwoPointDrawing | null {
  if (kind && d.kind !== kind) return null;
  if (!('p1' in d) || !('p2' in d) || !d.p1 || !d.p2) return null;
  if (!isFinitePoint(d.p1) || !isFinitePoint(d.p2)) return null;
  return d as TwoPointDrawing;
}

/** Triangle arrow head at (x2,y2) pointing from (x1,y1). */
function paintArrowHead(
  ctx: ToolViewCtx,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  fill: string,
  size: number,
): void {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const s = Math.max(6, size);
  const a1 = ang + Math.PI * 0.82;
  const a2 = ang - Math.PI * 0.82;
  const p1x = x2 + Math.cos(a1) * s;
  const p1y = y2 + Math.sin(a1) * s;
  const p2x = x2 + Math.cos(a2) * s;
  const p2y = y2 + Math.sin(a2) * s;
  ctx.el('polygon', {
    points: `${x2},${y2} ${p1x},${p1y} ${p2x},${p2y}`,
    fill,
    stroke: fill,
    'stroke-width': '1',
    'pointer-events': 'none',
  });
}

/** Project endpoint a short distance past p2 along p1→p2. */
function extendPast(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  factor = 0.18,
  minPx = 16,
): { x: number; y: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return { x: bx + minPx, y: by };
  const ext = Math.max(minPx, len * factor);
  return { x: bx + (dx / len) * ext, y: by + (dy / len) * ext };
}

// ── Forecast (dashed trend projection past p2) ──────────────────────────────

registerToolHandler({
  id: 'forecast',
  label: 'Forecast',
  arity: 2,
  create(points, color) {
    const pts = sanitizePoints(points);
    if (pts.length < 2) return null;
    return {
      id: '',
      kind: 'forecast',
      p1: pts[0]!,
      p2: pts[1]!,
      color: sanitizeStrokeColor(color, DRAWING_COLORS.measure),
      lineStyle: 'dashed',
    };
  },
  paint(d, ctx) {
    const t = asTwo(d, 'forecast');
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    const tip = extendPast(a.x, a.y, b.x, b.y);
    const dash = ctx.dash || '6 4';
    // Solid segment to p2, then dashed projection past tip
    ctx.line(a.x, a.y, b.x, b.y, ctx.stroke, ctx.strokeWidth, dash);
    ctx.line(b.x, b.y, tip.x, tip.y, ctx.stroke, Math.max(1, ctx.strokeWidth - 0.25), dash);
    if (arrowEndOf(d, true)) {
      paintArrowHead(ctx, a.x, a.y, tip.x, tip.y, ctx.stroke, Math.max(8, ctx.strokeWidth * 3));
    }
    if (arrowStartOf(d, false)) {
      paintArrowHead(ctx, tip.x, tip.y, a.x, a.y, ctx.stroke, Math.max(8, ctx.strokeWidth * 3));
    }
    if (showStatsOf(d, true)) {
      const dPrice = t.p2.price - t.p1.price;
      const denom = t.p1.price || 1;
      const pct = (dPrice / denom) * 100;
      const midX = (a.x + tip.x) / 2;
      const midY = (a.y + tip.y) / 2;
      ctx.label(
        midX + 6,
        midY - 6,
        `Forecast ${dPrice >= 0 ? '+' : ''}${dPrice.toFixed(2)} (${pct.toFixed(2)}%)`,
        ctx.stroke,
        11,
      );
    }
    if (ctx.selected) {
      ctx.circle(a.x, a.y, 5, ctx.stroke, true);
      ctx.circle(b.x, b.y, 5, ctx.stroke, true);
    } else {
      ctx.circle(a.x, a.y, 3, ctx.stroke, false);
      ctx.circle(b.x, b.y, 3, ctx.stroke, false);
    }
  },
  hit(d, ctx) {
    const t = asTwo(d, 'forecast');
    if (!t) return false;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return false;
    const tip = extendPast(a.x, a.y, b.x, b.y);
    return (
      distToSegment(ctx.x, ctx.y, a.x, a.y, b.x, b.y) <= ctx.tol ||
      distToSegment(ctx.x, ctx.y, b.x, b.y, tip.x, tip.y) <= ctx.tol
    );
  },
});

// ── Date + price range (combined box) ────────────────────────────────────────

registerToolHandler({
  id: 'datePriceRange',
  label: 'Date + price range',
  arity: 2,
  create(points, color) {
    const pts = sanitizePoints(points);
    if (pts.length < 2) return null;
    return {
      id: '',
      kind: 'datePriceRange',
      p1: pts[0]!,
      p2: pts[1]!,
      color: sanitizeStrokeColor(color, DRAWING_COLORS.measure),
      fillOpacity: 0.12,
    };
  },
  paint(d, ctx) {
    const t = asTwo(d, 'datePriceRange');
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    const left = Math.min(a.x, b.x);
    const top = Math.min(a.y, b.y);
    const w = Math.max(1, Math.abs(b.x - a.x));
    const h = Math.max(1, Math.abs(b.y - a.y));
    ctx.el('rect', {
      x: String(left),
      y: String(top),
      width: String(w),
      height: String(h),
      fill: ctx.stroke,
      'fill-opacity': String(clampOpacity(ctx.fillOpacity, 0.12)),
      stroke: ctx.stroke,
      'stroke-width': String(clampStrokeWidth(ctx.strokeWidth)),
      'pointer-events': 'all',
    });
    let bars = 0;
    if (ctx.barIndexApprox != null) {
      try {
        const n = Math.abs(ctx.barIndexApprox(t.p1.time) - ctx.barIndexApprox(t.p2.time));
        if (Number.isFinite(n)) bars = n;
      } catch {
        bars = 0;
      }
    }
    const dPrice = t.p2.price - t.p1.price;
    const denom = t.p1.price || 1;
    const pct = (dPrice / denom) * 100;
    if (showStatsOf(d, true)) {
      const barPart = bars ? `${bars} bars · ` : '';
      ctx.label(
        left + 4,
        top + 14,
        `${barPart}${dPrice >= 0 ? '+' : ''}${dPrice.toFixed(2)} (${pct.toFixed(2)}%)`,
        ctx.stroke,
        11,
      );
    }
    if (ctx.selected) {
      ctx.circle(a.x, a.y, 5, ctx.stroke, true);
      ctx.circle(b.x, b.y, 5, ctx.stroke, true);
    }
  },
  hit(d, ctx) {
    const t = asTwo(d, 'datePriceRange');
    if (!t) return false;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return false;
    const x1 = Math.min(a.x, b.x);
    const x2 = Math.max(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const y2 = Math.max(a.y, b.y);
    // Full interior hit (filled box) plus edge tolerance
    if (ctx.x >= x1 - ctx.tol && ctx.x <= x2 + ctx.tol && ctx.y >= y1 - ctx.tol && ctx.y <= y2 + ctx.tol) {
      return true;
    }
    return nearRectEdge(ctx.x, ctx.y, x1, y1, x2, y2, ctx.tol);
  },
});

void 0 as unknown as ToolHitCtx;
void 0 as unknown as ToolViewCtx;
