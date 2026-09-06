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
import { fontSizeOf } from '../tool-settings';
import { registerToolHandler, type ToolViewCtx } from './registry';
import {
  DRAWING_POINTS_MAX,
  clampOpacity,
  clampStrokeWidth,
  isFinitePoint,
  sanitizeDrawingText,
  sanitizePoints,
  sanitizeStrokeColor,
  safePrompt,
} from './safe';

/** Cap selection handles on long freehand strokes (DOM thrash guard). */
const SELECTED_HANDLES_MAX = 48;

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
  return [];
}

// ── Cross line (H + V through one point) ────────────────────────────────────

registerToolHandler({
  id: 'crossline',
  label: 'Cross line',
  arity: 1,
  create(points, color) {
    const p = sanitizePoints(points);
    if (!p[0]) return null;
    return {
      id: '',
      kind: 'crossline',
      p1: p[0],
      text: p[0].price.toFixed(2),
      color: sanitizeStrokeColor(color),
    } as TextDrawing;
  },
  paint(d, ctx) {
    if (d.kind !== 'crossline') return;
    if (!isFinitePoint(d.p1)) return;
    const c = ctx.toXY(d.p1);
    if (!c) return;
    ctx.line(0, c.y, ctx.width, c.y, ctx.stroke, ctx.strokeWidth, ctx.dash);
    ctx.line(c.x, 0, c.x, ctx.height, ctx.stroke, ctx.strokeWidth, ctx.dash);
    ctx.label(c.x + 6, c.y - 4, d.p1.price.toFixed(2), ctx.stroke, 10);
    if (ctx.selected) ctx.circle(c.x, c.y, 5, ctx.stroke, true);
  },
  hit(d, ctx) {
    if (d.kind !== 'crossline') return false;
    if (!isFinitePoint(d.p1)) return false;
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
    const p = sanitizePoints(points);
    if (p.length < 2) return null;
    return {
      id: '',
      kind: 'trendAngle',
      p1: p[0]!,
      p2: p[1]!,
      color: sanitizeStrokeColor(color),
    };
  },
  paint(d, ctx) {
    const t = asTwo(d, 'trendAngle');
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
    const t = asTwo(d, 'trendAngle');
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
    const p = sanitizePoints(points);
    if (p.length < 3) return null;
    return {
      id: '',
      kind: 'pitchfork',
      points: p.slice(0, 3),
      p1: p[0]!,
      p2: p[1]!,
      p3: p[2]!,
      color: sanitizeStrokeColor(color),
    } as MultiPointDrawing;
  },
  paint(d, ctx) {
    if (d.kind !== 'pitchfork') return;
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
    if (d.kind !== 'pitchfork') return false;
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
  textPrompt: { title: 'Callout text', fallback: 'Note' },
  create(points, color, text) {
    const p = sanitizePoints(points);
    if (p.length < 2) return null;
    const label = sanitizeDrawingText(text ?? safePrompt('Callout text', 'Note')) || 'Note';
    return {
      id: '',
      kind: 'callout',
      p1: p[0]!,
      p2: p[1]!,
      color: sanitizeStrokeColor(color),
      text: label,
      meta: { text: label },
    };
  },
  paint(d, ctx) {
    const t = asTwo(d, 'callout');
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    const text =
      sanitizeDrawingText((d as TwoPointDrawing & { text?: string }).text || d.meta?.text || 'Note') ||
      'Note';
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
      'stroke-width': String(clampStrokeWidth(ctx.strokeWidth)),
      'pointer-events': 'all',
    });
    ctx.label(bx + padX, by + th - padY, String(text), ctx.stroke, fontSizeOf(d, 11));
    ctx.circle(a.x, a.y, ctx.selected ? 5 : 3, ctx.stroke, true);
  },
  hit(d, ctx) {
    const t = asTwo(d, 'callout');
    if (!t) return false;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return false;
    if (nearPoint(ctx.x, ctx.y, a.x, a.y, ctx.tol + 4)) return true;
    const text =
      sanitizeDrawingText((d as TwoPointDrawing & { text?: string }).text || 'Note') || 'Note';
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
  textPrompt: { title: 'Note text', fallback: 'Note' },
  create(points, color, text) {
    const p = sanitizePoints(points);
    if (!p[0]) return null;
    const label = sanitizeDrawingText(text ?? safePrompt('Note text', 'Note')) || 'Note';
    return {
      id: '',
      kind: 'note',
      p1: p[0],
      text: label,
      color: sanitizeStrokeColor(color),
    } as TextDrawing;
  },
  paint(d, ctx) {
    if (d.kind !== 'note') return;
    if (!isFinitePoint(d.p1)) return;
    const c = ctx.toXY(d.p1);
    if (!c) return;
    const text = sanitizeDrawingText(d.text || d.meta?.text || 'Note') || 'Note';
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
    ctx.label(c.x + 8, c.y - 6, String(text), '#0b0c10', fontSizeOf(d, 11));
    if (ctx.selected) ctx.circle(c.x, c.y, 5, ctx.stroke, true);
  },
  hit(d, ctx) {
    if (d.kind !== 'note') return false;
    if (!isFinitePoint(d.p1)) return false;
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
  const sw = clampStrokeWidth(opts.width, 3);
  let d = `M ${xys[0]!.x} ${xys[0]!.y}`;
  for (let i = 1; i < xys.length; i++) d += ` L ${xys[i]!.x} ${xys[i]!.y}`;
  ctx.el('path', {
    d,
    fill: 'none',
    stroke: ctx.stroke,
    'stroke-width': String(sw),
    'stroke-opacity': opts.opacity,
    'stroke-linecap': opts.round ? 'round' : 'butt',
    'stroke-linejoin': opts.round ? 'round' : 'miter',
    'pointer-events': 'stroke',
  });
  if (ctx.selected) {
    for (const i of sampleHandleIndices(xys.length, SELECTED_HANDLES_MAX)) {
      const p = xys[i]!;
      ctx.circle(p.x, p.y, 3, ctx.stroke, true);
    }
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
    const p = sanitizePoints(points, DRAWING_POINTS_MAX);
    if (p.length < 2) return null;
    return {
      id: '',
      kind: 'brush',
      points: p,
      p1: p[0]!,
      p2: p[p.length - 1]!,
      color: sanitizeStrokeColor(color),
      lineWidth: 3,
    } as MultiPointDrawing;
  },
  paint(d, ctx) {
    if (d.kind !== 'brush') return;
    paintStroke(pts(d), ctx, {
      width: Math.max(3, clampStrokeWidth(ctx.strokeWidth) + 1.5),
      opacity: '0.95',
      round: true,
    });
  },
  hit(d, ctx) {
    if (d.kind !== 'brush') return false;
    return hitStroke(pts(d), ctx);
  },
  paintDraft(points, ctx) {
    paintStroke(sanitizePoints(points, DRAWING_POINTS_MAX), ctx, {
      width: 3,
      opacity: '0.7',
      round: true,
    });
  },
});

registerToolHandler({
  id: 'highlighter',
  label: 'Highlighter',
  arity: 'n',
  minPoints: 2,
  create(points, color) {
    const p = sanitizePoints(points, DRAWING_POINTS_MAX);
    if (p.length < 2) return null;
    return {
      id: '',
      kind: 'highlighter',
      points: p,
      p1: p[0]!,
      p2: p[p.length - 1]!,
      color: sanitizeStrokeColor(color),
      lineWidth: 8,
      fillOpacity: 0.35,
    } as MultiPointDrawing;
  },
  paint(d, ctx) {
    if (d.kind !== 'highlighter') return;
    const fo = clampOpacity(ctx.fillOpacity, 0.35);
    paintStroke(pts(d), ctx, {
      width: Math.max(4, clampStrokeWidth(ctx.strokeWidth, 8)),
      opacity: String(Math.min(0.45, Math.max(0.2, fo + 0.15))),
      round: true,
    });
  },
  hit(d, ctx) {
    if (d.kind !== 'highlighter') return false;
    return hitStroke(pts(d), ctx);
  },
  paintDraft(points, ctx) {
    paintStroke(sanitizePoints(points, DRAWING_POINTS_MAX), ctx, {
      width: 8,
      opacity: '0.3',
      round: true,
    });
  },
});
