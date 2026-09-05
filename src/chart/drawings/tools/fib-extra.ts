// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Extra Fibonacci tools — arcs, wedge, circles (pixel-space radii / angles).
 */

import {
  type Drawing,
  type MultiPointDrawing,
  type Point,
  type TwoPointDrawing,
} from '../../drawing-types';
import { distToSegment, extendSegment, nearPoint } from '../geometry';
import { fibLevelsOf, isFibReversed, showPctOf } from '../tool-settings';
import { registerToolHandler, type ToolViewCtx } from './registry';
import { clampStrokeWidth, isFinitePoint, sanitizePoints, sanitizeStrokeColor } from './safe';

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

/** SVG arc path: semicircle centered at (cx,cy) facing `angle` (rad), radius r. */
function semiArcPath(cx: number, cy: number, r: number, angle: number): string {
  if (!(r > 0) || !Number.isFinite(r) || !Number.isFinite(angle)) return '';
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return '';
  const a0 = angle - Math.PI / 2;
  const a1 = angle + Math.PI / 2;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  // sweep=1, large-arc=0 → 180° arc in the direction of `angle`
  return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
}

function strokeAttrs(ctx: ToolViewCtx, dashed?: boolean): Record<string, string> {
  const sw = clampStrokeWidth(ctx.strokeWidth);
  const attrs: Record<string, string> = {
    fill: 'none',
    stroke: ctx.stroke,
    'stroke-width': String(Math.max(1, sw - (dashed ? 0.5 : 0))),
    'pointer-events': 'stroke',
  };
  if (dashed || ctx.dash) {
    attrs['stroke-dasharray'] = ctx.dash ?? '3 3';
  }
  return attrs;
}

// ── Fib arc (2-pt: concentric semicircles from p1 toward p2) ────────────────

registerToolHandler({
  id: 'fibArc',
  label: 'Fib arc',
  arity: 2,
  create(points, color) {
    const p = sanitizePoints(points);
    if (p.length < 2) return null;
    return {
      id: '',
      kind: 'fibArc',
      p1: p[0]!,
      p2: p[1]!,
      color: sanitizeStrokeColor(color),
    };
  },
  paint(d, ctx) {
    const t = asTwo(d, 'fibArc');
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    const base = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    // Guide radius (level 1)
    ctx.line(a.x, a.y, b.x, b.y, ctx.stroke, 1, '2 2');
    const levels = fibLevelsOf(d);
    const showPct = showPctOf(d, true);
    for (const lvl of levels) {
      if (lvl === 0) continue;
      const r = base * lvl;
      const path = semiArcPath(a.x, a.y, r, angle);
      if (!path) continue;
      ctx.el('path', {
        d: path,
        ...strokeAttrs(ctx, lvl !== 1),
      });
      if (showPct) {
        const lx = a.x + r * Math.cos(angle);
        const ly = a.y + r * Math.sin(angle);
        ctx.label(lx + 4, ly - 3, `${(lvl * 100).toFixed(1)}%`, ctx.stroke, 10);
      }
    }
    if (ctx.selected) {
      ctx.circle(a.x, a.y, 5, ctx.stroke, true);
      ctx.circle(b.x, b.y, 5, ctx.stroke, true);
    }
  },
  hit(d, ctx) {
    const t = asTwo(d, 'fibArc');
    if (!t) return false;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return false;
    if (nearPoint(ctx.x, ctx.y, a.x, a.y, ctx.tol + 2)) return true;
    if (nearPoint(ctx.x, ctx.y, b.x, b.y, ctx.tol + 2)) return true;
    const base = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const dist = Math.hypot(ctx.x - a.x, ctx.y - a.y);
    for (const lvl of fibLevelsOf(d)) {
      if (lvl === 0) continue;
      if (Math.abs(dist - base * lvl) <= ctx.tol) return true;
    }
    return false;
  },
});

// ── Fib wedge (3-pt: apex + two arms; rays at fib-interpolated angles) ──────

registerToolHandler({
  id: 'fibWedge',
  label: 'Fib wedge',
  arity: 3,
  create(points, color) {
    const p = sanitizePoints(points);
    if (p.length < 3) return null;
    return {
      id: '',
      kind: 'fibWedge',
      points: p.slice(0, 3),
      p1: p[0]!,
      p2: p[1]!,
      p3: p[2]!,
      color: sanitizeStrokeColor(color),
    } as MultiPointDrawing;
  },
  paint(d, ctx) {
    if (d.kind !== 'fibWedge') return;
    const p = pts(d);
    if (p.length < 3) return;
    const a = ctx.toXY(p[0]!);
    const b = ctx.toXY(p[1]!);
    const c = ctx.toXY(p[2]!);
    if (!a || !b || !c) return;
    const angB = Math.atan2(b.y - a.y, b.x - a.x);
    const angC = Math.atan2(c.y - a.y, c.x - a.x);
    // Shortest angular span from B → C
    let delta = angC - angB;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const armLen = Math.max(
      Math.hypot(b.x - a.x, b.y - a.y),
      Math.hypot(c.x - a.x, c.y - a.y),
      40,
    );
    const levels = fibLevelsOf(d);
    const showPct = showPctOf(d, true);
    for (const raw of levels) {
      const lvl = isFibReversed(d) ? 1 - raw : raw;
      const ang = angB + delta * lvl;
      const ex = a.x + Math.cos(ang) * armLen;
      const ey = a.y + Math.sin(ang) * armLen;
      const ray = extendSegment(a.x, a.y, ex, ey, 'right', ctx.width, ctx.height);
      const isArm = raw === 0 || raw === 1;
      ctx.line(
        a.x,
        a.y,
        ray.x2,
        ray.y2,
        ctx.stroke,
        isArm ? ctx.strokeWidth : Math.max(1, ctx.strokeWidth - 0.5),
        isArm ? ctx.dash : '3 3',
      );
      if (showPct) {
        ctx.label(
          a.x + Math.cos(ang) * (armLen * 0.55) + 4,
          a.y + Math.sin(ang) * (armLen * 0.55) - 3,
          `${(raw * 100).toFixed(1)}%`,
          ctx.stroke,
          10,
        );
      }
    }
    // Arc guide between arms at unit length
    const steps = 24;
    let dAttr = '';
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ang = angB + delta * t;
      const x = a.x + Math.cos(ang) * armLen * 0.35;
      const y = a.y + Math.sin(ang) * armLen * 0.35;
      dAttr += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    }
    ctx.el('path', { d: dAttr, ...strokeAttrs(ctx, true) });
    if (ctx.selected) {
      ctx.circle(a.x, a.y, 5, ctx.stroke, true);
      ctx.circle(b.x, b.y, 5, ctx.stroke, true);
      ctx.circle(c.x, c.y, 5, ctx.stroke, true);
    }
  },
  hit(d, ctx) {
    if (d.kind !== 'fibWedge') return false;
    const p = pts(d);
    if (p.length < 3) return false;
    const a = ctx.toXY(p[0]!);
    const b = ctx.toXY(p[1]!);
    const c = ctx.toXY(p[2]!);
    if (!a || !b || !c) return false;
    if (nearPoint(ctx.x, ctx.y, a.x, a.y, ctx.tol + 2)) return true;
    if (nearPoint(ctx.x, ctx.y, b.x, b.y, ctx.tol + 2)) return true;
    if (nearPoint(ctx.x, ctx.y, c.x, c.y, ctx.tol + 2)) return true;
    return (
      distToSegment(ctx.x, ctx.y, a.x, a.y, b.x, b.y) <= ctx.tol ||
      distToSegment(ctx.x, ctx.y, a.x, a.y, c.x, c.y) <= ctx.tol
    );
  },
});

// ── Fib circles (2-pt: full circles, radii = fib × |p2−p1|) ─────────────────

registerToolHandler({
  id: 'fibCircles',
  label: 'Fib circles',
  arity: 2,
  create(points, color) {
    const p = sanitizePoints(points);
    if (p.length < 2) return null;
    return {
      id: '',
      kind: 'fibCircles',
      p1: p[0]!,
      p2: p[1]!,
      color: sanitizeStrokeColor(color),
    };
  },
  paint(d, ctx) {
    const t = asTwo(d, 'fibCircles');
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    // Center at p1; unit radius = distance p1→p2 in pixel space
    const cx = a.x;
    const cy = a.y;
    const base = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    ctx.line(a.x, a.y, b.x, b.y, ctx.stroke, 1, '2 2');
    const levels = fibLevelsOf(d);
    const showPct = showPctOf(d, true);
    for (const lvl of levels) {
      if (lvl === 0) continue;
      const r = base * lvl;
      ctx.el('circle', {
        cx: String(cx),
        cy: String(cy),
        r: String(r),
        ...strokeAttrs(ctx, lvl !== 1),
      });
      if (showPct) ctx.label(cx + r + 4, cy - 3, `${(lvl * 100).toFixed(1)}%`, ctx.stroke, 10);
    }
    if (ctx.selected) {
      ctx.circle(a.x, a.y, 5, ctx.stroke, true);
      ctx.circle(b.x, b.y, 5, ctx.stroke, true);
    }
  },
  hit(d, ctx) {
    const t = asTwo(d, 'fibCircles');
    if (!t) return false;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return false;
    if (nearPoint(ctx.x, ctx.y, a.x, a.y, ctx.tol + 2)) return true;
    if (nearPoint(ctx.x, ctx.y, b.x, b.y, ctx.tol + 2)) return true;
    const base = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const dist = Math.hypot(ctx.x - a.x, ctx.y - a.y);
    for (const lvl of fibLevelsOf(d)) {
      if (lvl === 0) continue;
      if (Math.abs(dist - base * lvl) <= ctx.tol) return true;
    }
    return false;
  },
});
