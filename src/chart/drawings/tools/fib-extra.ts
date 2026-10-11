// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Extra Fibonacci tools — arcs, wedge, circles (pixel-space radii / angles).
 */

import type {
  Drawing,
  MultiPointDrawing,
  Point,
  TwoPointDrawing,
} from '../../drawing-types';
import { distToSegment, extendSegment, nearPoint } from '../geometry';
import { levelKey, resolveLevelPaint } from '../level-palette';
import { fibLevelsOf, isFibReversed, showPctOf } from '../tool-settings';
import { registerToolHandler, type ToolViewCtx } from './registry';
import { clampOpacity, clampStrokeWidth, isFinitePoint, sanitizePoints, sanitizeStrokeColor } from './safe';

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

/** SVG arc path: semicircle centered at (cx,cy) facing `angle` (rad), radii rx/ry.
 *  Axis-aligned ellipse arc (rx along X, ry along Y). When rx≈ry this is a
 *  perfect circle; when the trend is at 45° (|dx|≈|dy|) fib levels are round. */
function semiArcPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  angle: number,
): string {
  if (!(rx > 0) || !(ry > 0) || !Number.isFinite(rx) || !Number.isFinite(ry)) return '';
  if (!Number.isFinite(angle)) return '';
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return '';
  const a0 = angle - Math.PI / 2;
  const a1 = angle + Math.PI / 2;
  const x0 = cx + rx * Math.cos(a0);
  const y0 = cy + ry * Math.sin(a0);
  const x1 = cx + rx * Math.cos(a1);
  const y1 = cy + ry * Math.sin(a1);
  // sweep=1, large-arc=0 → 180° elliptical arc in the direction of `angle`
  return `M ${x0} ${y0} A ${rx} ${ry} 0 0 1 ${x1} ${y1}`;
}

/** Elliptical radii for a fib level: independent X/Y scale.
 *  dx/dy are pixel spans p1→p2; lvl is the fib ratio. Degenerate spans
 *  (<2px on either axis, e.g. horizontal/vertical trends) fall back to a
 *  circular radius from the hypotenuse so levels stay visible. */
function fibRadii(dx: number, dy: number, lvl: number): { rx: number; ry: number; circular: boolean } {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const hypo = Math.hypot(ax, ay) || 1;
  let rx = ax * lvl;
  let ry = ay * lvl;
  if (!(rx >= 2) || !(ry >= 2)) {
    const r = hypo * lvl;
    return { rx: r, ry: r, circular: true };
  }
  return { rx, ry, circular: false };
}

function strokeAttrs(ctx: ToolViewCtx, dashed?: boolean, color?: string): Record<string, string> {
  const sw = clampStrokeWidth(ctx.strokeWidth);
  const attrs: Record<string, string> = {
    fill: 'none',
    stroke: color || ctx.stroke,
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
      points: [p[0]!, p[1]!],
      color: sanitizeStrokeColor(color),
    };
  },
  paint(d, ctx) {
    const t = asTwo(d, 'fibArc');
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const angle = Math.atan2(dy, dx);
    // Guide radius (level 1)
    ctx.line(a.x, a.y, b.x, b.y, ctx.stroke, 1, '2 2');
    const levels = fibLevelsOf(d).filter((l) => l !== 0).sort((x, y) => x - y);
    if (!levels.length) return;
    const showPct = showPctOf(d, true);
    const fo = clampOpacity(ctx.fillOpacity, 0.08);
    // Background fills between consecutive arcs (half-annulus, largest→smallest
    // so fills relocate with the same rx/ry as strokes).
    if (fo > 0.01 && levels.length >= 1) {
      const radii = levels.map((lvl) => ({ lvl, ...fibRadii(dx, dy, lvl) }));
      for (let i = radii.length - 1; i >= 0; i--) {
        const cur = radii[i]!;
        const a0 = angle - Math.PI / 2;
        const a1 = angle + Math.PI / 2;
        const x0o = a.x + cur.rx * Math.cos(a0);
        const y0o = a.y + cur.ry * Math.sin(a0);
        const x1o = a.x + cur.rx * Math.cos(a1);
        const y1o = a.y + cur.ry * Math.sin(a1);
        let fillD: string;
        if (i === 0) {
          // Innermost: half-disc from center to first arc
          fillD =
            `M ${a.x} ${a.y} L ${x0o} ${y0o} ` +
            `A ${cur.rx} ${cur.ry} 0 0 1 ${x1o} ${y1o} Z`;
        } else {
          const prev = radii[i - 1]!;
          const x0i = a.x + prev.rx * Math.cos(a0);
          const y0i = a.y + prev.ry * Math.sin(a0);
          const x1i = a.x + prev.rx * Math.cos(a1);
          const y1i = a.y + prev.ry * Math.sin(a1);
          fillD =
            `M ${x0o} ${y0o} A ${cur.rx} ${cur.ry} 0 0 1 ${x1o} ${y1o} ` +
            `L ${x1i} ${y1i} A ${prev.rx} ${prev.ry} 0 0 0 ${x0i} ${y0i} Z`;
        }
        const color = resolveLevelPaint(d, levelKey(cur.lvl), ctx.stroke);
        ctx.el('path', {
          d: fillD,
          fill: color,
          'fill-opacity': String(Math.min(0.25, Math.max(0.02, fo))),
          stroke: 'none',
          'pointer-events': 'none',
        });
      }
    }
    for (const lvl of levels) {
      const { rx, ry } = fibRadii(dx, dy, lvl);
      const path = semiArcPath(a.x, a.y, rx, ry, angle);
      if (!path) continue;
      const color = resolveLevelPaint(d, levelKey(lvl), ctx.stroke);
      ctx.el('path', {
        d: path,
        ...strokeAttrs(ctx, lvl !== 1, color),
      });
      if (showPct) {
        const lx = a.x + rx * Math.cos(angle);
        const ly = a.y + ry * Math.sin(angle);
        ctx.label(lx + 4, ly - 3, `${(lvl * 100).toFixed(1)}%`, color, 10);
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
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    // Trend guide hit
    if (distToSegment(ctx.x, ctx.y, a.x, a.y, b.x, b.y) <= ctx.tol) return true;
    for (const lvl of fibLevelsOf(d)) {
      if (lvl === 0) continue;
      const { rx, ry, circular } = fibRadii(dx, dy, lvl);
      if (circular) {
        const dist = Math.hypot(ctx.x - a.x, ctx.y - a.y);
        if (Math.abs(dist - rx) <= ctx.tol) return true;
      } else {
        // Normalized elliptical radius: 1 = on the arc. Check the facing
        // half (dot with trend direction >= 0) to avoid hitting the back half.
        const nx = (ctx.x - a.x) / rx;
        const ny = (ctx.y - a.y) / ry;
        const r2 = nx * nx + ny * ny;
        if (Math.abs(r2 - 1) > ctx.tol / Math.min(rx, ry) + 0.12) continue;
        const len = Math.hypot(dx, dy) || 1;
        const dot = ((ctx.x - a.x) * dx + (ctx.y - a.y) * dy) / len;
        if (dot >= -ctx.tol) return true;
      }
    }
    return false;
  },
  paintDraft(points, ctx) {
    const p = sanitizePoints(points);
    if (p.length < 2) return;
    const a = ctx.toXY(p[0]!);
    const b = ctx.toXY(p[p.length - 1]!);
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const angle = Math.atan2(dy, dx);
    ctx.line(a.x, a.y, b.x, b.y, ctx.stroke, ctx.strokeWidth, '4 4');
    const { rx, ry } = fibRadii(dx, dy, 1);
    const path = semiArcPath(a.x, a.y, rx, ry, angle);
    if (path) {
      ctx.el('path', {
        d: path,
        fill: 'none',
        stroke: ctx.stroke,
        'stroke-width': String(clampStrokeWidth(ctx.strokeWidth)),
        'stroke-dasharray': '4 4',
        'pointer-events': 'none',
      });
    }
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
      const color = resolveLevelPaint(d, levelKey(raw), ctx.stroke);
      ctx.line(
        a.x,
        a.y,
        ray.x2,
        ray.y2,
        color,
        isArm ? ctx.strokeWidth : Math.max(1, ctx.strokeWidth - 0.5),
        isArm ? ctx.dash : '3 3',
      );
      if (showPct) {
        ctx.label(
          a.x + Math.cos(ang) * (armLen * 0.55) + 4,
          a.y + Math.sin(ang) * (armLen * 0.55) - 3,
          `${(raw * 100).toFixed(1)}%`,
          color,
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

// ── Fib circles (2-pt: concentric ellipses, radii = fib × |dx|,|dy|) ────────
// Independent X/Y radii — round only when the trend is at 45° (|dx|≈|dy|).
// Degenerate (horizontal/vertical) trends fall back to circles so levels stay
// visible. Background fills nest largest→smallest.

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
      points: [p[0]!, p[1]!],
      color: sanitizeStrokeColor(color),
    };
  },
  paint(d, ctx) {
    const t = asTwo(d, 'fibCircles');
    if (!t) return;
    const a = ctx.toXY(t.p1);
    const b = ctx.toXY(t.p2);
    if (!a || !b) return;
    // Center at p1; unit radii = |dx|,|dy| in pixel space (independent X/Y)
    const cx = a.x;
    const cy = a.y;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    ctx.line(a.x, a.y, b.x, b.y, ctx.stroke, 1, '2 2');
    const levels = fibLevelsOf(d).filter((l) => l !== 0).sort((x, y) => x - y);
    if (!levels.length) return;
    const showPct = showPctOf(d, true);
    const fo = clampOpacity(ctx.fillOpacity, 0.08);
    const radii = levels.map((lvl) => ({ lvl, ...fibRadii(dx, dy, lvl) }));
    // Background fills: largest→smallest so each ring relocates with its stroke.
    if (fo > 0.01) {
      for (let i = radii.length - 1; i >= 0; i--) {
        const cur = radii[i]!;
        const color = resolveLevelPaint(d, levelKey(cur.lvl), ctx.stroke);
        if (cur.circular) {
          ctx.el('circle', {
            cx: String(cx),
            cy: String(cy),
            r: String(Math.max(1, cur.rx)),
            fill: color,
            'fill-opacity': String(Math.min(0.25, Math.max(0.02, fo))),
            stroke: 'none',
            'pointer-events': 'none',
          });
        } else {
          ctx.el('ellipse', {
            cx: String(cx),
            cy: String(cy),
            rx: String(Math.max(1, cur.rx)),
            ry: String(Math.max(1, cur.ry)),
            fill: color,
            'fill-opacity': String(Math.min(0.25, Math.max(0.02, fo))),
            stroke: 'none',
            'pointer-events': 'none',
          });
        }
      }
    }
    for (const cur of radii) {
      const color = resolveLevelPaint(d, levelKey(cur.lvl), ctx.stroke);
      if (cur.circular) {
        ctx.el('circle', {
          cx: String(cx),
          cy: String(cy),
          r: String(Math.max(1, cur.rx)),
          ...strokeAttrs(ctx, cur.lvl !== 1, color),
        });
      } else {
        ctx.el('ellipse', {
          cx: String(cx),
          cy: String(cy),
          rx: String(Math.max(1, cur.rx)),
          ry: String(Math.max(1, cur.ry)),
          fill: 'none',
          stroke: color,
          'stroke-width': String(Math.max(1, clampStrokeWidth(ctx.strokeWidth) - (cur.lvl !== 1 ? 0.5 : 0))),
          'pointer-events': 'stroke',
          ...(ctx.dash || cur.lvl !== 1 ? { 'stroke-dasharray': ctx.dash ?? '3 3' } : {}),
        });
      }
      if (showPct)
        ctx.label(cx + cur.rx + 4, cy - 3, `${(cur.lvl * 100).toFixed(1)}%`, color, 10);
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
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (distToSegment(ctx.x, ctx.y, a.x, a.y, b.x, b.y) <= ctx.tol) return true;
    for (const lvl of fibLevelsOf(d)) {
      if (lvl === 0) continue;
      const { rx, ry, circular } = fibRadii(dx, dy, lvl);
      if (circular) {
        const dist = Math.hypot(ctx.x - a.x, ctx.y - a.y);
        if (Math.abs(dist - rx) <= ctx.tol) return true;
      } else {
        const nx = (ctx.x - a.x) / rx;
        const ny = (ctx.y - a.y) / ry;
        const r2 = nx * nx + ny * ny;
        if (Math.abs(r2 - 1) <= ctx.tol / Math.min(rx, ry) + 0.15) return true;
      }
    }
    return false;
  },
  paintDraft(points, ctx) {
    const p = sanitizePoints(points);
    if (p.length < 2) return;
    const a = ctx.toXY(p[0]!);
    const b = ctx.toXY(p[p.length - 1]!);
    if (!a || !b) return;
    ctx.line(a.x, a.y, b.x, b.y, ctx.stroke, ctx.strokeWidth, '4 4');
    const { rx, ry, circular } = fibRadii(b.x - a.x, b.y - a.y, 1);
    if (circular) {
      ctx.el('circle', {
        cx: String(a.x),
        cy: String(a.y),
        r: String(Math.max(1, rx)),
        fill: 'none',
        stroke: ctx.stroke,
        'stroke-width': String(clampStrokeWidth(ctx.strokeWidth)),
        'stroke-dasharray': '4 4',
        'pointer-events': 'none',
      });
    } else {
      ctx.el('ellipse', {
        cx: String(a.x),
        cy: String(a.y),
        rx: String(Math.max(1, rx)),
        ry: String(Math.max(1, ry)),
        fill: 'none',
        stroke: ctx.stroke,
        'stroke-width': String(clampStrokeWidth(ctx.strokeWidth)),
        'stroke-dasharray': '4 4',
        'pointer-events': 'none',
      });
    }
  },
});
