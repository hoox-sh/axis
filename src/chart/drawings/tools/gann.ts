// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Gann tools — fan, box, square.
 */

import type { Drawing, Point, TwoPointDrawing } from '../../drawing-types';
import { distToSegment, extendSegment } from '../geometry';
import { registerToolHandler } from './registry';

function asTwo(d: Drawing): TwoPointDrawing | null {
  if (!('p1' in d) || !('p2' in d) || !d.p1 || !d.p2) return null;
  return d as TwoPointDrawing;
}

const GANN_RATIOS = [1 / 4, 1 / 3, 1 / 2, 1, 2, 3, 4] as const;

registerToolHandler({
  id: 'gannFan',
  label: 'Gann fan',
  arity: 2,
  create(points, color) {
    if (points.length < 2) return null;
    return { id: '', kind: 'gannFan', p1: points[0]!, p2: points[1]!, color };
  },
  paint(d, ctx) {
    const t = asTwo(d);
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    const baseDx = b.x - a.x;
    const baseDy = b.y - a.y;
    const baseAng = Math.atan2(baseDy, baseDx);
    const baseLen = Math.hypot(baseDx, baseDy) || 1;
    // 1x1 is the baseline; other ratios tilt price vs time
    for (const r of GANN_RATIOS) {
      // Scale vertical component by ratio (1 = baseline)
      const ang = Math.atan2(Math.sin(baseAng) * r, Math.cos(baseAng));
      const x2 = a.x + Math.cos(ang) * baseLen;
      const y2 = a.y + Math.sin(ang) * baseLen;
      const ext = extendSegment(a.x, a.y, x2, y2, 'right', ctx.width, ctx.height);
      ctx.line(ext.x1, ext.y1, ext.x2, ext.y2, ctx.stroke, r === 1 ? ctx.strokeWidth : Math.max(1, ctx.strokeWidth - 0.5), r === 1 ? undefined : '3 3');
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
    const baseDx = b.x - a.x;
    const baseDy = b.y - a.y;
    const baseAng = Math.atan2(baseDy, baseDx);
    const baseLen = Math.hypot(baseDx, baseDy) || 1;
    for (const r of GANN_RATIOS) {
      const ang = Math.atan2(Math.sin(baseAng) * r, Math.cos(baseAng));
      const x2 = a.x + Math.cos(ang) * baseLen;
      const y2 = a.y + Math.sin(ang) * baseLen;
      const ext = extendSegment(a.x, a.y, x2, y2, 'right', ctx.width, ctx.height);
      if (distToSegment(ctx.x, ctx.y, ext.x1, ext.y1, ext.x2, ext.y2) <= ctx.tol) return true;
    }
    return false;
  },
});

registerToolHandler({
  id: 'gannBox',
  label: 'Gann box',
  arity: 2,
  create(points, color) {
    if (points.length < 2) return null;
    return { id: '', kind: 'gannBox', p1: points[0]!, p2: points[1]!, color, fillOpacity: 0.06 };
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
    for (const f of [0.25, 0.5, 0.75]) {
      ctx.line(x + w * f, y, x + w * f, y + h, ctx.stroke, 1, '2 2');
      ctx.line(x, y + h * f, x + w, y + h * f, ctx.stroke, 1, '2 2');
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
    const minX = Math.min(a.x, b.x) - ctx.tol;
    const maxX = Math.max(a.x, b.x) + ctx.tol;
    const minY = Math.min(a.y, b.y) - ctx.tol;
    const maxY = Math.max(a.y, b.y) + ctx.tol;
    return ctx.x >= minX && ctx.x <= maxX && ctx.y >= minY && ctx.y <= maxY;
  },
});

registerToolHandler({
  id: 'gannSquare',
  label: 'Gann square',
  arity: 2,
  create(points, color) {
    if (points.length < 2) return null;
    return { id: '', kind: 'gannSquare', p1: points[0]!, p2: points[1]!, color, fillOpacity: 0.05 };
  },
  paint(d, ctx) {
    const t = asTwo(d);
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 8);
    const sx = b.x >= a.x ? 1 : -1;
    const sy = b.y >= a.y ? 1 : -1;
    const x2 = a.x + sx * side;
    const y2 = a.y + sy * side;
    const x = Math.min(a.x, x2);
    const y = Math.min(a.y, y2);
    ctx.el('rect', {
      x: String(x),
      y: String(y),
      width: String(side),
      height: String(side),
      fill: ctx.stroke,
      'fill-opacity': String(ctx.fillOpacity),
      stroke: ctx.stroke,
      'stroke-width': String(ctx.strokeWidth),
      'pointer-events': 'all',
    });
    ctx.line(a.x, a.y, x2, y2, ctx.stroke, 1, '3 3');
    ctx.line(a.x, y2, x2, a.y, ctx.stroke, 1, '3 3');
    if (ctx.selected) {
      ctx.circle(a.x, a.y, 5, ctx.stroke, true);
      ctx.circle(x2, y2, 5, ctx.stroke, true);
    }
  },
  hit(d, ctx) {
    const t = asTwo(d);
    if (!t) return false;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return false;
    const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 8);
    const sx = b.x >= a.x ? 1 : -1;
    const sy = b.y >= a.y ? 1 : -1;
    const x2 = a.x + sx * side;
    const y2 = a.y + sy * side;
    const minX = Math.min(a.x, x2) - ctx.tol;
    const maxX = Math.max(a.x, x2) + ctx.tol;
    const minY = Math.min(a.y, y2) - ctx.tol;
    const maxY = Math.max(a.y, y2) + ctx.tol;
    return ctx.x >= minX && ctx.x <= maxX && ctx.y >= minY && ctx.y <= maxY;
  },
});

void (null as Point | null);
