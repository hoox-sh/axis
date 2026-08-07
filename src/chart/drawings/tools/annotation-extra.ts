// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Annotation extras — flag, anchored text, arrow marks.
 */

import { DRAWING_COLORS, type Drawing, type TextDrawing } from '../../drawing-types';
import { nearPoint } from '../geometry';
import { registerToolHandler } from './registry';

function promptText(def: string): string {
  if (typeof window === 'undefined') return def;
  return (window.prompt('Text', def) || def).trim() || def;
}

registerToolHandler({
  id: 'flag',
  label: 'Flag',
  arity: 1,
  create(points, color) {
    if (!points[0]) return null;
    return {
      id: '',
      kind: 'flag',
      p1: points[0],
      text: '!',
      color,
    } as TextDrawing;
  },
  paint(d, ctx) {
    if (d.kind !== 'flag') return;
    const c = ctx.toXY(d.p1);
    if (!c) return;
    // Stem
    ctx.line(c.x, c.y, c.x, c.y - 22, ctx.stroke, 1.5);
    // Flag triangle
    ctx.el('polygon', {
      points: `${c.x},${c.y - 22} ${c.x + 16},${c.y - 16} ${c.x},${c.y - 10}`,
      fill: ctx.stroke,
      stroke: ctx.stroke,
      'fill-opacity': '0.85',
      'pointer-events': 'all',
    });
    if (ctx.selected) ctx.circle(c.x, c.y, 5, ctx.stroke, true);
  },
  hit(d, ctx) {
    if (d.kind !== 'flag') return false;
    const c = ctx.toXY(d.p1);
    if (!c) return false;
    return nearPoint(ctx.x, ctx.y, c.x, c.y, ctx.tol + 14);
  },
});

registerToolHandler({
  id: 'anchoredText',
  label: 'Anchored text',
  arity: 1,
  create(points, color) {
    if (!points[0]) return null;
    const text = promptText('Text');
    return {
      id: '',
      kind: 'anchoredText',
      p1: points[0],
      text,
      color,
    } as TextDrawing;
  },
  paint(d, ctx) {
    if (d.kind !== 'anchoredText') return;
    const c = ctx.toXY(d.p1);
    if (!c) return;
    const text = d.text || d.meta?.text || '';
    const tw = Math.max(32, String(text).length * 7 + 14);
    const th = 18;
    ctx.el('rect', {
      x: String(c.x),
      y: String(c.y - th),
      width: String(tw),
      height: String(th),
      rx: '3',
      fill: '#12141c',
      stroke: ctx.stroke,
      'stroke-width': String(ctx.strokeWidth),
      'pointer-events': 'all',
    });
    ctx.label(c.x + 7, c.y - 5, String(text), ctx.stroke, 11);
    ctx.circle(c.x, c.y, ctx.selected ? 5 : 2, ctx.stroke, true);
  },
  hit(d, ctx) {
    if (d.kind !== 'anchoredText') return false;
    const c = ctx.toXY(d.p1);
    if (!c) return false;
    return nearPoint(ctx.x, ctx.y, c.x, c.y, ctx.tol + 12);
  },
});

registerToolHandler({
  id: 'arrowMarkUp',
  label: 'Arrow mark up',
  arity: 1,
  create(points, color) {
    if (!points[0]) return null;
    return {
      id: '',
      kind: 'arrowMarkUp',
      p1: points[0],
      text: '↑',
      color: color || DRAWING_COLORS.up,
    } as TextDrawing;
  },
  paint(d, ctx) {
    if (d.kind !== 'arrowMarkUp') return;
    const c = ctx.toXY(d.p1);
    if (!c) return;
    const col = DRAWING_COLORS.up;
    const s = 10;
    ctx.el('polygon', {
      points: `${c.x},${c.y - s} ${c.x - s * 0.7},${c.y + s * 0.4} ${c.x + s * 0.7},${c.y + s * 0.4}`,
      fill: col,
      stroke: col,
      'pointer-events': 'all',
    });
    if (ctx.selected) ctx.circle(c.x, c.y + 6, 4, col, true);
  },
  hit(d, ctx) {
    if (d.kind !== 'arrowMarkUp') return false;
    const c = ctx.toXY(d.p1);
    if (!c) return false;
    return nearPoint(ctx.x, ctx.y, c.x, c.y, ctx.tol + 10);
  },
});

registerToolHandler({
  id: 'arrowMarkDown',
  label: 'Arrow mark down',
  arity: 1,
  create(points, color) {
    if (!points[0]) return null;
    return {
      id: '',
      kind: 'arrowMarkDown',
      p1: points[0],
      text: '↓',
      color: color || DRAWING_COLORS.down,
    } as TextDrawing;
  },
  paint(d, ctx) {
    if (d.kind !== 'arrowMarkDown') return;
    const c = ctx.toXY(d.p1);
    if (!c) return;
    const col = DRAWING_COLORS.down;
    const s = 10;
    ctx.el('polygon', {
      points: `${c.x},${c.y + s} ${c.x - s * 0.7},${c.y - s * 0.4} ${c.x + s * 0.7},${c.y - s * 0.4}`,
      fill: col,
      stroke: col,
      'pointer-events': 'all',
    });
    if (ctx.selected) ctx.circle(c.x, c.y - 6, 4, col, true);
  },
  hit(d, ctx) {
    if (d.kind !== 'arrowMarkDown') return false;
    const c = ctx.toXY(d.p1);
    if (!c) return false;
    return nearPoint(ctx.x, ctx.y, c.x, c.y, ctx.tol + 10);
  },
});

void (null as Drawing | null);
