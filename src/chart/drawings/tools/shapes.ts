// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shapes pack — triangle, polyline, path.
 */

import type { Drawing, MultiPointDrawing, Point } from '../../drawing-types';
import { distToSegment, nearPoint } from '../geometry';
import { registerToolHandler } from './registry';

function pts(d: Drawing): Point[] {
  if ('points' in d && Array.isArray((d as MultiPointDrawing).points)) {
    return (d as MultiPointDrawing).points;
  }
  return [];
}

function paintPoly(points: Point[], ctx: Parameters<NonNullable<import('./registry').ToolHandler['paint']>>[1], closed: boolean) {
  const xys = points.map((p) => ctx.toXY(p)).filter(Boolean) as { x: number; y: number }[];
  if (xys.length < 2) return;
  let d = `M ${xys[0]!.x} ${xys[0]!.y}`;
  for (let i = 1; i < xys.length; i++) d += ` L ${xys[i]!.x} ${xys[i]!.y}`;
  if (closed) d += ' Z';
  ctx.el('path', {
    d,
    fill: closed ? ctx.stroke : 'none',
    'fill-opacity': closed ? String(ctx.fillOpacity) : '0',
    stroke: ctx.stroke,
    'stroke-width': String(ctx.strokeWidth),
    'pointer-events': 'stroke',
    ...(ctx.dash ? { 'stroke-dasharray': ctx.dash } : {}),
  });
  if (ctx.selected) {
    for (const p of xys) ctx.circle(p.x, p.y, 5, ctx.stroke, true);
  }
}

function hitPoly(points: Point[], ctx: Parameters<NonNullable<import('./registry').ToolHandler['hit']>>[1], closed: boolean): boolean {
  const xys = points.map((p) => ctx.toXY(p)).filter(Boolean) as { x: number; y: number }[];
  if (xys.length < 2) return false;
  for (const p of xys) {
    if (nearPoint(ctx.x, ctx.y, p.x, p.y, ctx.tol + 2)) return true;
  }
  for (let i = 0; i < xys.length - 1; i++) {
    if (distToSegment(ctx.x, ctx.y, xys[i]!.x, xys[i]!.y, xys[i + 1]!.x, xys[i + 1]!.y) <= ctx.tol) {
      return true;
    }
  }
  if (closed && xys.length >= 3) {
    return (
      distToSegment(
        ctx.x,
        ctx.y,
        xys[xys.length - 1]!.x,
        xys[xys.length - 1]!.y,
        xys[0]!.x,
        xys[0]!.y,
      ) <= ctx.tol
    );
  }
  return false;
}

registerToolHandler({
  id: 'triangle',
  label: 'Triangle',
  arity: 3,
  create(points, color) {
    if (points.length < 3) return null;
    return {
      id: '',
      kind: 'triangle',
      points: points.slice(0, 3),
      p1: points[0]!,
      p2: points[1]!,
      p3: points[2]!,
      color,
      fillOpacity: 0.12,
    } as MultiPointDrawing;
  },
  paint(d, ctx) {
    paintPoly(pts(d), ctx, true);
  },
  hit(d, ctx) {
    return hitPoly(pts(d), ctx, true);
  },
});

registerToolHandler({
  id: 'polyline',
  label: 'Polyline',
  arity: 'n',
  minPoints: 2,
  create(points, color) {
    if (points.length < 2) return null;
    return {
      id: '',
      kind: 'polyline',
      points: points.slice(),
      p1: points[0]!,
      p2: points[points.length - 1]!,
      color,
    } as MultiPointDrawing;
  },
  paint(d, ctx) {
    paintPoly(pts(d), ctx, false);
  },
  hit(d, ctx) {
    return hitPoly(pts(d), ctx, false);
  },
  paintDraft(points, ctx) {
    paintPoly(points, ctx, false);
  },
});

registerToolHandler({
  id: 'path',
  label: 'Path',
  arity: 'n',
  minPoints: 2,
  create(points, color) {
    if (points.length < 2) return null;
    return {
      id: '',
      kind: 'path',
      points: points.slice(),
      p1: points[0]!,
      p2: points[points.length - 1]!,
      color,
    } as MultiPointDrawing;
  },
  paint(d, ctx) {
    // Soft freehand: thicker stroke, rounded joins via path
    const xys = pts(d).map((p) => ctx.toXY(p)).filter(Boolean) as { x: number; y: number }[];
    if (xys.length < 2) return;
    let dAttr = `M ${xys[0]!.x} ${xys[0]!.y}`;
    for (let i = 1; i < xys.length; i++) dAttr += ` L ${xys[i]!.x} ${xys[i]!.y}`;
    ctx.el('path', {
      d: dAttr,
      fill: 'none',
      stroke: ctx.stroke,
      'stroke-width': String(Math.max(2, ctx.strokeWidth + 0.5)),
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'pointer-events': 'stroke',
      ...(ctx.dash ? { 'stroke-dasharray': ctx.dash } : {}),
    });
    if (ctx.selected) {
      for (const p of xys) ctx.circle(p.x, p.y, 4, ctx.stroke, true);
    }
  },
  hit(d, ctx) {
    return hitPoly(pts(d), ctx, false);
  },
  paintDraft(points, ctx) {
    paintPoly(points, ctx, false);
  },
});
