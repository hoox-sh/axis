// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Trading / measure extras — forecast, date+price range.
 */

import type { Drawing, TwoPointDrawing } from '../../drawing-types';
import { distToSegment, nearRectEdge } from '../geometry';
import { registerToolHandler } from './registry';

function asTwo(d: Drawing): TwoPointDrawing | null {
  if (!('p1' in d) || !('p2' in d) || !d.p1 || !d.p2) return null;
  return d as TwoPointDrawing;
}

registerToolHandler({
  id: 'forecast',
  label: 'Forecast',
  arity: 2,
  create(points, color) {
    if (points.length < 2) return null;
    return { id: '', kind: 'forecast', p1: points[0]!, p2: points[1]!, color };
  },
  paint(d, ctx) {
    const t = asTwo(d);
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    // Extend slightly past p2
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ex = b.x + (dx / len) * 24;
    const ey = b.y + (dy / len) * 24;
    ctx.line(a.x, a.y, ex, ey, ctx.stroke, ctx.strokeWidth, '6 4');
    // Arrow head
    const ang = Math.atan2(ey - a.y, ex - a.x);
    const s = 9;
    const p1x = ex - Math.cos(ang - 0.4) * s;
    const p1y = ey - Math.sin(ang - 0.4) * s;
    const p2x = ex - Math.cos(ang + 0.4) * s;
    const p2y = ey - Math.sin(ang + 0.4) * s;
    ctx.el('polygon', {
      points: `${ex},${ey} ${p1x},${p1y} ${p2x},${p2y}`,
      fill: ctx.stroke,
      stroke: ctx.stroke,
      'pointer-events': 'none',
    });
    const dPrice = t.p2.price - t.p1.price;
    const pct = t.p1.price !== 0 ? (dPrice / t.p1.price) * 100 : 0;
    ctx.label(
      (a.x + b.x) / 2 + 6,
      (a.y + b.y) / 2 - 6,
      `Forecast ${dPrice >= 0 ? '+' : ''}${dPrice.toFixed(2)} (${pct.toFixed(2)}%)`,
      ctx.stroke,
      11,
    );
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
    return distToSegment(ctx.x, ctx.y, a.x, a.y, b.x, b.y) <= ctx.tol;
  },
});

registerToolHandler({
  id: 'datePriceRange',
  label: 'Date + price range',
  arity: 2,
  create(points, color) {
    if (points.length < 2) return null;
    return {
      id: '',
      kind: 'datePriceRange',
      p1: points[0]!,
      p2: points[1]!,
      color,
      fillOpacity: 0.1,
    };
  },
  paint(d, ctx) {
    const t = asTwo(d);
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    ctx.el('rect', {
      x: String(x),
      y: String(y),
      width: String(Math.max(1, w)),
      height: String(Math.max(1, h)),
      fill: ctx.stroke,
      'fill-opacity': String(ctx.fillOpacity),
      stroke: ctx.stroke,
      'stroke-width': String(ctx.strokeWidth),
      'pointer-events': 'all',
    });
    const dPrice = t.p2.price - t.p1.price;
    const pct = t.p1.price !== 0 ? (dPrice / t.p1.price) * 100 : 0;
    const bars =
      ctx.barIndexApprox != null
        ? Math.abs(ctx.barIndexApprox(t.p1.time) - ctx.barIndexApprox(t.p2.time))
        : 0;
    ctx.label(
      x + 4,
      y + 14,
      `${bars ? `${bars} bars · ` : ''}${dPrice >= 0 ? '+' : ''}${dPrice.toFixed(2)} (${pct.toFixed(2)}%)`,
      ctx.stroke,
      11,
    );
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
    return (
      nearRectEdge(ctx.x, ctx.y, a.x, a.y, b.x, b.y, ctx.tol) ||
      (ctx.x >= Math.min(a.x, b.x) - ctx.tol &&
        ctx.x <= Math.max(a.x, b.x) + ctx.tol &&
        ctx.y >= Math.min(a.y, b.y) - ctx.tol &&
        ctx.y <= Math.max(a.y, b.y) + ctx.tol)
    );
  },
});
