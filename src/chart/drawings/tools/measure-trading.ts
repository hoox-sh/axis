// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Measure + trading pack — date range, price range, long/short positions.
 */

import { DRAWING_COLORS, type Drawing, type Point, type TwoPointDrawing } from '../../drawing-types';
import { distToSegment, nearRectEdge } from '../geometry';
import { registerToolHandler } from './registry';
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

// ── Date range (vertical band) ──────────────────────────────────────────────

registerToolHandler({
  id: 'dateRange',
  label: 'Date range',
  arity: 2,
  create(points, color) {
    const pts = sanitizePoints(points);
    if (pts.length < 2) return null;
    return {
      id: '',
      kind: 'dateRange',
      p1: pts[0]!,
      p2: pts[1]!,
      color: sanitizeStrokeColor(color),
      fillOpacity: 0.12,
    };
  },
  paint(d, ctx) {
    const t = asTwo(d, 'dateRange');
    if (!t) return;
    const x1 = ctx.timeToX(t.p1.time);
    const x2 = ctx.timeToX(t.p2.time);
    if (x1 == null || x2 == null) return;
    const left = Math.min(x1, x2);
    const w = Math.abs(x2 - x1);
    ctx.el('rect', {
      x: String(left),
      y: '0',
      width: String(Math.max(1, w)),
      height: String(ctx.height),
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
    ctx.label(left + 4, 14, bars ? `${bars} bars` : 'range', ctx.stroke, 11);
    if (ctx.selected) {
      ctx.circle(x1, ctx.height / 2, 5, ctx.stroke, true);
      ctx.circle(x2, ctx.height / 2, 5, ctx.stroke, true);
    }
  },
  hit(d, ctx) {
    const t = asTwo(d, 'dateRange');
    if (!t) return false;
    const x1 = ctx.timeToX(t.p1.time);
    const x2 = ctx.timeToX(t.p2.time);
    if (x1 == null || x2 == null) return false;
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    return ctx.x >= left - ctx.tol && ctx.x <= right + ctx.tol;
  },
});

// ── Price range (horizontal band) ───────────────────────────────────────────

registerToolHandler({
  id: 'priceRange',
  label: 'Price range',
  arity: 2,
  create(points, color) {
    const pts = sanitizePoints(points);
    if (pts.length < 2) return null;
    return {
      id: '',
      kind: 'priceRange',
      p1: pts[0]!,
      p2: pts[1]!,
      color: sanitizeStrokeColor(color),
      fillOpacity: 0.12,
    };
  },
  paint(d, ctx) {
    const t = asTwo(d, 'priceRange');
    if (!t) return;
    const y1 = ctx.priceToY(t.p1.price);
    const y2 = ctx.priceToY(t.p2.price);
    if (y1 == null || y2 == null) return;
    const top = Math.min(y1, y2);
    const h = Math.abs(y2 - y1);
    ctx.el('rect', {
      x: '0',
      y: String(top),
      width: String(ctx.width),
      height: String(Math.max(1, h)),
      fill: ctx.stroke,
      'fill-opacity': String(clampOpacity(ctx.fillOpacity, 0.12)),
      stroke: ctx.stroke,
      'stroke-width': String(clampStrokeWidth(ctx.strokeWidth)),
      'pointer-events': 'all',
    });
    const dPrice = t.p2.price - t.p1.price;
    const denom = t.p1.price || 1;
    const pct = (dPrice / denom) * 100;
    ctx.label(
      6,
      top + 14,
      `${dPrice >= 0 ? '+' : ''}${dPrice.toFixed(2)} (${pct.toFixed(2)}%)`,
      ctx.stroke,
      11,
    );
    if (ctx.selected) {
      ctx.circle(ctx.width / 2, y1, 5, ctx.stroke, true);
      ctx.circle(ctx.width / 2, y2, 5, ctx.stroke, true);
    }
  },
  hit(d, ctx) {
    const t = asTwo(d, 'priceRange');
    if (!t) return false;
    const y1 = ctx.priceToY(t.p1.price);
    const y2 = ctx.priceToY(t.p2.price);
    if (y1 == null || y2 == null) return false;
    const top = Math.min(y1, y2);
    const bot = Math.max(y1, y2);
    return ctx.y >= top - ctx.tol && ctx.y <= bot + ctx.tol;
  },
});

// ── Long / short position boxes ─────────────────────────────────────────────

function paintPosition(
  d: Drawing,
  ctx: Parameters<NonNullable<import('./registry').ToolHandler['paint']>>[1],
  dir: 'long' | 'short',
  kind: 'long' | 'short',
) {
  const t = asTwo(d, kind);
  if (!t) return;
  const a = ctx.toXY(t.p1);
  const b = ctx.toXY(t.p2);
  if (!a || !b) return;
  const entry = t.p1.price;
  const target = t.p2.price;
  // Risk = same magnitude opposite of reward for a simple 1:1 R default zone
  const reward = target - entry;
  const stop = entry - reward;
  const yEntry = ctx.priceToY(entry);
  const yTarget = ctx.priceToY(target);
  const yStop = ctx.priceToY(stop);
  if (yEntry == null || yTarget == null || yStop == null) return;
  const x1 = Math.min(a.x, b.x);
  const x2 = Math.max(a.x, b.x);
  const w = Math.max(8, x2 - x1);
  const upColor = DRAWING_COLORS.up;
  const downColor = DRAWING_COLORS.down;
  const profitTop = Math.min(yEntry, yTarget);
  const profitH = Math.abs(yTarget - yEntry);
  const lossTop = Math.min(yEntry, yStop);
  const lossH = Math.abs(yStop - yEntry);
  ctx.el('rect', {
    x: String(x1),
    y: String(profitTop),
    width: String(w),
    height: String(Math.max(1, profitH)),
    fill: upColor,
    'fill-opacity': '0.18',
    stroke: upColor,
    'stroke-width': '1',
    'pointer-events': 'all',
  });
  ctx.el('rect', {
    x: String(x1),
    y: String(lossTop),
    width: String(w),
    height: String(Math.max(1, lossH)),
    fill: downColor,
    'fill-opacity': '0.18',
    stroke: downColor,
    'stroke-width': '1',
    'pointer-events': 'all',
  });
  ctx.line(x1, yEntry, x2, yEntry, ctx.stroke, ctx.strokeWidth);
  const pnl = dir === 'long' ? target - entry : entry - target;
  const denom = entry || 1;
  const pct = (pnl / denom) * 100;
  ctx.label(
    x1 + 4,
    profitTop + 12,
    `${dir.toUpperCase()} ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} (${pct.toFixed(2)}%)`,
    ctx.stroke,
    11,
  );
  if (ctx.selected) {
    ctx.circle(a.x, a.y, 5, ctx.stroke, true);
    ctx.circle(b.x, b.y, 5, ctx.stroke, true);
  }
}

function hitPosition(
  d: Drawing,
  ctx: Parameters<NonNullable<import('./registry').ToolHandler['hit']>>[1],
  kind: 'long' | 'short',
): boolean {
  const t = asTwo(d, kind);
  if (!t) return false;
  const a = ctx.toXY(t.p1);
  const b = ctx.toXY(t.p2);
  if (!a || !b) return false;
  const entry = t.p1.price;
  const target = t.p2.price;
  const stop = entry - (target - entry);
  const yEntry = ctx.priceToY(entry);
  const yTarget = ctx.priceToY(target);
  const yStop = ctx.priceToY(stop);
  if (yEntry == null || yTarget == null || yStop == null) return false;
  const x1 = Math.min(a.x, b.x);
  const x2 = Math.max(a.x, b.x);
  const top = Math.min(yEntry, yTarget, yStop);
  const bot = Math.max(yEntry, yTarget, yStop);
  return (
    nearRectEdge(ctx.x, ctx.y, x1, top, x2, bot, ctx.tol) ||
    (ctx.x >= x1 - ctx.tol && ctx.x <= x2 + ctx.tol && ctx.y >= top - ctx.tol && ctx.y <= bot + ctx.tol)
  );
}

registerToolHandler({
  id: 'long',
  label: 'Long position',
  arity: 2,
  create(points, color) {
    const pts = sanitizePoints(points);
    if (pts.length < 2) return null;
    return {
      id: '',
      kind: 'long',
      p1: pts[0]!,
      p2: pts[1]!,
      color: sanitizeStrokeColor(color, DRAWING_COLORS.up),
      meta: { direction: 'long' },
    };
  },
  paint(d, ctx) {
    paintPosition(d, ctx, 'long', 'long');
  },
  hit(d, ctx) {
    return hitPosition(d, ctx, 'long');
  },
});

registerToolHandler({
  id: 'short',
  label: 'Short position',
  arity: 2,
  create(points, color) {
    const pts = sanitizePoints(points);
    if (pts.length < 2) return null;
    return {
      id: '',
      kind: 'short',
      p1: pts[0]!,
      p2: pts[1]!,
      color: sanitizeStrokeColor(color, DRAWING_COLORS.down),
      meta: { direction: 'short' },
    };
  },
  paint(d, ctx) {
    paintPosition(d, ctx, 'short', 'short');
  },
  hit(d, ctx) {
    return hitPosition(d, ctx, 'short');
  },
});

void distToSegment;
void (null as Point | null);
