// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Map Pro API / runtime **`drawings`** payloads → SVG-friendly geometry.
 *
 * Accepts both interpret-path shapes (`type` + `t1`/`p1`/…) and compile-path
 * `__drawings` events (`kind` + `x1`/`y1`/`left`/…). Non-geometry kinds
 * (bgcolor, barcolor, plotshape, table, …) are filtered out — tables go to
 * {@link PyneTableHud}; shapes/barcolor to markers / candle tint via plot-visuals.
 * `linefill` is geometry (filled quad between two lines).
 *
 * After normalize, {@link garbageCollectScriptDrawings} trims each type to the
 * Pine declaration caps (`max_lines_count`, `max_labels_count`, …) — oldest
 * first, matching TradingView garbage collection.
 *
 * Future times (`t > last bar`, e.g. `timenow` + `xloc.bar_time`) are clamped
 * at paint time via {@link clampTimeToLastBar} in the drawing layer so LWC can
 * map them; see also {@link clampScriptDrawingTimes}.
 *
 * Consumed by the drawing layer when applying script drawings after a run.
 *
 * @module chart/pyne-drawings
 */

import {
  DRAWING_POINTS_MAX,
  DRAWING_TEXT_MAX,
  sanitizeDrawingText,
  sanitizeStrokeColor,
} from './drawings/tools/safe';

/** Normalized Pine drawing for the SVG overlay. */
export interface ScriptDrawing {
  id: string;
  type: 'line' | 'box' | 'label' | 'polyline' | 'linefill';
  t1: number;
  p1: number;
  t2?: number;
  p2?: number;
  /** linefill: second line endpoints (t3/p3 → t4/p4) */
  t3?: number;
  p3?: number;
  t4?: number;
  p4?: number;
  color: string;
  bgcolor?: string;
  text?: string;
  textcolor?: string;
  width?: number;
  style?: string;
  extend?: string;
  closed?: boolean;
  points?: Array<{ time: number; price: number }>;
}

/**
 * Per-type caps from `indicator()` / `strategy()` declaration.
 * Pine Script™ defaults are 50; hard caps match the language reference (500 / 100).
 */
export interface DrawingLimits {
  max_lines_count: number;
  max_labels_count: number;
  max_boxes_count: number;
  max_polylines_count: number;
}

/** TradingView defaults when the declaration omits the kwargs. */
export const DEFAULT_DRAWING_LIMITS: DrawingLimits = {
  max_lines_count: 50,
  max_labels_count: 50,
  max_boxes_count: 50,
  max_polylines_count: 50,
};

const LIMIT_CAPS: Record<keyof DrawingLimits, number> = {
  max_lines_count: 500,
  max_labels_count: 500,
  max_boxes_count: 500,
  max_polylines_count: 100,
};

/** Hard language-reference caps as {@link DrawingLimits} (normalize safety net). */
const HARD_DRAWING_LIMITS: DrawingLimits = {
  max_lines_count: LIMIT_CAPS.max_lines_count,
  max_labels_count: LIMIT_CAPS.max_labels_count,
  max_boxes_count: LIMIT_CAPS.max_boxes_count,
  max_polylines_count: LIMIT_CAPS.max_polylines_count,
};

/** Mid-pass trim threshold: sum of hard caps + small slack. */
const NORMALIZE_TRIM_AT =
  LIMIT_CAPS.max_lines_count +
  LIMIT_CAPS.max_labels_count +
  LIMIT_CAPS.max_boxes_count +
  LIMIT_CAPS.max_polylines_count +
  64;

/** SVG stroke width clamp (px). */
const WIDTH_MIN = 0.5;
const WIDTH_MAX = 32;

function clampLimit(key: keyof DrawingLimits, n: number): number {
  const cap = LIMIT_CAPS[key];
  if (!Number.isFinite(n)) return DEFAULT_DRAWING_LIMITS[key];
  return Math.min(cap, Math.max(1, Math.floor(n)));
}

function coerceLimit(raw: unknown, key: keyof DrawingLimits): number | undefined {
  if (raw == null) return undefined;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return clampLimit(key, n);
}

/**
 * Read `max_*_count` kwargs from Pine source (`indicator` / `strategy`).
 * Best-effort regex — engine meta is preferred when available.
 */
export function parseDrawingLimitsFromScript(source: string | null | undefined): Partial<DrawingLimits> {
  if (!source || typeof source !== 'string') return {};
  const out: Partial<DrawingLimits> = {};
  const keys: Array<keyof DrawingLimits> = [
    'max_lines_count',
    'max_labels_count',
    'max_boxes_count',
    'max_polylines_count',
  ];
  // Split once (not per key) — scripts can be large.
  const lines = source.split(/\r?\n/);
  for (const key of keys) {
    // `max_labels_count = 100` — skip full-line comments and trailing // comments.
    const loose = new RegExp(`\\b${key}\\s*=\\s*(\\d+)`, 'i');
    let found: number | undefined;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//')) continue;
      const code = trimmed.replace(/\/\/.*$/, '');
      const m = code.match(loose);
      if (m) {
        found = Number(m[1]);
        break;
      }
    }
    if (found != null) out[key] = clampLimit(key, found);
  }
  return out;
}

/**
 * Resolve drawing caps: defaults ← script parse ← engine meta (highest priority).
 */
export function resolveDrawingLimits(
  script?: string | null,
  meta?: Record<string, unknown> | null,
): DrawingLimits {
  const fromScript = parseDrawingLimitsFromScript(script);
  const base: DrawingLimits = {
    ...DEFAULT_DRAWING_LIMITS,
    ...fromScript,
  };
  if (!meta || typeof meta !== 'object') return base;

  const pick = (key: keyof DrawingLimits): number => {
    // Prefer top-level meta, then nested declaration/kwargs blobs if present.
    const direct = coerceLimit(meta[key], key);
    if (direct != null) return direct;
    const decl = meta.declaration;
    if (decl && typeof decl === 'object') {
      const d = decl as Record<string, unknown>;
      const fromDecl = coerceLimit(d[key], key);
      if (fromDecl != null) return fromDecl;
      const kw = d.kwargs;
      if (kw && typeof kw === 'object') {
        const fromKw = coerceLimit((kw as Record<string, unknown>)[key], key);
        if (fromKw != null) return fromKw;
      }
    }
    return base[key];
  };

  return {
    max_lines_count: pick('max_lines_count'),
    max_labels_count: pick('max_labels_count'),
    max_boxes_count: pick('max_boxes_count'),
    max_polylines_count: pick('max_polylines_count'),
  };
}

/**
 * Drop oldest drawings per type when over the declaration caps (Pine GC parity).
 * Assumes array order ≈ creation order (engine export / append order).
 * Keeps relative order of surviving objects.
 */
export function garbageCollectScriptDrawings(
  drawings: ScriptDrawing[],
  limits: DrawingLimits = DEFAULT_DRAWING_LIMITS,
): ScriptDrawing[] {
  if (!Array.isArray(drawings) || !drawings.length) {
    return Array.isArray(drawings) ? drawings : [];
  }

  const caps: Record<ScriptDrawing['type'], number> = {
    line: clampLimit('max_lines_count', limits?.max_lines_count ?? DEFAULT_DRAWING_LIMITS.max_lines_count),
    label: clampLimit('max_labels_count', limits?.max_labels_count ?? DEFAULT_DRAWING_LIMITS.max_labels_count),
    box: clampLimit('max_boxes_count', limits?.max_boxes_count ?? DEFAULT_DRAWING_LIMITS.max_boxes_count),
    polyline: clampLimit(
      'max_polylines_count',
      limits?.max_polylines_count ?? DEFAULT_DRAWING_LIMITS.max_polylines_count,
    ),
  };

  const counts: Record<ScriptDrawing['type'], number> = {
    line: 0,
    label: 0,
    box: 0,
    polyline: 0,
  };
  for (const d of drawings) {
    if (d && d.type in counts) counts[d.type] += 1;
  }

  // How many of each type to skip from the front (oldest).
  const skip: Record<ScriptDrawing['type'], number> = {
    line: Math.max(0, counts.line - caps.line),
    label: Math.max(0, counts.label - caps.label),
    box: Math.max(0, counts.box - caps.box),
    polyline: Math.max(0, counts.polyline - caps.polyline),
  };

  if (!skip.line && !skip.label && !skip.box && !skip.polyline) {
    return drawings;
  }

  const seen: Record<ScriptDrawing['type'], number> = {
    line: 0,
    label: 0,
    box: 0,
    polyline: 0,
    linefill: 0,
  };
  const out: ScriptDrawing[] = [];
  for (const d of drawings) {
    if (!d || !(d.type in seen)) continue;
    const n = seen[d.type]++;
    if (n < skip[d.type]) continue; // garbage-collect oldest
    out.push(d);
  }
  return out;
}

/** Kinds that are not price-geometry (handled elsewhere or ignored). */
const NON_GEOMETRY = new Set([
  'bgcolor',
  'barcolor', // candle tint via plot-visuals / PaneManager — not SVG
  'plotshape',
  'plotchar',
  'plotarrow',
  'fill',
  'set',
  'table',
]);

function parsePolylinePoints(raw: unknown): Array<{ time: number; price: number }> {
  if (!Array.isArray(raw)) return [];
  const points: Array<{ time: number; price: number }> = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const pr = p as Record<string, unknown>;
    // Interpret: time/t · Compile ChartPoint: x/index · price/p/y
    const t = num(pr.time ?? pr.t ?? pr.x ?? pr.index);
    const price = num(pr.price ?? pr.p ?? pr.y);
    if (t == null || price == null) continue;
    points.push({ time: t, price });
    // Cap anchors so a single polyline cannot explode SVG path cost.
    if (points.length >= DRAWING_POINTS_MAX) break;
  }
  return points;
}

/** Finite stroke width in [WIDTH_MIN, WIDTH_MAX], else fallback. */
function clampWidth(raw: unknown, fallback = 1): number {
  const n = num(raw);
  if (n == null) return fallback;
  return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, n));
}

/** Strip Pine prefixes: ``line.style_dashed`` / ``style_dotted`` → ``dashed``/``dotted``. */
export function normalizeLineStyle(raw: unknown, fallback = 'solid'): string {
  if (raw == null) return fallback;
  // Bound work on hostile strings
  if (typeof raw === 'string' && raw.length > 64) return fallback;
  let s = String(raw).toLowerCase().trim();
  if (!s || s.length > 64) return fallback;
  // ``extend.right``-style or fully-qualified constants
  s = s.replace(/^(line|hline|plot)\./, '');
  s = s.replace(/^style_/, '');
  s = s.replace(/^linestyle_/, '');
  if (s.includes('dash')) return 'dashed';
  if (s.includes('dot')) return 'dotted';
  if (s.includes('arrow')) return 'arrow';
  if (s === 'solid' || s === 'none') return s;
  return s || fallback;
}

/** Normalize Pine `extend.*` constants to `left` | `right` | `both` | `none`. */
export function normalizeExtend(raw: unknown, fallback = 'none'): string {
  if (raw == null) return fallback;
  if (typeof raw === 'string' && raw.length > 64) return fallback;
  let s = String(raw).toLowerCase().trim();
  if (!s || s.length > 64) return fallback;
  s = s.replace(/^extend\./, '');
  if (s === 'left' || s === 'right' || s === 'both' || s === 'none') return s;
  return fallback;
}

/**
 * Clamp a time anchor that lies strictly past the last bar to that bar's time.
 *
 * Pine scripts often place labels with `xloc.bar_time` + `timenow` (or other
 * wall-clock times) beyond the series end. LWC `timeToCoordinate` only maps
 * known bar times (`findNearest=false`), so future `t1` would miss and fall
 * through to the bar-index logical fallback — treating unix seconds as indices
 * and stacking/off-scaling the labels. Snapping to the last bar is a low-risk
 * chart UX fix; it does not change Pine GC caps or engine payloads.
 *
 * @param t - Drawing time (unix seconds) or bar index
 * @param lastBarTime - Last series bar time (unix seconds); null skips clamp
 */
export function clampTimeToLastBar(
  t: number,
  lastBarTime: number | null | undefined,
): number {
  const lastOk = lastBarTime != null && Number.isFinite(lastBarTime);
  // Non-finite anchors cannot map in LWC — snap to last bar when known, else 0.
  if (!Number.isFinite(t)) return lastOk ? (lastBarTime as number) : 0;
  if (!lastOk) return t;
  return t > (lastBarTime as number) ? (lastBarTime as number) : t;
}

/**
 * Clamp t1/t2/polyline point times past {@link lastBarTime} (immutable).
 * No-op when lastBarTime is missing or nothing is in the future.
 * Drops polyline vertices with non-finite price; leaves finite coords as-is.
 */
export function clampScriptDrawingTimes(
  drawings: ScriptDrawing[],
  lastBarTime: number | null | undefined,
): ScriptDrawing[] {
  if (!Array.isArray(drawings) || !drawings.length) {
    return Array.isArray(drawings) ? drawings : [];
  }
  if (lastBarTime == null || !Number.isFinite(lastBarTime)) {
    return drawings;
  }
  let changed = false;
  const out: ScriptDrawing[] = [];
  for (const d of drawings) {
    if (!d || typeof d !== 'object') {
      changed = true;
      continue;
    }
    const t1 = clampTimeToLastBar(d.t1, lastBarTime);
    const t2 = d.t2 != null ? clampTimeToLastBar(d.t2, lastBarTime) : d.t2;
    const t3 = d.t3 != null ? clampTimeToLastBar(d.t3, lastBarTime) : d.t3;
    const t4 = d.t4 != null ? clampTimeToLastBar(d.t4, lastBarTime) : d.t4;
    let points = d.points;
    if (points?.length) {
      let ptsChanged = false;
      const nextPts: Array<{ time: number; price: number }> = [];
      for (const p of points) {
        if (!p || !Number.isFinite(p.price) || !Number.isFinite(p.time)) {
          ptsChanged = true;
          continue;
        }
        const time = clampTimeToLastBar(p.time, lastBarTime);
        if (time !== p.time) {
          ptsChanged = true;
          nextPts.push({ time, price: p.price });
        } else {
          nextPts.push(p);
        }
      }
      if (ptsChanged) points = nextPts;
    }
    if (
      t1 === d.t1 &&
      t2 === d.t2 &&
      t3 === d.t3 &&
      t4 === d.t4 &&
      points === d.points
    ) {
      out.push(d);
      continue;
    }
    changed = true;
    const next: ScriptDrawing = { ...d, t1 };
    if (t2 !== undefined) next.t2 = t2;
    if (t3 !== undefined) next.t3 = t3;
    if (t4 !== undefined) next.t4 = t4;
    if (points !== d.points) next.points = points;
    out.push(next);
  }
  return changed ? out : drawings;
}

/**
 * Collapse status-label stacks: when several **labels** share the same time and
 * the same text (common after `label.new` + weak delete + future-time clamp to
 * last bar), keep only the **last** of each group.
 *
 * Matches chart UX for scripts like:
 * `lab = label.new(...); label.delete(lab[1])` — one live status chip, not 50
 * stacked "Sleeping Mode" ghosts. Lines / boxes / polylines are untouched.
 * Distinct texts at the same bar are kept (multi-label HUD).
 */
export function dedupeScriptLabelsAtSameTime(drawings: ScriptDrawing[]): ScriptDrawing[] {
  if (!Array.isArray(drawings) || drawings.length < 2) {
    return Array.isArray(drawings) ? drawings : [];
  }

  // Last occurrence wins per (t1, text) for labels only — O(n) Map, not O(n²).
  const lastByKey = new Map<string, number>();
  for (let i = 0; i < drawings.length; i++) {
    const d = drawings[i]!;
    if (!d || d.type !== 'label') continue;
    const text = (d.text ?? '').trim();
    const key = `${d.t1}\0${text}`;
    lastByKey.set(key, i);
  }
  if (lastByKey.size === 0) return drawings;

  const keepLabelIdx = new Set(lastByKey.values());
  let dropped = 0;
  const out: ScriptDrawing[] = [];
  for (let i = 0; i < drawings.length; i++) {
    const d = drawings[i]!;
    if (!d) {
      dropped++;
      continue;
    }
    if (d.type === 'label' && !keepLabelIdx.has(i)) {
      dropped++;
      continue;
    }
    out.push(d);
  }
  return dropped ? out : drawings;
}

/**
 * Normalize mixed interpret/compile drawing payloads into {@link ScriptDrawing}[].
 * Skips non-geometry kinds (bgcolor, plotshape, table, …).
 *
 * Applies language hard caps mid-pass and at the end so a hostile/huge engine
 * payload cannot allocate unboundedly before caller GC. Callers may still apply
 * tighter declaration limits via {@link garbageCollectScriptDrawings}.
 */
export function normalizeScriptDrawings(raw: unknown[] | undefined | null): ScriptDrawing[] {
  if (!Array.isArray(raw) || !raw.length) return [];
  let out: ScriptDrawing[] = [];
  let i = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    // Cap type/kind string work — refuse absurd keys.
    const typeRaw = r.type ?? r.kind;
    if (typeRaw != null && typeof typeRaw === 'string' && typeRaw.length > 64) continue;
    const type = String(typeRaw || '').toLowerCase().replace(/^drawing\./, '');

    if (!type || NON_GEOMETRY.has(type)) continue;

    // Polylines often only carry `points` (API) or `arg0` (compile fallback) —
    // handle before t1/p1 gate.
    if (type === 'polyline') {
      const points = parsePolylinePoints(r.points ?? r.arg0 ?? r.pts);
      if (points.length < 2) continue;
      out.push({
        id: `pine_poly_${i++}`,
        type: 'polyline',
        t1: points[0]!.time,
        p1: points[0]!.price,
        t2: points[points.length - 1]!.time,
        p2: points[points.length - 1]!.price,
        color: sanitizeStrokeColor(r.color, '#939fff'),
        bgcolor: sanitizeStrokeColor(r.bgcolor, 'rgba(147,159,255,0.06)'),
        width: clampWidth(r.width, 1),
        style: normalizeLineStyle(r.style, 'solid'),
        closed: Boolean(r.closed),
        points,
      });
    } else if (type === 'hline' || type === 'horizontalline' || type === 'horizontal_line') {
      // Compile-mode hline: price-only → full-width horizontal line.
      const price = num(r.price ?? r.p1 ?? r.y ?? r.y1);
      if (price == null) continue;
      out.push({
        id: `pine_hline_${i++}`,
        type: 'line',
        t1: num(r.t1 ?? r.x1 ?? r.bar) ?? 0,
        p1: price,
        t2: num(r.t2 ?? r.x2) ?? 1,
        p2: price,
        color: sanitizeStrokeColor(r.color, '#787B86'),
        width: clampWidth(r.width, 1),
        style: normalizeLineStyle(r.style, 'solid'),
        extend: normalizeExtend(r.extend, 'right'),
        text: sanitizeDrawingText(r.title ?? r.text, DRAWING_TEXT_MAX),
      });
    } else {
      // Time/index: API t1/time · compile x1/left/x · bar index fallback
      const t1 = num(r.t1 ?? r.time ?? r.x1 ?? r.left ?? r.x ?? r.bar);
      const p1 = num(r.p1 ?? r.price ?? r.y1 ?? r.top ?? r.y);
      if (t1 == null || p1 == null) continue;

      if (type === 'line' || type === 'trend' || type === 'ray' || type === 'segment') {
        const t2 = num(r.t2 ?? r.x2 ?? r.right);
        const p2 = num(r.p2 ?? r.y2 ?? r.bottom);
        if (t2 == null || p2 == null) continue;
        const extendDefault = type === 'ray' ? 'right' : 'none';
        out.push({
          id: `pine_line_${i++}`,
          type: 'line',
          t1,
          p1,
          t2,
          p2,
          color: sanitizeStrokeColor(r.color, '#939fff'),
          width: clampWidth(r.width, 1),
          style: normalizeLineStyle(r.style, 'solid'),
          extend: normalizeExtend(r.extend, extendDefault),
        });
      } else if (type === 'box' || type === 'rect' || type === 'rectangle') {
        const t2 = num(r.t2 ?? r.x2 ?? r.right);
        const p2 = num(r.p2 ?? r.y2 ?? r.bottom);
        if (t2 == null || p2 == null) continue;
        out.push({
          id: `pine_box_${i++}`,
          type: 'box',
          t1,
          p1,
          t2,
          p2,
          color: sanitizeStrokeColor(r.color ?? r.border_color, '#939fff'),
          bgcolor: sanitizeStrokeColor(r.bgcolor, 'rgba(147,159,255,0.08)'),
          width: clampWidth(r.width ?? r.border_width, 1),
          text: sanitizeDrawingText(r.text, DRAWING_TEXT_MAX),
        });
      } else if (type === 'label' || type === 'text') {
        out.push({
          id: `pine_label_${i++}`,
          type: 'label',
          t1,
          p1,
          color: sanitizeStrokeColor(r.color, '#939fff'),
          textcolor: sanitizeStrokeColor(r.textcolor ?? r.text_color, '#eceef4'),
          text: sanitizeDrawingText(r.text, DRAWING_TEXT_MAX),
        });
      } else if (type === 'linefill' || type === 'line_fill') {
        // pyne export: line1 (t1/p1→t2/p2) + line2 (t3/p3→t4/p4)
        const t2 = num(r.t2 ?? r.x2);
        const p2 = num(r.p2 ?? r.y2);
        const t3 = num(r.t3 ?? r.x3);
        const p3 = num(r.p3 ?? r.y3);
        const t4 = num(r.t4 ?? r.x4);
        const p4 = num(r.p4 ?? r.y4);
        if (t2 == null || p2 == null || t3 == null || p3 == null || t4 == null || p4 == null) {
          continue;
        }
        const fillColor = sanitizeStrokeColor(
          r.bgcolor ?? r.color,
          'rgba(147,159,255,0.15)',
        );
        out.push({
          id: `pine_linefill_${i++}`,
          type: 'linefill',
          t1,
          p1,
          t2,
          p2,
          t3,
          p3,
          t4,
          p4,
          color: fillColor,
          bgcolor: fillColor,
        });
      }
    }

    // Bound intermediate growth: drop oldest per type at language hard caps.
    if (out.length >= NORMALIZE_TRIM_AT) {
      out = garbageCollectScriptDrawings(out, HARD_DRAWING_LIMITS);
    }
  }
  // Final hard-cap safety net (caller may apply tighter declaration limits).
  return garbageCollectScriptDrawings(out, HARD_DRAWING_LIMITS);
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}
