// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Extra shapes — rotated rect, arc, curve.
 */

import type { Drawing, TwoPointDrawing } from '../../drawing-types';
import { distToSegment } from '../geometry';
import { registerToolHandler } from './registry';

function asTwo(d: Drawing): TwoPointDrawing | null {
  if (!('p1' in d) || !('p2' in d) || !d.p1 || !d.p2) return null;
  return d as TwoPointDrawing;
}

registerToolHandler({
  id: 'rotatedRect',
  label: 'Rotated rectangle',
  arity: 2,
  create(points, color) {
    if (points.length < 2) return null;
    return {
      id: '',
      kind: 'rotatedRect',
      p1: points[0]!,
      p2: points[1]!,
      color,
      fillOpacity: 0.12,
    };
  },
  paint(d, ctx) {
    const t = asTwo(d);
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = (-dy / len) * (len * 0.35);
    const py = (dx / len) * (len * 0.35);
    const pts = [
      [a.x + px, a.y + py],
      [b.x + px, b.y + py],
      [b.x - px, b.y - py],
      [a.x - px, a.y - py],
    ];
    ctx.el('polygon', {
      points: pts.map((p) => `${p[0]},${p[1]}`).join(' '),
      fill: ctx.stroke,
      'fill-opacity': String(ctx.fillOpacity),
      stroke: ctx.stroke,
      'stroke-width': String(ctx.strokeWidth),
      'pointer-events': 'all',
      ...(ctx.dash ? { 'stroke-dasharray': ctx.dash } : {}),
    });
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
    return distToSegment(ctx.x, ctx.y, a.x, a.y, b.x, b.y) <= ctx.tol + 12;
  },
});

registerToolHandler({
  id: 'arc',
  label: 'Arc',
  arity: 2,
  create(points, color) {
    if (points.length < 2) return null;
    return { id: '', kind: 'arc', p1: points[0]!, p2: points[1]!, color };
  },
  paint(d, ctx) {
    const t = asTwo(d);
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // Control bulge perpendicular
    const cx = mx - (dy / len) * (len * 0.5);
    const cy = my + (dx / len) * (len * 0.5);
    // Approximate circle through A, control, B via SVG quadratic then arc-like cubic
    ctx.el('path', {
      d: `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`,
      fill: 'none',
      stroke: ctx.stroke,
      'stroke-width': String(ctx.strokeWidth),
      'pointer-events': 'stroke',
      ...(ctx.dash ? { 'stroke-dasharray': ctx.dash } : {}),
    });
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
    // Sample quadratic
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const cx = mx - (dy / len) * (len * 0.5);
    const cy = my + (dx / len) * (len * 0.5);
    let prev = a;
    for (let i = 1; i <= 16; i++) {
      const u = i / 16;
      const x = (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * cx + u * u * b.x;
      const y = (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * cy + u * u * b.y;
      if (distToSegment(ctx.x, ctx.y, prev.x, prev.y, x, y) <= ctx.tol) return true;
      prev = { x, y };
    }
    return false;
  },
});

registerToolHandler({
  id: 'curve',
  label: 'Curve',
  arity: 2,
  create(points, color) {
    if (points.length < 2) return null;
    return { id: '', kind: 'curve', p1: points[0]!, p2: points[1]!, color };
  },
  paint(d, ctx) {
    const t = asTwo(d);
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // S-curve: two control points opposite perpendiculars
    const c1x = a.x + dx * 0.35 - (dy / len) * (len * 0.25);
    const c1y = a.y + dy * 0.35 + (dx / len) * (len * 0.25);
    const c2x = a.x + dx * 0.65 + (dy / len) * (len * 0.25);
    const c2y = a.y + dy * 0.65 - (dx / len) * (len * 0.25);
    ctx.el('path', {
      d: `M ${a.x} ${a.y} C ${c1x} ${c1y} ${c2x} ${c2y} ${b.x} ${b.y}`,
      fill: 'none',
      stroke: ctx.stroke,
      'stroke-width': String(ctx.strokeWidth),
      'pointer-events': 'stroke',
      ...(ctx.dash ? { 'stroke-dasharray': ctx.dash } : {}),
    });
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
    return distToSegment(ctx.x, ctx.y, a.x, a.y, b.x, b.y) <= ctx.tol + 8;
  },
});
