// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Annotation pack — price label + eraser (tool-only handler metadata).
 */

import type { Drawing, TextDrawing } from '../../drawing-types';
import { nearPoint } from '../geometry';
import { registerToolHandler } from './registry';

registerToolHandler({
  id: 'priceLabel',
  label: 'Price label',
  arity: 1,
  create(points, color) {
    if (!points[0]) return null;
    const p = points[0];
    const text = p.price.toFixed(2);
    return {
      id: '',
      kind: 'priceLabel',
      p1: p,
      text,
      color,
    } as TextDrawing;
  },
  paint(d, ctx) {
    if (d.kind !== 'priceLabel' && d.kind !== 'text') return;
    const td = d as TextDrawing;
    const c = ctx.toXY(td.p1);
    if (!c) return;
    const text = td.text || td.meta?.text || td.p1.price.toFixed(2);
    // Chip background
    const padX = 6;
    const padY = 3;
    const approxW = Math.max(36, text.length * 7 + padX * 2);
    const h = 16;
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
    ctx.label(c.x + 6 + padX, c.y + 4, text, '#0b0c10', 11);
    ctx.circle(c.x, c.y, ctx.selected ? 5 : 3, ctx.stroke, true);
  },
  hit(d, ctx) {
    if (d.kind !== 'priceLabel' && d.kind !== 'text') return false;
    const td = d as TextDrawing;
    const c = ctx.toXY(td.p1);
    if (!c) return false;
    return nearPoint(ctx.x, ctx.y, c.x, c.y, ctx.tol + 8);
  },
});

registerToolHandler({
  id: 'eraser',
  label: 'Eraser',
  arity: 0,
  // Placement handled specially in DrawingLayer (delete on hit)
});

void (null as Drawing | null);
