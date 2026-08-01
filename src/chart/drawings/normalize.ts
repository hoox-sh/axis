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
 * Normalize user chart drawings from localStorage / mixed shapes into a
 * unified points-based Drawing model.
 *
 * Accepts:
 * 1) Legacy shapes (`hline.price` / two-point `p1`+`p2` / `text.p1`)
 * 2) New shape `{ id, kind, points[], style?, meta? }`
 *
 * **Dual shape on output:** every successful hydrate returns a drawing that
 * always has `points[]` (canonical), and also attaches legacy top-level fields
 * (`price`, `p1`, `p2`, `text`, `color`) so current SVG paint/hit-test layers
 * keep working until they fully migrate to `points[]`.
 *
 * Accepts runtime kinds: hline, vline, trend, ray, extend, rect, ellipse,
 * arrow, fib, measure, text. Does not touch DOM / LWC / Pine plots.
 */

import {
  DRAWING_COLORS,
  type DrawingKind,
  type Point,
} from '../drawing-types';

// ── Unified model (matches planned ./types) ──────────────────────────────

export type DrawingLineStyle = 'solid' | 'dashed' | 'dotted';

export interface DrawingStyle {
  color: string;
  width: number;
  lineStyle: DrawingLineStyle;
  opacity: number;
  /** Rays (default true): extend past the second point. */
  extendRight?: boolean;
}

export interface DrawingMeta {
  text?: string;
  [key: string]: unknown;
}

/**
 * Points-based user drawing (new unified shape).
 * After {@link normalizeDrawing}, legacy mirror fields may also be present
 * on the object (see {@link attachLegacyFields}).
 */
export interface Drawing {
  id: string;
  kind: DrawingKind;
  points: Point[];
  style: DrawingStyle;
  meta?: DrawingMeta;
}

/** @deprecated Alias kept for call-sites that say NewDrawing. */
export type NewDrawing = Drawing;

// ── Defaults (matches planned ./defaults) ────────────────────────────────

const DEFAULT_COLOR = DRAWING_COLORS.default || '#939fff';
const DEFAULT_WIDTH = 1.5;
const DEFAULT_LINE_STYLE: DrawingLineStyle = 'solid';
const DEFAULT_OPACITY = 1;

/** Kind set currently accepted by this normalizer (must match runtime paint). */
const VALID_KINDS = new Set<DrawingKind>([
  'hline',
  'vline',
  'trend',
  'ray',
  'extend',
  'rect',
  'ellipse',
  'arrow',
  'fib',
  'measure',
  'text',
]);

const TWO_POINT_KINDS = new Set<DrawingKind>([
  'trend',
  'ray',
  'extend',
  'rect',
  'ellipse',
  'arrow',
  'fib',
  'measure',
]);

function genId(): string {
  return `dw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/** Coerce number | numeric string to a finite number; else null. */
function asFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Parse `{ time, price }` from unknown JSON; both must be finite. */
function normalizePoint(raw: unknown): Point | null {
  if (!isRecord(raw)) return null;
  const time = asFiniteNumber(raw.time);
  const price = asFiniteNumber(raw.price);
  if (time == null || price == null) return null;
  return { time, price };
}

function normalizeLineStyle(raw: unknown): DrawingLineStyle | null {
  if (raw === 'solid' || raw === 'dashed' || raw === 'dotted') return raw;
  return null;
}

function minPointsFor(kind: DrawingKind): number {
  if (kind === 'hline' || kind === 'vline' || kind === 'text') return 1;
  if (TWO_POINT_KINDS.has(kind)) return 2;
  return 1;
}

/**
 * Prefer top-level `text`, then `meta.text` (legacy stores either).
 */
function pickText(
  raw: Record<string, unknown>,
  meta: DrawingMeta | undefined,
): string | undefined {
  if (typeof raw.text === 'string' && raw.text.length > 0) return raw.text;
  if (meta && typeof meta.text === 'string' && meta.text.length > 0) return meta.text;
  return undefined;
}

/**
 * Merge nested `style` with legacy top-level color/width/etc.
 * Rays default `extendRight: true` when unspecified.
 */
function buildStyle(
  kind: DrawingKind,
  raw: Record<string, unknown>,
  styleRaw: Record<string, unknown> | undefined,
): DrawingStyle {
  const color =
    (typeof styleRaw?.color === 'string' && styleRaw.color) ||
    (typeof raw.color === 'string' && raw.color) ||
    DEFAULT_COLOR;

  const width =
    asFiniteNumber(styleRaw?.width) ??
    asFiniteNumber(raw.width) ??
    DEFAULT_WIDTH;

  const lineStyle =
    normalizeLineStyle(styleRaw?.lineStyle) ??
    normalizeLineStyle(raw.lineStyle) ??
    DEFAULT_LINE_STYLE;

  const opacity =
    asFiniteNumber(styleRaw?.opacity) ??
    asFiniteNumber(raw.opacity) ??
    DEFAULT_OPACITY;

  const style: DrawingStyle = {
    color,
    width,
    lineStyle,
    opacity,
  };

  const extRaw = styleRaw?.extendRight ?? raw.extendRight;
  if (typeof extRaw === 'boolean') {
    style.extendRight = extRaw;
  } else if (kind === 'ray') {
    style.extendRight = true;
  }

  return style;
}

function buildMeta(
  raw: Record<string, unknown>,
  text: string | undefined,
): DrawingMeta | undefined {
  const base = isRecord(raw.meta) ? { ...(raw.meta as DrawingMeta) } : {};
  if (text != null) base.text = text;
  // Drop empty meta
  if (Object.keys(base).length === 0) return undefined;
  return base;
}

/**
 * Collect points from new `points[]` or legacy `p1`/`p2`/`price` fields.
 *
 * Preference order:
 * 1. Non-empty `points[]` with enough valid anchors for `kind`
 * 2. Kind-specific legacy fields:
 *    - `hline` → `price` (or `p1.price`); synthetic `{ time: 0, price }`
 *    - `text` → `p1`
 *    - two-point kinds → `p1` + `p2`
 */
function collectPoints(
  kind: DrawingKind,
  raw: Record<string, unknown>,
): Point[] | null {
  // Prefer points[] when present and non-empty
  if (Array.isArray(raw.points) && raw.points.length > 0) {
    const pts: Point[] = [];
    for (const p of raw.points) {
      const np = normalizePoint(p);
      if (np) pts.push(np);
    }
    if (pts.length >= minPointsFor(kind)) return pts;
    // fall through to legacy fields if points were invalid
  }

  if (kind === 'hline') {
    const price =
      asFiniteNumber(raw.price) ??
      (isRecord(raw.p1) ? asFiniteNumber(raw.p1.price) : null);
    if (price == null) return null;
    // time is unused for hline render; keep a finite placeholder
    return [{ time: 0, price }];
  }

  if (kind === 'vline') {
    const time =
      asFiniteNumber(raw.time) ??
      (isRecord(raw.p1) ? asFiniteNumber(raw.p1.time) : null);
    if (time == null) return null;
    // price unused for vline paint; placeholder for points model
    const price =
      asFiniteNumber(raw.price) ??
      (isRecord(raw.p1) ? asFiniteNumber(raw.p1.price) : null) ??
      0;
    return [{ time, price }];
  }

  if (kind === 'text') {
    const p1 = normalizePoint(raw.p1);
    if (!p1) return null;
    return [p1];
  }

  // two-point kinds
  const p1 = normalizePoint(raw.p1);
  const p2 = normalizePoint(raw.p2);
  if (!p1 || !p2) return null;
  return [p1, p2];
}

/**
 * Normalize one raw drawing (legacy or new) into the unified shape.
 * Returns null for invalid / unknown kinds.
 *
 * Output is dual-shaped: `points` + style/meta, plus legacy mirrors via
 * {@link attachLegacyFields}.
 */
export function normalizeDrawing(raw: unknown): Drawing | null {
  if (!isRecord(raw)) return null;

  const kindRaw = raw.kind;
  if (typeof kindRaw !== 'string' || !VALID_KINDS.has(kindRaw as DrawingKind)) {
    return null;
  }
  const kind = kindRaw as DrawingKind;

  const points = collectPoints(kind, raw);
  if (!points) return null;

  const id =
    typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : genId();

  const styleIn = isRecord(raw.style) ? raw.style : undefined;
  const style = buildStyle(kind, raw, styleIn);

  const metaIn = isRecord(raw.meta) ? (raw.meta as DrawingMeta) : undefined;
  const text = pickText(raw, metaIn);
  // Text drawings always carry a label in meta (empty string if absent).
  const meta = buildMeta(raw, text ?? (kind === 'text' ? '' : undefined));

  const out: Drawing = { id, kind, points, style };
  if (meta) out.meta = meta;
  // Dual-shape: also attach legacy fields so drawing-layer paint/hit-test
  // keep working until the layer fully migrates to points[].
  return attachLegacyFields(out);
}

/**
 * Attach legacy `price` / `p1` / `p2` / `text` / top-level `color` for the current SVG layer.
 *
 * Mirrors (in place, on the same object):
 * - always: `color` ← `style.color`
 * - hline: `price` ← `points[0].price`
 * - text: `p1`, `text` ← first point + meta
 * - ≥2 points: `p1`, `p2` (+ optional `text` from meta)
 *
 * Callers that only need the unified model may ignore the extra keys; they
 * remain enumerable for layers that still read the pre-unified shape.
 */
export function attachLegacyFields(d: Drawing): Drawing {
  const any = d as Drawing & Record<string, unknown>;
  any.color = d.style.color;
  if (d.kind === 'hline' && d.points[0]) {
    any.price = d.points[0].price;
  } else if (d.kind === 'vline' && d.points[0]) {
    any.time = d.points[0].time;
  } else if (d.kind === 'text' && d.points[0]) {
    any.p1 = { ...d.points[0] };
    any.text = d.meta?.text ?? '';
  } else if (d.points.length >= 2) {
    any.p1 = { ...d.points[0]! };
    any.p2 = { ...d.points[1]! };
    if (d.meta?.text) any.text = d.meta.text;
  }
  return d;
}

/**
 * Normalize a persisted drawings array. Non-arrays → []. Invalid entries dropped.
 */
export function normalizeUserDrawings(raw: unknown): Drawing[] {
  if (!Array.isArray(raw)) return [];
  const out: Drawing[] = [];
  for (const item of raw) {
    const d = normalizeDrawing(item);
    if (d) out.push(d);
  }
  return out;
}
