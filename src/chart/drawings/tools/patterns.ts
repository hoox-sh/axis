// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Patterns / advanced lines pack — pitchfork, cross line, trend angle,
 * callout, note, brush, highlighter.
 */

import type {
  Drawing,
  MultiPointDrawing,
  Point,
  TextDrawing,
  TwoPointDrawing,
} from '../../drawing-types';
import { distToSegment, extendSegment, nearPoint } from '../geometry';
import { registerToolHandler, type ToolViewCtx } from './registry';

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

// ── Cross line (H + V through one point) ────────────────────────────────────

registerToolHandler({
  id: 'crossline',
  label: 'Cross line',
  arity: 1,
  create(points, color) {
    if (!points[0]) return null;
    return {
      id: '',
      kind: 'crossline',
      p1: points[0],
      text: points[0].price.toFixed(2),
      color,
    } as TextDrawing;
  },
  paint(d, ctx) {
    if (d.kind !== 'crossline') return;
    const c = ctx.toXY(d.p1);
    if (!c) return;
    ctx.line(0, c.y, ctx.width, c.y, ctx.stroke, ctx.strokeWidth, ctx.dash);
    ctx.line(c.x, 0, c.x, ctx.height, ctx.stroke, ctx.strokeWidth, ctx.dash);
    ctx.label(c.x + 6, c.y - 4, d.p1.price.toFixed(2), ctx.stroke, 10);
    if (ctx.selected) ctx.circle(c.x, c.y, 5, ctx.stroke, true);
  },
  hit(d, ctx) {
    if (d.kind !== 'crossline') return false;
    const c = ctx.toXY(d.p1);
    if (!c) return false;
    return Math.abs(ctx.y - c.y) <= ctx.tol || Math.abs(ctx.x - c.x) <= ctx.tol;
  },
});

// ── Trend angle ─────────────────────────────────────────────────────────────

registerToolHandler({
  id: 'trendAngle',
  label: 'Trend angle',
  arity: 2,
  create(points, color) {
    if (points.length < 2) return null;
    return { id: '', kind: 'trendAngle', p1: points[0]!, p2: points[1]!, color };
  },
  paint(d, ctx) {
    const t = asTwo(d);
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    ctx.line(a.x, a.y, b.x, b.y, ctx.stroke, ctx.strokeWidth, ctx.dash);
    // Horizontal reference
    ctx.line(a.x, a.y, b.x, a.y, ctx.stroke, 1, '4 3');
    const ang = (Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI;
    ctx.label((a.x + b.x) / 2 + 6, (a.y + b.y) / 2 - 6, `${ang.toFixed(1)}°`, ctx.stroke, 11);
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

// ── Andrews pitchfork (3 points) ────────────────────────────────────────────

registerToolHandler({
  id: 'pitchfork',
  label: 'Pitchfork',
  arity: 3,
  create(points, color) {
    if (points.length < 3) return null;
    return {
      id: '',
      kind: 'pitchfork',
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
    // Handle = midpoint of BC
    const mx = (b.x + c.x) / 2;
    const my = (b.y + c.y) / 2;
    // Median line A → M, extended
    const med = extendSegment(a.x, a.y, mx, my, 'both', ctx.width, ctx.height);
    // Parallel through B and C: direction = M - A
    const dx = mx - a.x;
    const dy = my - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const scale = (Math.max(ctx.width, ctx.height) * 4) / len;
    const rail = (ox: number, oy: number) => ({
      x1: ox - dx * scale,
      y1: oy - dy * scale,
      x2: ox + dx * scale,
      y2: oy + dy * scale,
    });
    const rB = rail(b.x, b.y);
    const rC = rail(c.x, c.y);
    ctx.line(med.x1, med.y1, med.x2, med.y2, ctx.stroke, ctx.strokeWidth, ctx.dash);
    ctx.line(rB.x1, rB.y1, rB.x2, rB.y2, ctx.stroke, Math.max(1, ctx.strokeWidth - 0.25), '3 3');
    ctx.line(rC.x1, rC.y1, rC.x2, rC.y2, ctx.stroke, Math.max(1, ctx.strokeWidth - 0.25), '3 3');
    // Handle BC
    ctx.line(b.x, b.y, c.x, c.y, ctx.stroke, 1, '2 2');
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
    const mx = (b.x + c.x) / 2;
    const my = (b.y + c.y) / 2;
    return (
      distToSegment(ctx.x, ctx.y, a.x, a.y, mx, my) <= ctx.tol ||
      distToSegment(ctx.x, ctx.y, b.x, b.y, c.x, c.y) <= ctx.tol
    );
  },
});

// ── Callout (anchor + text box) ─────────────────────────────────────────────

registerToolHandler({
  id: 'callout',
  label: 'Callout',
  arity: 2,
  create(points, color) {
    if (points.length < 2) return null;
    const text =
      typeof window !== 'undefined'
        ? window.prompt('Callout text', 'Note') || 'Note'
        : 'Note';
    return {
      id: '',
      kind: 'callout',
      p1: points[0]!,
      p2: points[1]!,
      color,
      text: text.trim() || 'Note',
      meta: { text: text.trim() || 'Note' },
    };
  },
  paint(d, ctx) {
    const t = asTwo(d);
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    const text = (d as TwoPointDrawing & { text?: string }).text || d.meta?.text || 'Note';
    const padX = 8;
    const padY = 6;
    const tw = Math.max(48, String(text).length * 7 + padX * 2);
    const th = 22;
    const bx = b.x;
    const by = b.y - th / 2;
    // Stem
    ctx.line(a.x, a.y, b.x, b.y, ctx.stroke, 1, ctx.dash);
    ctx.el('rect', {
      x: String(bx),
      y: String(by),
      width: String(tw),
      height: String(th),
      rx: '4',
      fill: '#12141c',
      stroke: ctx.stroke,
      'stroke-width': String(ctx.strokeWidth),
      'pointer-events': 'all',
    });
    ctx.label(bx + padX, by + th - padY, String(text), ctx.stroke, 11);
    ctx.circle(a.x, a.y, ctx.selected ? 5 : 3, ctx.stroke, true);
  },
  hit(d, ctx) {
    const t = asTwo(d);
    if (!t) return false;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return false;
    if (nearPoint(ctx.x, ctx.y, a.x, a.y, ctx.tol + 4)) return true;
    const text = (d as TwoPointDrawing & { text?: string }).text || 'Note';
    const tw = Math.max(48, String(text).length * 7 + 16);
    const th = 22;
    return (
      ctx.x >= b.x - ctx.tol &&
      ctx.x <= b.x + tw + ctx.tol &&
      ctx.y >= b.y - th / 2 - ctx.tol &&
      ctx.y <= b.y + th / 2 + ctx.tol
    );
  },
});

// ── Note (single-point sticky) ──────────────────────────────────────────────

registerToolHandler({
  id: 'note',
  label: 'Note',
  arity: 1,
  create(points, color) {
    if (!points[0]) return null;
    const text =
      typeof window !== 'undefined'
        ? window.prompt('Note text', 'Note') || 'Note'
        : 'Note';
    return {
      id: '',
      kind: 'note',
      p1: points[0],
      text: text.trim() || 'Note',
      color,
    } as TextDrawing;
  },
  paint(d, ctx) {
    if (d.kind !== 'note') return;
    const c = ctx.toXY(d.p1);
    if (!c) return;
    const text = d.text || d.meta?.text || 'Note';
    const tw = Math.max(40, String(text).length * 7 + 16);
    const th = 20;
    ctx.el('rect', {
      x: String(c.x),
      y: String(c.y - th),
      width: String(tw),
      height: String(th),
      rx: '2',
      fill: 'color-mix(in srgb, #e8a03a 85%, #12141c)',
      stroke: ctx.stroke,
      'stroke-width': '1',
      'pointer-events': 'all',
    });
    ctx.label(c.x + 8, c.y - 6, String(text), '#0b0c10', 11);
    if (ctx.selected) ctx.circle(c.x, c.y, 5, ctx.stroke, true);
  },
  hit(d, ctx) {
    if (d.kind !== 'note') return false;
    const c = ctx.toXY(d.p1);
    if (!c) return false;
    return nearPoint(ctx.x, ctx.y, c.x, c.y, ctx.tol + 12);
  },
});

// ── Brush / highlighter (freehand n-pt) ─────────────────────────────────────

function paintStroke(
  points: Point[],
  ctx: ToolViewCtx,
  opts: { width: number; opacity: string; round: boolean },
) {
  const xys = points.map((p) => ctx.toXY(p)).filter(Boolean) as { x: number; y: number }[];
  if (xys.length < 2) return;
  let d = `M ${xys[0]!.x} ${xys[0]!.y}`;
  for (let i = 1; i < xys.length; i++) d += ` L ${xys[i]!.x} ${xys[i]!.y}`;
  ctx.el('path', {
    d,
    fill: 'none',
    stroke: ctx.stroke,
    'stroke-width': String(opts.width),
    'stroke-opacity': opts.opacity,
    'stroke-linecap': opts.round ? 'round' : 'butt',
    'stroke-linejoin': opts.round ? 'round' : 'miter',
    'pointer-events': 'stroke',
  });
  if (ctx.selected) {
    for (const p of xys) ctx.circle(p.x, p.y, 3, ctx.stroke, true);
  }
}

function hitStroke(points: Point[], ctx: Parameters<NonNullable<import('./registry').ToolHandler['hit']>>[1]): boolean {
  const xys = points.map((p) => ctx.toXY(p)).filter(Boolean) as { x: number; y: number }[];
  for (let i = 0; i < xys.length - 1; i++) {
    if (
      distToSegment(ctx.x, ctx.y, xys[i]!.x, xys[i]!.y, xys[i + 1]!.x, xys[i + 1]!.y) <=
      ctx.tol + 4
    ) {
      return true;
    }
  }
  return false;
}

registerToolHandler({
  id: 'brush',
  label: 'Brush',
  arity: 'n',
  minPoints: 2,
  create(points, color) {
    if (points.length < 2) return null;
    return {
      id: '',
      kind: 'brush',
      points: points.slice(),
      p1: points[0]!,
      p2: points[points.length - 1]!,
      color,
      lineWidth: 3,
    } as MultiPointDrawing;
  },
  paint(d, ctx) {
    paintStroke(pts(d), ctx, {
      width: Math.max(3, ctx.strokeWidth + 1.5),
      opacity: '0.95',
      round: true,
    });
  },
  hit(d, ctx) {
    return hitStroke(pts(d), ctx);
  },
  paintDraft(points, ctx) {
    paintStroke(points, ctx, { width: 3, opacity: '0.7', round: true });
  },
});

registerToolHandler({
  id: 'highlighter',
  label: 'Highlighter',
  arity: 'n',
  minPoints: 2,
  create(points, color) {
    if (points.length < 2) return null;
    return {
      id: '',
      kind: 'highlighter',
      points: points.slice(),
      p1: points[0]!,
      p2: points[points.length - 1]!,
      color,
      lineWidth: 12,
      fillOpacity: 0.35,
    } as MultiPointDrawing;
  },
  paint(d, ctx) {
    paintStroke(pts(d), ctx, {
      width: Math.max(10, ctx.strokeWidth * 6),
      opacity: String(Math.min(0.45, Math.max(0.2, ctx.fillOpacity + 0.15))),
      round: true,
    });
  },
  hit(d, ctx) {
    return hitStroke(pts(d), ctx);
  },
  paintDraft(points, ctx) {
    paintStroke(points, ctx, { width: 12, opacity: '0.3', round: true });
  },
});
