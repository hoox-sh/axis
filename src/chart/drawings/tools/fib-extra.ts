// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Extra Fibonacci tools — arc, wedge, circles.
 */

import { FIB_LEVELS, type Drawing, type MultiPointDrawing, type Point, type TwoPointDrawing } from '../../drawing-types';
import { distToSegment, nearPoint } from '../geometry';
import { registerToolHandler } from './registry';

function asTwo(d: Drawing): TwoPointDrawing | null {
  if (!('p1' in d) || !('p2' in d) || !d.p1 || !d.p2) return null;
  return d as TwoPointDrawing;
}

function pts(d: Drawing): Point[] {
  if ('points' in d && Array.isArray((d as MultiPointDrawing).points)) {
    return (d as MultiPointDrawing).points;
  }
  return [];
}

registerToolHandler({
  id: 'fibArc',
  label: 'Fib arc',
  arity: 2,
  create(points, color) {
    if (points.length < 2) return null;
    return { id: '', kind: 'fibArc', p1: points[0]!, p2: points[1]!, color };
  },
  paint(d, ctx) {
    const t = asTwo(d);
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    const R = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const startAng = Math.atan2(b.y - a.y, b.x - a.x);
    for (const lvl of FIB_LEVELS) {
      if (lvl <= 0) continue;
      const r = R * lvl;
      // Semicircle arc toward p2 side
      const x1 = a.x + Math.cos(startAng - Math.PI / 2) * r;
      const y1 = a.y + Math.sin(startAng - Math.PI / 2) * r;
      const x2 = a.x + Math.cos(startAng + Math.PI / 2) * r;
      const y2 = a.y + Math.sin(startAng + Math.PI / 2) * r;
      ctx.el('path', {
        d: `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`,
        fill: 'none',
        stroke: ctx.stroke,
        'stroke-width': String(Math.max(1, ctx.strokeWidth - 0.25)),
        'stroke-dasharray': lvl === 0.5 || lvl === 1 ? '0' : '3 3',
        'pointer-events': 'stroke',
      });
    }
    ctx.line(a.x, a.y, b.x, b.y, ctx.stroke, 1, '2 2');
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
    const R = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const dist = Math.hypot(ctx.x - a.x, ctx.y - a.y);
    for (const lvl of FIB_LEVELS) {
      if (lvl <= 0) continue;
      if (Math.abs(dist - R * lvl) <= ctx.tol + 2) return true;
    }
    return distToSegment(ctx.x, ctx.y, a.x, a.y, b.x, b.y) <= ctx.tol;
  },
});

registerToolHandler({
  id: 'fibWedge',
  label: 'Fib wedge',
  arity: 3,
  create(points, color) {
    if (points.length < 3) return null;
    return {
      id: '',
      kind: 'fibWedge',
      points: points.slice(0, 3),
      p1: points[0]!,
      p2: points[1]!,
      p3: points[2]!,
      color,
    } as MultiPointDrawing;
  },
  paint(d, ctx) {
    const p = pts(d);
    if (p.length < 3) return;
    const a = ctx.toXY(p[0]!);
    const b = ctx.toXY(p[1]!);
    const c = ctx.toXY(p[2]!);
    if (!a || !b || !c) return;
    const ang1 = Math.atan2(b.y - a.y, b.x - a.x);
    const ang2 = Math.atan2(c.y - a.y, c.x - a.x);
    let dAng = ang2 - ang1;
    while (dAng > Math.PI) dAng -= 2 * Math.PI;
    while (dAng < -Math.PI) dAng += 2 * Math.PI;
    const len = Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - a.x, c.y - a.y), 40);
    const scale = (Math.max(ctx.width, ctx.height) * 2) / len;
    for (const lvl of FIB_LEVELS) {
      const ang = ang1 + dAng * lvl;
      const x2 = a.x + Math.cos(ang) * len * scale;
      const y2 = a.y + Math.sin(ang) * len * scale;
      ctx.line(a.x, a.y, x2, y2, ctx.stroke, lvl === 0 || lvl === 1 ? ctx.strokeWidth : 1, lvl === 0 || lvl === 1 ? undefined : '3 3');
    }
    if (ctx.selected) {
      ctx.circle(a.x, a.y, 5, ctx.stroke, true);
      ctx.circle(b.x, b.y, 5, ctx.stroke, true);
      ctx.circle(c.x, c.y, 5, ctx.stroke, true);
    }
  },
  hit(d, ctx) {
    const p = pts(d);
    if (p.length < 3) return false;
    const a = ctx.toXY(p[0]!);
    const b = ctx.toXY(p[1]!);
    const c = ctx.toXY(p[2]!);
    if (!a || !b || !c) return false;
    return (
      distToSegment(ctx.x, ctx.y, a.x, a.y, b.x, b.y) <= ctx.tol ||
      distToSegment(ctx.x, ctx.y, a.x, a.y, c.x, c.y) <= ctx.tol
    );
  },
});

registerToolHandler({
  id: 'fibCircles',
  label: 'Fib circles',
  arity: 2,
  create(points, color) {
    if (points.length < 2) return null;
    return { id: '', kind: 'fibCircles', p1: points[0]!, p2: points[1]!, color };
  },
  paint(d, ctx) {
    const t = asTwo(d);
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    const R = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    for (const lvl of FIB_LEVELS) {
      if (lvl <= 0) continue;
      const r = R * lvl;
      ctx.el('circle', {
        cx: String(a.x),
        cy: String(a.y),
        r: String(r),
        fill: 'none',
        stroke: ctx.stroke,
        'stroke-width': String(Math.max(1, ctx.strokeWidth - 0.25)),
        'stroke-dasharray': lvl === 1 ? '0' : '3 3',
        'pointer-events': 'stroke',
      });
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
    const R = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const dist = Math.hypot(ctx.x - a.x, ctx.y - a.y);
    for (const lvl of FIB_LEVELS) {
      if (lvl <= 0) continue;
      if (Math.abs(dist - R * lvl) <= ctx.tol + 2) return true;
    }
    return nearPoint(ctx.x, ctx.y, a.x, a.y, ctx.tol);
  },
});
