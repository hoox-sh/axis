// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shapes pack — triangle, polyline, path.
 */

import type { Drawing, MultiPointDrawing, Point } from '../../drawing-types';
import { distToSegment, nearPoint } from '../geometry';
import { registerToolHandler } from './registry';
import {
  DRAWING_POINTS_MAX,
  clampOpacity,
  clampStrokeWidth,
  sanitizePoints,
  sanitizeStrokeColor,
} from './safe';

/** Cap selection handles on long freehand paths (DOM thrash guard). */
const SELECTED_HANDLES_MAX = 48;

function pts(d: Drawing): Point[] {
  if ('points' in d && Array.isArray((d as MultiPointDrawing).points)) {
    return sanitizePoints((d as MultiPointDrawing).points);
  }
  return [];
}

/** Evenly sample up to `max` indices including first and last. */
function sampleHandleIndices(len: number, max: number): number[] {
  if (len <= 0) return [];
  if (len <= max) return Array.from({ length: len }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    out.push(Math.round((i * (len - 1)) / (max - 1)));
  }
  return out;
}

function paintPoly(points: Point[], ctx: Parameters<NonNullable<import('./registry').ToolHandler['paint']>>[1], closed: boolean) {
  const xys = points.map((p) => ctx.toXY(p)).filter(Boolean) as { x: number; y: number }[];
  if (xys.length < 2) return;
  const sw = clampStrokeWidth(ctx.strokeWidth);
  let d = `M ${xys[0]!.x} ${xys[0]!.y}`;
  for (let i = 1; i < xys.length; i++) d += ` L ${xys[i]!.x} ${xys[i]!.y}`;
  if (closed) d += ' Z';
  ctx.el('path', {
    d,
    fill: closed ? ctx.stroke : 'none',
    'fill-opacity': closed ? String(clampOpacity(ctx.fillOpacity, 0.12)) : '0',
    stroke: ctx.stroke,
    'stroke-width': String(sw),
    'pointer-events': 'stroke',
    ...(ctx.dash ? { 'stroke-dasharray': ctx.dash } : {}),
  });
  if (ctx.selected) {
    for (const i of sampleHandleIndices(xys.length, SELECTED_HANDLES_MAX)) {
      const p = xys[i]!;
      ctx.circle(p.x, p.y, 5, ctx.stroke, true);
    }
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
    const p = sanitizePoints(points);
    if (p.length < 3) return null;
    return {
      id: '',
      kind: 'triangle',
      points: p.slice(0, 3),
      p1: p[0]!,
      p2: p[1]!,
      p3: p[2]!,
      color: sanitizeStrokeColor(color),
      fillOpacity: 0.12,
    } as MultiPointDrawing;
  },
  paint(d, ctx) {
    if (d.kind !== 'triangle') return;
    paintPoly(pts(d), ctx, true);
  },
  hit(d, ctx) {
    if (d.kind !== 'triangle') return false;
    return hitPoly(pts(d), ctx, true);
  },
});

registerToolHandler({
  id: 'polyline',
  label: 'Polyline',
  arity: 'n',
  minPoints: 2,
  create(points, color) {
    const p = sanitizePoints(points, DRAWING_POINTS_MAX);
    if (p.length < 2) return null;
    return {
      id: '',
      kind: 'polyline',
      points: p,
      p1: p[0]!,
      p2: p[p.length - 1]!,
      color: sanitizeStrokeColor(color),
    } as MultiPointDrawing;
  },
  paint(d, ctx) {
    if (d.kind !== 'polyline') return;
    paintPoly(pts(d), ctx, false);
  },
  hit(d, ctx) {
    if (d.kind !== 'polyline') return false;
    return hitPoly(pts(d), ctx, false);
  },
  paintDraft(points, ctx) {
    paintPoly(sanitizePoints(points, DRAWING_POINTS_MAX), ctx, false);
  },
});

registerToolHandler({
  id: 'path',
  label: 'Path',
  arity: 'n',
  minPoints: 2,
  create(points, color) {
    const p = sanitizePoints(points, DRAWING_POINTS_MAX);
    if (p.length < 2) return null;
    return {
      id: '',
      kind: 'path',
      points: p,
      p1: p[0]!,
      p2: p[p.length - 1]!,
      color: sanitizeStrokeColor(color),
    } as MultiPointDrawing;
  },
  paint(d, ctx) {
    if (d.kind !== 'path') return;
    // Soft freehand: thicker stroke, rounded joins via path
    const xys = pts(d).map((p) => ctx.toXY(p)).filter(Boolean) as { x: number; y: number }[];
    if (xys.length < 2) return;
    const sw = Math.max(2, clampStrokeWidth(ctx.strokeWidth) + 0.5);
    let dAttr = `M ${xys[0]!.x} ${xys[0]!.y}`;
    for (let i = 1; i < xys.length; i++) dAttr += ` L ${xys[i]!.x} ${xys[i]!.y}`;
    ctx.el('path', {
      d: dAttr,
      fill: 'none',
      stroke: ctx.stroke,
      'stroke-width': String(sw),
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'pointer-events': 'stroke',
      ...(ctx.dash ? { 'stroke-dasharray': ctx.dash } : {}),
    });
    if (ctx.selected) {
      for (const i of sampleHandleIndices(xys.length, SELECTED_HANDLES_MAX)) {
        const p = xys[i]!;
        ctx.circle(p.x, p.y, 4, ctx.stroke, true);
      }
    }
  },
  hit(d, ctx) {
    if (d.kind !== 'path') return false;
    return hitPoly(pts(d), ctx, false);
  },
  paintDraft(points, ctx) {
    paintPoly(sanitizePoints(points, DRAWING_POINTS_MAX), ctx, false);
  },
});
