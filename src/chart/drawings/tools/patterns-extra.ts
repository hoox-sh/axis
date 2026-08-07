// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pattern tools — XABCD and head & shoulders.
 */

import type { Drawing, MultiPointDrawing, Point } from '../../drawing-types';
import { distToSegment, nearPoint } from '../geometry';
import { registerToolHandler, type ToolViewCtx } from './registry';

function pts(d: Drawing): Point[] {
  if ('points' in d && Array.isArray((d as MultiPointDrawing).points)) {
    return (d as MultiPointDrawing).points;
  }
  return [];
}

function paintLabeledPoly(
  points: Point[],
  labels: string[],
  ctx: ToolViewCtx,
  closed = false,
) {
  const xys = points.map((p) => ctx.toXY(p)).filter(Boolean) as { x: number; y: number }[];
  if (xys.length < 2) return;
  let d = `M ${xys[0]!.x} ${xys[0]!.y}`;
  for (let i = 1; i < xys.length; i++) d += ` L ${xys[i]!.x} ${xys[i]!.y}`;
  if (closed) d += ' Z';
  ctx.el('path', {
    d,
    fill: 'none',
    stroke: ctx.stroke,
    'stroke-width': String(ctx.strokeWidth),
    'pointer-events': 'stroke',
    ...(ctx.dash ? { 'stroke-dasharray': ctx.dash } : {}),
  });
  for (let i = 0; i < xys.length; i++) {
    const p = xys[i]!;
    ctx.circle(p.x, p.y, ctx.selected ? 5 : 3, ctx.stroke, ctx.selected);
    if (labels[i]) ctx.label(p.x + 5, p.y - 5, labels[i]!, ctx.stroke, 10);
  }
}

function hitPoly(points: Point[], ctx: Parameters<NonNullable<import('./registry').ToolHandler['hit']>>[1]): boolean {
  const xys = points.map((p) => ctx.toXY(p)).filter(Boolean) as { x: number; y: number }[];
  for (const p of xys) {
    if (nearPoint(ctx.x, ctx.y, p.x, p.y, ctx.tol + 3)) return true;
  }
  for (let i = 0; i < xys.length - 1; i++) {
    if (distToSegment(ctx.x, ctx.y, xys[i]!.x, xys[i]!.y, xys[i + 1]!.x, xys[i + 1]!.y) <= ctx.tol) {
      return true;
    }
  }
  return false;
}

registerToolHandler({
  id: 'xabcd',
  label: 'XABCD pattern',
  arity: 'n',
  minPoints: 5,
  create(points, color) {
    if (points.length < 5) return null;
    const five = points.slice(0, 5);
    return {
      id: '',
      kind: 'xabcd',
      points: five,
      p1: five[0]!,
      p2: five[4]!,
      color,
    } as MultiPointDrawing;
  },
  paint(d, ctx) {
    const p = pts(d).slice(0, 5);
    if (p.length < 5) return;
    paintLabeledPoly(p, ['X', 'A', 'B', 'C', 'D'], ctx);
    // Ratio labels (price ratios)
    const segs = [
      { a: 0, b: 1, name: 'XA' },
      { a: 1, b: 2, name: 'AB' },
      { a: 2, b: 3, name: 'BC' },
      { a: 3, b: 4, name: 'CD' },
    ];
    const xa = Math.abs(p[1]!.price - p[0]!.price) || 1;
    for (const s of segs) {
      const span = Math.abs(p[s.b]!.price - p[s.a]!.price);
      const ratio = span / xa;
      const pa = ctx.toXY(p[s.a]!);
      const pb = ctx.toXY(p[s.b]!);
      if (!pa || !pb) continue;
      ctx.label((pa.x + pb.x) / 2 + 4, (pa.y + pb.y) / 2, `${s.name} ${ratio.toFixed(3)}`, ctx.stroke, 9);
    }
  },
  hit(d, ctx) {
    return hitPoly(pts(d).slice(0, 5), ctx);
  },
  paintDraft(points, ctx) {
    paintLabeledPoly(points, ['X', 'A', 'B', 'C', 'D'], ctx);
  },
});

registerToolHandler({
  id: 'headShoulders',
  label: 'Head & shoulders',
  arity: 'n',
  minPoints: 5,
  create(points, color) {
    if (points.length < 5) return null;
    const five = points.slice(0, 5);
    return {
      id: '',
      kind: 'headShoulders',
      points: five,
      p1: five[0]!,
      p2: five[4]!,
      color,
    } as MultiPointDrawing;
  },
  paint(d, ctx) {
    const p = pts(d).slice(0, 5);
    if (p.length < 5) return;
    // LS, LH, H, RH, RS
    paintLabeledPoly(p, ['LS', '·', 'H', '·', 'RS'], ctx);
    // Neckline: LS to RS (first to last)
    const a = ctx.toXY(p[0]!);
    const b = ctx.toXY(p[4]!);
    if (a && b) {
      ctx.line(a.x, a.y, b.x, b.y, ctx.stroke, Math.max(1, ctx.strokeWidth - 0.25), '4 3');
      ctx.label((a.x + b.x) / 2, (a.y + b.y) / 2 - 8, 'neckline', ctx.stroke, 9);
    }
  },
  hit(d, ctx) {
    return hitPoly(pts(d).slice(0, 5), ctx);
  },
  paintDraft(points, ctx) {
    paintLabeledPoly(points, ['LS', '·', 'H', '·', 'RS'], ctx);
  },
});
