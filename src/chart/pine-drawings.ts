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
 * (bgcolor, plotshape, table, …) are filtered out — tables go to
 * {@link PineTableHud}; shapes to markers via plot-visuals.
 *
 * After normalize, {@link garbageCollectScriptDrawings} trims each type to the
 * Pine declaration caps (`max_lines_count`, `max_labels_count`, …) — oldest
 * first, matching TradingView garbage collection.
 *
 * Consumed by the drawing layer when applying script drawings after a run.
 *
 * @module chart/pine-drawings
 */

/** Normalized Pine drawing for the SVG overlay. */
export interface ScriptDrawing {
  id: string;
  type: 'line' | 'box' | 'label' | 'polyline';
  t1: number;
  p1: number;
  t2?: number;
  p2?: number;
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
  if (!source) return {};
  const out: Partial<DrawingLimits> = {};
  const keys: Array<keyof DrawingLimits> = [
    'max_lines_count',
    'max_labels_count',
    'max_boxes_count',
    'max_polylines_count',
  ];
  for (const key of keys) {
    // `max_labels_count = 100` — skip full-line comments and trailing // comments.
    const loose = new RegExp(`\\b${key}\\s*=\\s*(\\d+)`, 'i');
    const lines = source.split(/\r?\n/);
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
  if (!drawings.length) return drawings;

  const caps: Record<ScriptDrawing['type'], number> = {
    line: clampLimit('max_lines_count', limits.max_lines_count),
    label: clampLimit('max_labels_count', limits.max_labels_count),
    box: clampLimit('max_boxes_count', limits.max_boxes_count),
    polyline: clampLimit('max_polylines_count', limits.max_polylines_count),
  };

  const counts: Record<ScriptDrawing['type'], number> = {
    line: 0,
    label: 0,
    box: 0,
    polyline: 0,
  };
  for (const d of drawings) counts[d.type] += 1;

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
  };
  const out: ScriptDrawing[] = [];
  for (const d of drawings) {
    const n = seen[d.type]++;
    if (n < skip[d.type]) continue; // garbage-collect oldest
    out.push(d);
  }
  return out;
}

/** Kinds that are not price-geometry (handled elsewhere or ignored). */
const NON_GEOMETRY = new Set([
  'bgcolor',
  'barcolor',
  'plotshape',
  'plotchar',
  'plotarrow',
  'fill',
  'set',
  'table',
  'linefill',
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
  }
  return points;
}

/** Strip Pine prefixes: ``line.style_dashed`` / ``style_dotted`` → ``dashed``/``dotted``. */
export function normalizeLineStyle(raw: unknown, fallback = 'solid'): string {
  if (raw == null) return fallback;
  let s = String(raw).toLowerCase().trim();
  if (!s) return fallback;
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
  let s = String(raw).toLowerCase().trim();
  if (!s) return fallback;
  s = s.replace(/^extend\./, '');
  if (s === 'left' || s === 'right' || s === 'both' || s === 'none') return s;
  return fallback;
}

/**
 * Normalize mixed interpret/compile drawing payloads into {@link ScriptDrawing}[].
 * Skips non-geometry kinds (bgcolor, plotshape, table, …).
 */
export function normalizeScriptDrawings(raw: unknown[] | undefined | null): ScriptDrawing[] {
  if (!raw?.length) return [];
  const out: ScriptDrawing[] = [];
  let i = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const type = String(r.type || r.kind || '').toLowerCase().replace(/^drawing\./, '');

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
        color: str(r.color, '#939fff'),
        bgcolor: str(r.bgcolor, 'rgba(147,159,255,0.06)'),
        width: num(r.width) ?? 1,
        style: normalizeLineStyle(r.style, 'solid'),
        closed: Boolean(r.closed),
        points,
      });
      continue;
    }

    // Compile-mode hline: price-only → full-width horizontal line.
    if (type === 'hline' || type === 'horizontalline' || type === 'horizontal_line') {
      const price = num(r.price ?? r.p1 ?? r.y ?? r.y1);
      if (price == null) continue;
      out.push({
        id: `pine_hline_${i++}`,
        type: 'line',
        t1: num(r.t1 ?? r.x1 ?? r.bar) ?? 0,
        p1: price,
        t2: num(r.t2 ?? r.x2) ?? 1,
        p2: price,
        color: str(r.color, '#787B86'),
        width: num(r.width) ?? 1,
        style: normalizeLineStyle(r.style, 'solid'),
        extend: normalizeExtend(r.extend, 'right'),
        text: str(r.title ?? r.text, ''),
      });
      continue;
    }

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
        color: str(r.color, '#939fff'),
        width: num(r.width) ?? 1,
        style: normalizeLineStyle(r.style, 'solid'),
        extend: normalizeExtend(r.extend, extendDefault),
      });
      continue;
    }
    if (type === 'box' || type === 'rect' || type === 'rectangle') {
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
        color: str(r.color ?? r.border_color, '#939fff'),
        bgcolor: str(r.bgcolor, 'rgba(147,159,255,0.08)'),
        width: num(r.width ?? r.border_width) ?? 1,
        text: str(r.text, ''),
      });
      continue;
    }
    if (type === 'label' || type === 'text') {
      out.push({
        id: `pine_label_${i++}`,
        type: 'label',
        t1,
        p1,
        color: str(r.color, '#939fff'),
        textcolor: str(r.textcolor ?? r.text_color, '#eceef4'),
        text: str(r.text, ''),
      });
    }
  }
  return out;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function str(v: unknown, fallback: string): string {
  if (v == null) return fallback;
  const s = String(v);
  return s || fallback;
}
