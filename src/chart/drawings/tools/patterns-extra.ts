// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Harmonic / chart-pattern pack — XABCD and head & shoulders (5-point).
 *
 * Placement is open-ended (`arity: 'n'`) with `minPoints: 5`; finish on
 * double-click once enough anchors are collected. Create always stores the
 * first five points when more are supplied.
 */

import type { Drawing, MultiPointDrawing, Point } from '../../drawing-types';
import { distToSegment, nearPoint } from '../geometry';
import { registerToolHandler, type ToolHitCtx, type ToolViewCtx } from './registry';
import { clampStrokeWidth, sanitizePoints, sanitizeStrokeColor } from './safe';

const XABCD_LABELS = ['X', 'A', 'B', 'C', 'D'] as const;

function pts(d: Drawing): Point[] {
  if ('points' in d && Array.isArray((d as MultiPointDrawing).points)) {
    return sanitizePoints((d as MultiPointDrawing).points);
  }
  return [];
}

function toXYs(points: Point[], toXY: ToolViewCtx['toXY']): { x: number; y: number }[] {
  return points.map((p) => toXY(p)).filter(Boolean) as { x: number; y: number }[];
}

function legPrice(a: Point, b: Point): number {
  return Math.abs(b.price - a.price);
}

/** Simple price-ratio string (denominator 0 → em dash). */
export function priceRatio(num: number, den: number, digits = 3): string {
  if (!(den > 0) || !Number.isFinite(num) || !Number.isFinite(den)) return '—';
  return (num / den).toFixed(digits);
}

function paintOpenPoly(
  points: Point[],
  ctx: ToolViewCtx,
  opts?: { dash?: string; width?: number },
): { x: number; y: number }[] {
  const xys = toXYs(points, ctx.toXY);
  if (xys.length < 2) return xys;
  let d = `M ${xys[0]!.x} ${xys[0]!.y}`;
  for (let i = 1; i < xys.length; i++) d += ` L ${xys[i]!.x} ${xys[i]!.y}`;
  ctx.el('path', {
    d,
    fill: 'none',
    stroke: ctx.stroke,
    'stroke-width': String(clampStrokeWidth(opts?.width ?? ctx.strokeWidth)),
    'pointer-events': 'stroke',
    ...(opts?.dash || ctx.dash
      ? { 'stroke-dasharray': opts?.dash ?? ctx.dash! }
      : {}),
  });
  return xys;
}

function hitOpenPoly(points: Point[], ctx: ToolHitCtx): boolean {
  const xys = toXYs(points, ctx.toXY);
  for (const p of xys) {
    if (nearPoint(ctx.x, ctx.y, p.x, p.y, ctx.tol + 2)) return true;
  }
  for (let i = 0; i < xys.length - 1; i++) {
    if (
      distToSegment(ctx.x, ctx.y, xys[i]!.x, xys[i]!.y, xys[i + 1]!.x, xys[i + 1]!.y) <=
      ctx.tol
    ) {
      return true;
    }
  }
  return false;
}

function paintVertexLabels(
  xys: { x: number; y: number }[],
  labels: readonly string[],
  ctx: ToolViewCtx,
) {
  const n = Math.min(xys.length, labels.length);
  for (let i = 0; i < n; i++) {
    const p = xys[i]!;
    ctx.label(p.x + 6, p.y - 6, labels[i]!, ctx.stroke, 11);
    if (ctx.selected) ctx.circle(p.x, p.y, 5, ctx.stroke, true);
    else ctx.circle(p.x, p.y, 3, ctx.stroke, true);
  }
}

/** Ratio labels for XABCD legs using price spans only. */
function paintXabcdRatios(points: Point[], xys: { x: number; y: number }[], ctx: ToolViewCtx) {
  if (points.length < 2 || xys.length < 2) return;
  const X = points[0]!;
  const A = points[1]!;
  const xa = legPrice(X, A);

  const mid = (i: number, j: number) => {
    const a = xys[i];
    const b = xys[j];
    if (!a || !b) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  if (points.length >= 3 && xys.length >= 3) {
    const B = points[2]!;
    const m = mid(1, 2);
    if (m) {
      ctx.label(m.x, m.y - 8, `AB/XA ${priceRatio(legPrice(A, B), xa)}`, ctx.stroke, 10, 'middle');
    }
  }
  if (points.length >= 4 && xys.length >= 4) {
    const B = points[2]!;
    const C = points[3]!;
    const ab = legPrice(A, B);
    const m = mid(2, 3);
    if (m) {
      ctx.label(m.x, m.y - 8, `BC/AB ${priceRatio(legPrice(B, C), ab)}`, ctx.stroke, 10, 'middle');
    }
  }
  if (points.length >= 5 && xys.length >= 5) {
    const B = points[2]!;
    const C = points[3]!;
    const D = points[4]!;
    const bc = legPrice(B, C);
    const mCd = mid(3, 4);
    if (mCd) {
      ctx.label(
        mCd.x,
        mCd.y - 8,
        `CD/BC ${priceRatio(legPrice(C, D), bc)}`,
        ctx.stroke,
        10,
        'middle',
      );
    }
    const mAd = mid(1, 4);
    if (mAd) {
      ctx.label(
        mAd.x,
        mAd.y + 12,
        `AD/XA ${priceRatio(legPrice(A, D), xa)}`,
        ctx.stroke,
        10,
        'middle',
      );
    }
  }
}

function paintXabcd(points: Point[], ctx: ToolViewCtx) {
  if (points.length < 1) return;
  const use = points.slice(0, 5);
  const xys = paintOpenPoly(use, ctx);
  // Single-point draft: still show vertex
  if (xys.length === 1) {
    paintVertexLabels(xys, XABCD_LABELS, ctx);
    return;
  }
  if (xys.length === 0 && use.length >= 1) {
    const only = ctx.toXY(use[0]!);
    if (only) paintVertexLabels([only], XABCD_LABELS, ctx);
    return;
  }
  paintVertexLabels(xys, XABCD_LABELS, ctx);
  paintXabcdRatios(use, xys, ctx);
}

// ── XABCD ───────────────────────────────────────────────────────────────────

registerToolHandler({
  id: 'xabcd',
  label: 'XABCD pattern',
  arity: 'n',
  minPoints: 5,
  create(points, color) {
    const p = sanitizePoints(points);
    if (p.length < 5) return null;
    const five = p.slice(0, 5);
    return {
      id: '',
      kind: 'xabcd',
      points: five,
      p1: five[0]!,
      p2: five[4]!,
      color: sanitizeStrokeColor(color),
    } as MultiPointDrawing;
  },
  paint(d, ctx) {
    if (d.kind !== 'xabcd') return;
    paintXabcd(pts(d), ctx);
  },
  hit(d, ctx) {
    if (d.kind !== 'xabcd') return false;
    return hitOpenPoly(pts(d).slice(0, 5), ctx);
  },
  paintDraft(points, ctx) {
    paintXabcd(sanitizePoints(points).slice(0, 5), ctx);
  },
});

// ── Head & shoulders ────────────────────────────────────────────────────────
// Anchors: left shoulder → head-left (neck) → head → head-right (neck) → right shoulder.
// Polyline follows the silhouette; neckline spans the outer points (LS–RS).

const HS_LABELS = ['LS', 'NL', 'H', 'NR', 'RS'] as const;

function paintHeadShoulders(points: Point[], ctx: ToolViewCtx) {
  if (points.length < 1) return;
  const use = points.slice(0, 5);
  const xys = paintOpenPoly(use, ctx);

  // Neckline between outer points (LS–RS) once all five anchors exist
  if (use.length >= 5 && xys.length >= 5) {
    const a = xys[0]!;
    const b = xys[4]!;
    ctx.line(a.x, a.y, b.x, b.y, ctx.stroke, Math.max(1, ctx.strokeWidth - 0.25), '4 3');
  }

  const n = Math.min(xys.length, HS_LABELS.length);
  for (let i = 0; i < n; i++) {
    const p = xys[i]!;
    ctx.label(p.x + 6, p.y - 6, HS_LABELS[i]!, ctx.stroke, 10);
    if (ctx.selected) ctx.circle(p.x, p.y, 5, ctx.stroke, true);
    else ctx.circle(p.x, p.y, 3, ctx.stroke, true);
  }
}

function hitHeadShoulders(points: Point[], ctx: ToolHitCtx): boolean {
  const use = points.slice(0, 5);
  if (hitOpenPoly(use, ctx)) return true;
  // Neckline LS–RS
  if (use.length >= 5) {
    const a = ctx.toXY(use[0]!);
    const b = ctx.toXY(use[4]!);
    if (a && b && distToSegment(ctx.x, ctx.y, a.x, a.y, b.x, b.y) <= ctx.tol) return true;
  }
  return false;
}

registerToolHandler({
  id: 'headShoulders',
  label: 'Head & shoulders',
  arity: 'n',
  minPoints: 5,
  create(points, color) {
    const p = sanitizePoints(points);
    if (p.length < 5) return null;
    const five = p.slice(0, 5);
    return {
      id: '',
      kind: 'headShoulders',
      points: five,
      p1: five[0]!,
      p2: five[4]!,
      color: sanitizeStrokeColor(color),
    } as MultiPointDrawing;
  },
  paint(d, ctx) {
    if (d.kind !== 'headShoulders') return;
    paintHeadShoulders(pts(d), ctx);
  },
  hit(d, ctx) {
    if (d.kind !== 'headShoulders') return false;
    return hitHeadShoulders(pts(d), ctx);
  },
  paintDraft(points, ctx) {
    paintHeadShoulders(sanitizePoints(points).slice(0, 5), ctx);
  },
});
