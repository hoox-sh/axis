// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Fibonacci pack — extension (3-pt), time zones, fib channel.
 */

import {
  type Drawing,
  type MultiPointDrawing,
  type Point,
  type TwoPointDrawing,
} from '../../drawing-types';
import { channelEdges, distToSegment, fibExtensionPrices, fibPrices } from '../geometry';
import {
  defaultExtendFlags,
  extendModeOf,
  fibLevelsOf,
  isFibReversed,
  showPctOf,
  showPriceOf,
} from '../tool-settings';
import { registerToolHandler } from './registry';
import { isFinitePoint, sanitizePoints, sanitizeStrokeColor } from './safe';

function asTwo(d: Drawing, kind?: TwoPointDrawing['kind']): TwoPointDrawing | null {
  if (kind && d.kind !== kind) return null;
  if (!('p1' in d) || !('p2' in d) || !d.p1 || !d.p2) return null;
  if (!isFinitePoint(d.p1) || !isFinitePoint(d.p2)) return null;
  return d as TwoPointDrawing;
}

function pts(d: Drawing): Point[] {
  if ('points' in d && Array.isArray((d as MultiPointDrawing).points)) {
    return sanitizePoints((d as MultiPointDrawing).points);
  }
  const t = asTwo(d);
  return t ? [t.p1, t.p2] : [];
}

// ── Fib extension (A-B-C: project from C using AB span) ─────────────────────

registerToolHandler({
  id: 'fibext',
  label: 'Fib extension',
  arity: 3,
  create(points, color) {
    const p = sanitizePoints(points);
    if (p.length < 3) return null;
    return {
      id: '',
      kind: 'fibext',
      points: p.slice(0, 3),
      p1: p[0]!,
      p2: p[1]!,
      p3: p[2]!,
      color: sanitizeStrokeColor(color),
    } as MultiPointDrawing;
  },
  paint(d, ctx) {
    if (d.kind !== 'fibext') return;
    const p = pts(d);
    if (p.length < 3) return;
    const [a, b, c] = p;
    const ax = ctx.toXY(a!);
    const bx = ctx.toXY(b!);
    const cx = ctx.toXY(c!);
    if (!ax || !bx || !cx) return;
    // Base move AB + AC guide
    ctx.line(ax.x, ax.y, bx.x, bx.y, ctx.stroke, 1, '2 2');
    ctx.line(bx.x, bx.y, cx.x, cyFix(bx, cx).y, ctx.stroke, 1, '2 2');
    const span = Math.abs(b!.price - a!.price) || 1;
    const reverse = isFibReversed(d);
    const dir = reverse
      ? b!.price >= a!.price
        ? -1
        : 1
      : b!.price >= a!.price
        ? 1
        : -1;
    const x1 = Math.min(ax.x, bx.x, cx.x);
    const ext = defaultExtendFlags('fibext');
    const mode = extendModeOf(d, ext);
    let right = Math.max(ax.x, bx.x, cx.x);
    if (mode === 'right' || mode === 'both') right = Math.max(right, ctx.width - 8);
    let left = x1;
    if (mode === 'left' || mode === 'both') left = Math.min(x1, 8);
    const levels = fibLevelsOf(d);
    const showPct = showPctOf(d, true);
    const showPx = showPriceOf(d, true);
    for (const lvl of levels) {
      const price = c!.price + dir * span * lvl;
      const y = ctx.priceToY(price);
      if (y == null) continue;
      ctx.line(left, y, right, y, ctx.stroke, Math.max(1, ctx.strokeWidth - 0.5), lvl === 1 ? undefined : '3 3');
      if (showPct || showPx) {
        const bits: string[] = [];
        if (showPct) bits.push(`${(lvl * 100).toFixed(1)}%`);
        if (showPx) bits.push(price.toFixed(2));
        ctx.label(right - 4, y - 3, bits.join('  '), ctx.stroke, 10, 'end');
      }
    }
    if (ctx.selected) {
      ctx.circle(ax.x, ax.y, 5, ctx.stroke, true);
      ctx.circle(bx.x, bx.y, 5, ctx.stroke, true);
      ctx.circle(cx.x, cx.y, 5, ctx.stroke, true);
    }
  },
  hit(d, ctx) {
    if (d.kind !== 'fibext') return false;
    const p = pts(d);
    if (p.length < 3) return false;
    for (let i = 0; i < 3; i++) {
      const xy = ctx.toXY(p[i]!);
      if (xy && Math.hypot(ctx.x - xy.x, ctx.y - xy.y) <= ctx.tol + 2) return true;
    }
    // Hit level lines loosely
    const [a, b, c] = p;
    const span = Math.abs(b!.price - a!.price) || 1;
    const reverse = isFibReversed(d);
    const dir = reverse
      ? b!.price >= a!.price
        ? -1
        : 1
      : b!.price >= a!.price
        ? 1
        : -1;
    for (const lvl of fibLevelsOf(d)) {
      const price = c!.price + dir * span * lvl;
      const y = ctx.priceToY(price);
      if (y != null && Math.abs(ctx.y - y) <= ctx.tol) return true;
    }
    return false;
  },
});

function cyFix(
  _b: { x: number; y: number },
  c: { x: number; y: number },
): { x: number; y: number } {
  return c;
}

// ── Fib time zones (verticals at fib multiples of AB time span) ─────────────

registerToolHandler({
  id: 'fibtime',
  label: 'Fib time zones',
  arity: 2,
  create(points, color) {
    const p = sanitizePoints(points);
    if (p.length < 2) return null;
    return {
      id: '',
      kind: 'fibtime',
      p1: p[0]!,
      p2: p[1]!,
      color: sanitizeStrokeColor(color),
    };
  },
  paint(d, ctx) {
    const t = asTwo(d, 'fibtime');
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    const dt = t.p2.time - t.p1.time || 1;
    const levels = fibLevelsOf(d);
    const showPct = showPctOf(d, true);
    for (const lvl of levels) {
      const time = t.p1.time + dt * (isFibReversed(d) ? -lvl : lvl);
      const x = ctx.timeToX(time);
      if (x == null) continue;
      ctx.line(x, 0, x, ctx.height, ctx.stroke, Math.max(1, ctx.strokeWidth - 0.5), lvl === 0 || lvl === 1 ? undefined : '3 3');
      if (showPct) ctx.label(x + 3, 12, String(lvl), ctx.stroke, 10);
    }
    if (ctx.selected) {
      ctx.circle(a.x, a.y, 5, ctx.stroke, true);
      ctx.circle(b.x, b.y, 5, ctx.stroke, true);
    }
  },
  hit(d, ctx) {
    const t = asTwo(d, 'fibtime');
    if (!t) return false;
    const dt = t.p2.time - t.p1.time || 1;
    for (const lvl of fibLevelsOf(d)) {
      const x = ctx.timeToX(t.p1.time + dt * (isFibReversed(d) ? -lvl : lvl));
      if (x != null && Math.abs(ctx.x - x) <= ctx.tol) return true;
    }
    return false;
  },
});

// ── Fib channel (3-pt channel + fib levels between rails) ───────────────────

registerToolHandler({
  id: 'fibchannel',
  label: 'Fib channel',
  arity: 3,
  create(points, color) {
    const p = sanitizePoints(points);
    if (p.length < 3) return null;
    return {
      id: '',
      kind: 'fibchannel',
      points: p.slice(0, 3),
      p1: p[0]!,
      p2: p[1]!,
      p3: p[2]!,
      color: sanitizeStrokeColor(color),
      fillOpacity: 0.06,
    } as MultiPointDrawing;
  },
  paint(d, ctx) {
    if (d.kind !== 'fibchannel') return;
    const p = pts(d);
    if (p.length < 3) return;
    const edges = channelEdges(p[0]!, p[1]!, p[2]!);
    const a1 = ctx.toXY(edges.a1);
    const a2 = ctx.toXY(edges.a2);
    const b1 = ctx.toXY(edges.b1);
    const b2 = ctx.toXY(edges.b2);
    if (!a1 || !a2 || !b1 || !b2) return;
    ctx.line(a1.x, a1.y, a2.x, a2.y, ctx.stroke, ctx.strokeWidth);
    ctx.line(b1.x, b1.y, b2.x, b2.y, ctx.stroke, ctx.strokeWidth);
    const levels = fibLevelsOf(d);
    for (const lvl of levels) {
      if (lvl === 0 || lvl === 1) continue;
      const t = isFibReversed(d) ? 1 - lvl : lvl;
      const x1 = a1.x + (b1.x - a1.x) * t;
      const y1 = a1.y + (b1.y - a1.y) * t;
      const x2 = a2.x + (b2.x - a2.x) * t;
      const y2 = a2.y + (b2.y - a2.y) * t;
      ctx.line(x1, y1, x2, y2, ctx.stroke, Math.max(1, ctx.strokeWidth - 0.5), '3 3');
    }
    if (ctx.selected) {
      ctx.circle(a1.x, a1.y, 5, ctx.stroke, true);
      ctx.circle(a2.x, a2.y, 5, ctx.stroke, true);
      ctx.circle(b1.x, b1.y, 5, ctx.stroke, true);
    }
  },
  hit(d, ctx) {
    if (d.kind !== 'fibchannel') return false;
    const p = pts(d);
    if (p.length < 3) return false;
    const edges = channelEdges(p[0]!, p[1]!, p[2]!);
    const a1 = ctx.toXY(edges.a1);
    const a2 = ctx.toXY(edges.a2);
    const b1 = ctx.toXY(edges.b1);
    const b2 = ctx.toXY(edges.b2);
    if (!a1 || !a2 || !b1 || !b2) return false;
    return (
      distToSegment(ctx.x, ctx.y, a1.x, a1.y, a2.x, a2.y) <= ctx.tol ||
      distToSegment(ctx.x, ctx.y, b1.x, b1.y, b2.x, b2.y) <= ctx.tol
    );
  },
});

void fibPrices;
void fibExtensionPrices;
