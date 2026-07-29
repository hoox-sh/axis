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
