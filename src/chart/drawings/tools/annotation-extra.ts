// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Annotation extras — flag, anchored text, arrow mark up/down.
 * All are 1-point {@link TextDrawing} tools registered via the tool handler pack.
 */

import { DRAWING_COLORS, type Drawing, type TextDrawing } from '../../drawing-types';
import { nearPoint } from '../geometry';
import { fontSizeOf } from '../tool-settings';
import { registerToolHandler, type ToolViewCtx } from './registry';
import {
  isFinitePoint,
  sanitizeDrawingText,
  sanitizePoints,
  sanitizeStrokeColor,
  safePrompt,
} from './safe';

function asText(d: Drawing, kind: TextDrawing['kind']): TextDrawing | null {
  if (d.kind !== kind) return null;
  if (!('p1' in d) || !d.p1 || !isFinitePoint(d.p1)) return null;
  return d as TextDrawing;
}

// ── Flag (pin + small flag; optional meta/text label) ───────────────────────

registerToolHandler({
  id: 'flag',
  label: 'Flag',
  arity: 1,
  create(points, color) {
    const pts = sanitizePoints(points);
    if (!pts[0]) return null;
    return {
      id: '',
      kind: 'flag',
      p1: pts[0],
      text: '',
      color: sanitizeStrokeColor(color),
    } as TextDrawing;
  },
  paint(d, ctx) {
    const td = asText(d, 'flag');
    if (!td) return;
    const c = ctx.toXY(td.p1);
    if (!c) return;
    const stroke = ctx.stroke;
    const stemH = 18;
    const flagW = 12;
    const flagH = 8;
    // Vertical stem
    ctx.line(c.x, c.y, c.x, c.y - stemH, stroke, Math.max(1.25, ctx.strokeWidth), undefined, 'stroke');
    // Flag triangle / rect to the right of stem top
    const topY = c.y - stemH;
    ctx.el('polygon', {
      points: `${c.x},${topY} ${c.x + flagW},${topY + flagH / 2} ${c.x},${topY + flagH}`,
      fill: stroke,
      stroke: 'none',
      'fill-opacity': '0.95',
      'pointer-events': 'all',
    });
    // Base pin
    ctx.circle(c.x, c.y, ctx.selected ? 5 : 3, stroke, true);
    const text = sanitizeDrawingText(td.text || td.meta?.text);
    if (text) {
      ctx.label(c.x + 6, c.y - stemH - 4, text, stroke, fontSizeOf(d, 10));
    }
  },
  hit(d, ctx) {
    const td = asText(d, 'flag');
    if (!td) return false;
    const c = ctx.toXY(td.p1);
    if (!c) return false;
    // Hit stem region + pin
    if (nearPoint(ctx.x, ctx.y, c.x, c.y, ctx.tol + 6)) return true;
    if (Math.abs(ctx.x - c.x) <= ctx.tol + 4 && ctx.y <= c.y + ctx.tol && ctx.y >= c.y - 22 - ctx.tol) {
      return true;
    }
    return false;
  },
});

// ── Anchored text (chip background; prompt on create) ───────────────────────

registerToolHandler({
  id: 'anchoredText',
  label: 'Anchored text',
  arity: 1,
  create(points, color) {
    const pts = sanitizePoints(points);
    if (!pts[0]) return null;
    const text = safePrompt('Anchored text', 'Text');
    return {
      id: '',
      kind: 'anchoredText',
      p1: pts[0],
      text,
      color: sanitizeStrokeColor(color),
      meta: { text },
    } as TextDrawing;
  },
  paint(d, ctx) {
    const td = asText(d, 'anchoredText');
    if (!td) return;
    const c = ctx.toXY(td.p1);
    if (!c) return;
    const text = sanitizeDrawingText(td.text || td.meta?.text || 'Text') || 'Text';
    const padX = 6;
    const padY = 3;
    const approxW = Math.max(40, String(text).length * 7 + padX * 2);
    const h = 18;
    ctx.el('rect', {
      x: String(c.x + 6),
      y: String(c.y - h / 2),
      width: String(approxW),
      height: String(h),
      rx: '3',
      fill: ctx.stroke,
      'fill-opacity': '0.9',
      stroke: 'none',
      'pointer-events': 'all',
    });
    ctx.label(c.x + 6 + padX, c.y + 4, String(text), '#0b0c10', fontSizeOf(d, 11));
    ctx.circle(c.x, c.y, ctx.selected ? 5 : 3, ctx.stroke, true);
    void padY;
  },
  hit(d, ctx) {
    const td = asText(d, 'anchoredText');
    if (!td) return false;
    const c = ctx.toXY(td.p1);
    if (!c) return false;
    return nearPoint(ctx.x, ctx.y, c.x, c.y, ctx.tol + 12);
  },
});

// ── Arrow mark up (green triangle below p1, tip toward p1) ──────────────────

function paintArrowMark(
  ctx: ToolViewCtx,
  c: { x: number; y: number },
  dir: 'up' | 'down',
  fill: string,
) {
  const size = 10;
  const gap = 4;
  if (dir === 'up') {
    // Tip at p1-ish from below: base lower, tip upper (near p1)
    const tipY = c.y + gap;
    const baseY = tipY + size;
    ctx.el('polygon', {
      points: `${c.x},${tipY} ${c.x - size * 0.7},${baseY} ${c.x + size * 0.7},${baseY}`,
      fill,
      stroke: fill,
      'stroke-width': '1',
      'pointer-events': 'all',
    });
  } else {
    // Tip near p1 from above: base higher, tip lower
    const tipY = c.y - gap;
    const baseY = tipY - size;
    ctx.el('polygon', {
      points: `${c.x},${tipY} ${c.x - size * 0.7},${baseY} ${c.x + size * 0.7},${baseY}`,
      fill,
      stroke: fill,
      'stroke-width': '1',
      'pointer-events': 'all',
    });
  }
  if (ctx.selected) ctx.circle(c.x, c.y, 5, fill, true);
}

registerToolHandler({
  id: 'arrowMarkUp',
  label: 'Arrow mark up',
  arity: 1,
  create(points, color) {
    const pts = sanitizePoints(points);
    if (!pts[0]) return null;
    return {
      id: '',
      kind: 'arrowMarkUp',
      p1: pts[0],
      text: '',
      color: sanitizeStrokeColor(color, DRAWING_COLORS.up),
    } as TextDrawing;
  },
  paint(d, ctx) {
    const td = asText(d, 'arrowMarkUp');
    if (!td) return;
    const c = ctx.toXY(td.p1);
    if (!c) return;
    const fill = ctx.stroke || DRAWING_COLORS.up;
    paintArrowMark(ctx, c, 'up', fill);
  },
  hit(d, ctx) {
    const td = asText(d, 'arrowMarkUp');
    if (!td) return false;
    const c = ctx.toXY(td.p1);
    if (!c) return false;
    return nearPoint(ctx.x, ctx.y, c.x, c.y + 8, ctx.tol + 10) || nearPoint(ctx.x, ctx.y, c.x, c.y, ctx.tol + 8);
  },
});

// ── Arrow mark down (red triangle above p1, tip toward p1) ──────────────────

registerToolHandler({
  id: 'arrowMarkDown',
  label: 'Arrow mark down',
  arity: 1,
  create(points, color) {
    const pts = sanitizePoints(points);
    if (!pts[0]) return null;
    return {
      id: '',
      kind: 'arrowMarkDown',
      p1: pts[0],
      text: '',
      color: sanitizeStrokeColor(color, DRAWING_COLORS.down),
    } as TextDrawing;
  },
  paint(d, ctx) {
    const td = asText(d, 'arrowMarkDown');
    if (!td) return;
    const c = ctx.toXY(td.p1);
    if (!c) return;
    const fill = ctx.stroke || DRAWING_COLORS.down;
    paintArrowMark(ctx, c, 'down', fill);
  },
  hit(d, ctx) {
    const td = asText(d, 'arrowMarkDown');
    if (!td) return false;
    const c = ctx.toXY(td.p1);
    if (!c) return false;
    return nearPoint(ctx.x, ctx.y, c.x, c.y - 8, ctx.tol + 10) || nearPoint(ctx.x, ctx.y, c.x, c.y, ctx.tol + 8);
  },
});

void (null as Drawing | null);
