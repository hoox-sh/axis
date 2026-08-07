// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Lines pack — channel, horizontal ray, info line (trend + Δprice/Δ% labels).
 * Handlers registered for DrawingLayer paint/hit/create.
 */

import type { Drawing, MultiPointDrawing, Point, TwoPointDrawing } from '../../drawing-types';
import { channelEdges, distToSegment, extendSegment } from '../geometry';
import { registerToolHandler, type ToolHitCtx, type ToolViewCtx } from './registry';

function asTwo(d: Drawing): TwoPointDrawing | null {
  if (!('p1' in d) || !('p2' in d) || !d.p1 || !d.p2) return null;
  return d as TwoPointDrawing;
}

function asMulti(d: Drawing): MultiPointDrawing | null {
  if (d.kind !== 'channel' && d.kind !== 'fibchannel') return null;
  return d as MultiPointDrawing;
}

function pointsOf(d: Drawing): Point[] {
  const m = asMulti(d);
  if (m?.points?.length) return m.points;
  const t = asTwo(d);
  if (t) return [t.p1, t.p2];
  return [];
}

// ── Horizontal ray ──────────────────────────────────────────────────────────

registerToolHandler({
  id: 'hray',
  label: 'Horizontal ray',
  arity: 2,
  create(points, color) {
    if (points.length < 2) return null;
    const p1 = points[0]!;
    const p2 = points[1]!;
    return {
      id: '',
      kind: 'hray',
      p1: { time: p1.time, price: p1.price },
      p2: { time: p2.time, price: p1.price },
      color,
    };
  },
  paint(d, ctx) {
    const t = asTwo(d);
    if (!t) return;
    const a = ctx.toXY(t.p1);
    if (!a) return;
    const dir = t.p2.time >= t.p1.time ? 1 : -1;
    const x2 = dir >= 0 ? ctx.width + 8 : -8;
    ctx.line(a.x, a.y, x2, a.y, ctx.stroke, ctx.strokeWidth, ctx.dash);
    ctx.label(Math.min(a.x, x2) + 6, a.y - 4, t.p1.price.toFixed(2), ctx.stroke, 10);
    if (ctx.selected) ctx.circle(a.x, a.y, 5, ctx.stroke, true);
  },
  hit(d, ctx) {
    const t = asTwo(d);
    if (!t) return false;
    const a = ctx.toXY(t.p1);
    if (!a) return false;
    const dir = t.p2.time >= t.p1.time ? 1 : -1;
    const x2 = dir >= 0 ? ctx.width + 8 : -8;
    return distToSegment(ctx.x, ctx.y, a.x, a.y, x2, a.y) <= ctx.tol;
  },
});

// ── Info line (trend + measure label) ───────────────────────────────────────

registerToolHandler({
  id: 'infoLine',
  label: 'Info line',
  arity: 2,
  create(points, color) {
    if (points.length < 2) return null;
    return {
      id: '',
      kind: 'infoLine',
      p1: points[0]!,
      p2: points[1]!,
      color,
    };
  },
  paint(d, ctx) {
    const t = asTwo(d);
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    ctx.line(a.x, a.y, b.x, b.y, ctx.stroke, ctx.strokeWidth, ctx.dash);
    const dPrice = t.p2.price - t.p1.price;
    const pct = t.p1.price !== 0 ? (dPrice / t.p1.price) * 100 : 0;
    const bars =
      ctx.barIndexApprox != null
        ? Math.abs(ctx.barIndexApprox(t.p1.time) - ctx.barIndexApprox(t.p2.time))
        : 0;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    ctx.label(
      midX + 6,
      midY - 6,
      `${dPrice >= 0 ? '+' : ''}${dPrice.toFixed(2)} (${pct.toFixed(2)}%)${bars ? ` · ${bars}b` : ''}`,
      ctx.stroke,
      10,
    );
    ctx.circle(a.x, a.y, ctx.selected ? 5 : 3, ctx.stroke, ctx.selected);
    ctx.circle(b.x, b.y, ctx.selected ? 5 : 3, ctx.stroke, ctx.selected);
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

// ── Parallel channel (3 points) ─────────────────────────────────────────────

registerToolHandler({
  id: 'channel',
  label: 'Parallel channel',
  arity: 3,
  create(points, color) {
    if (points.length < 3) return null;
    const [p1, p2, p3] = points;
    return {
      id: '',
      kind: 'channel',
      points: [p1!, p2!, p3!],
      p1: p1!,
      p2: p2!,
      p3: p3!,
      color,
      fillOpacity: 0.08,
    } as MultiPointDrawing;
  },
  paint(d, ctx) {
    const pts = pointsOf(d);
    if (pts.length < 3) return;
    const edges = channelEdges(pts[0]!, pts[1]!, pts[2]!);
    const a1 = ctx.toXY(edges.a1);
    const a2 = ctx.toXY(edges.a2);
    const b1 = ctx.toXY(edges.b1);
    const b2 = ctx.toXY(edges.b2);
    if (!a1 || !a2 || !b1 || !b2) return;
    // Extend rails
    const eA = extendSegment(a1.x, a1.y, a2.x, a2.y, 'both', ctx.width, ctx.height);
    const eB = extendSegment(b1.x, b1.y, b2.x, b2.y, 'both', ctx.width, ctx.height);
    // Fill polygon (approx as quad)
    ctx.el('polygon', {
      points: `${eA.x1},${eA.y1} ${eA.x2},${eA.y2} ${eB.x2},${eB.y2} ${eB.x1},${eB.y1}`,
      fill: ctx.stroke,
      'fill-opacity': String(ctx.fillOpacity),
      stroke: 'none',
      'pointer-events': 'none',
    });
    ctx.line(eA.x1, eA.y1, eA.x2, eA.y2, ctx.stroke, ctx.strokeWidth, ctx.dash);
    ctx.line(eB.x1, eB.y1, eB.x2, eB.y2, ctx.stroke, ctx.strokeWidth, ctx.dash);
    // Midline
    const mx1 = (eA.x1 + eB.x1) / 2;
    const my1 = (eA.y1 + eB.y1) / 2;
    const mx2 = (eA.x2 + eB.x2) / 2;
    const my2 = (eA.y2 + eB.y2) / 2;
    ctx.line(mx1, my1, mx2, my2, ctx.stroke, Math.max(1, ctx.strokeWidth - 0.5), '4 4');
    if (ctx.selected) {
      for (const p of [a1, a2, b1]) ctx.circle(p.x, p.y, 5, ctx.stroke, true);
    }
  },
  hit(d, ctx) {
    const pts = pointsOf(d);
    if (pts.length < 3) return false;
    const edges = channelEdges(pts[0]!, pts[1]!, pts[2]!);
    const a1 = ctx.toXY(edges.a1);
    const a2 = ctx.toXY(edges.a2);
    const b1 = ctx.toXY(edges.b1);
    const b2 = ctx.toXY(edges.b2);
    if (!a1 || !a2 || !b1 || !b2) return false;
    const eA = extendSegment(a1.x, a1.y, a2.x, a2.y, 'both', ctx.width, ctx.height);
    const eB = extendSegment(b1.x, b1.y, b2.x, b2.y, 'both', ctx.width, ctx.height);
    return (
      distToSegment(ctx.x, ctx.y, eA.x1, eA.y1, eA.x2, eA.y2) <= ctx.tol ||
      distToSegment(ctx.x, ctx.y, eB.x1, eB.y1, eB.x2, eB.y2) <= ctx.tol
    );
  },
  paintDraft(points, ctx) {
    if (points.length < 2) return;
    const a = ctx.toXY(points[0]!);
    const b = ctx.toXY(points[1]!);
    if (a && b) ctx.line(a.x, a.y, b.x, b.y, ctx.stroke, ctx.strokeWidth, '4 4');
    if (points.length >= 3) {
      const edges = channelEdges(points[0]!, points[1]!, points[2]!);
      const b1 = ctx.toXY(edges.b1);
      const b2 = ctx.toXY(edges.b2);
      if (b1 && b2) ctx.line(b1.x, b1.y, b2.x, b2.y, ctx.stroke, ctx.strokeWidth, '4 4');
    }
  },
});

// silence unused in type-check for hit ctx re-exports
void 0 as unknown as ToolHitCtx;
void 0 as unknown as ToolViewCtx;
