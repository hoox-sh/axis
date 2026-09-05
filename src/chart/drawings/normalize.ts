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
 * Accepts every {@link DrawingKind} (placed tools). Tool-only ids (`cursor`,
 * `eraser`) are rejected. Does not touch DOM / LWC / Pine plots.
 */

import {
  DRAWING_COLORS,
  type DrawingKind,
  type Point,
} from '../drawing-types';
import {
  DRAWING_POINTS_MAX,
  DRAWING_TEXT_MAX,
  clampOpacity,
  clampStrokeWidth,
  sanitizeDrawingText,
  sanitizePoints,
  sanitizeStrokeColor,
} from './tools/safe';

/** Cap persisted drawing list length (import / localStorage hydrate). */
export const DRAWING_LIST_MAX = 2_000;

/** Cap drawing id string length. */
const DRAWING_ID_MAX = 128;

/** Max extra meta keys (excluding text) kept from garbage JSON. */
const META_KEYS_MAX = 24;

/** Max meta key name length. */
const META_KEY_MAX = 32;

/** Reject dangerous / non-identifier meta keys. */
const META_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Max points array indices scanned when filtering invalid anchors. */
const POINTS_SCAN_MAX = DRAWING_POINTS_MAX * 4;

// ── Unified model (matches planned ./types) ──────────────────────────────

export type DrawingLineStyle = 'solid' | 'dashed' | 'dotted';

export interface DrawingStyle {
  color: string;
  width: number;
  lineStyle: DrawingLineStyle;
  opacity: number;
  /** Rays (default true): extend past the second point. */
  extendRight?: boolean;
  extendLeft?: boolean;
  fontSize?: number;
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

/**
 * Every persistable {@link DrawingKind}.
 * Excludes tool-only ids: `cursor` / `eraser` (not DrawingKind / not stored).
 */
const VALID_KINDS = new Set<DrawingKind>([
  // 1-point
  'hline',
  'vline',
  'text',
  'priceLabel',
  'note',
  'crossline',
  'flag',
  'anchoredText',
  'arrowMarkUp',
  'arrowMarkDown',
  // 2-point
  'trend',
  'ray',
  'extend',
  'hray',
  'infoLine',
  'trendAngle',
  'rect',
  'rotatedRect',
  'ellipse',
  'arrow',
  'arc',
  'curve',
  'fib',
  'fibtime',
  'fibArc',
  'fibCircles',
  'gannFan',
  'gannBox',
  'gannSquare',
  'measure',
  'dateRange',
  'priceRange',
  'datePriceRange',
  'callout',
  'forecast',
  'long',
  'short',
  // 3-point
  'channel',
  'pitchfork',
  'fibext',
  'fibchannel',
  'fibWedge',
  'triangle',
  // multi / open-ended
  'polyline',
  'path',
  'brush',
  'highlighter',
  'xabcd',
  'headShoulders',
]);

/** Single-anchor kinds (price/time level, labels, marks). */
const ONE_POINT_KINDS = new Set<DrawingKind>([
  'hline',
  'vline',
  'text',
  'priceLabel',
  'note',
  'crossline',
  'flag',
  'anchoredText',
  'arrowMarkUp',
  'arrowMarkDown',
]);

/** Label-like 1-pt kinds that use `p1` + text (not hline/vline special fields). */
const TEXT_LIKE_KINDS = new Set<DrawingKind>([
  'text',
  'priceLabel',
  'note',
  'crossline',
  'flag',
  'anchoredText',
  'arrowMarkUp',
  'arrowMarkDown',
]);

const TWO_POINT_KINDS = new Set<DrawingKind>([
  'trend',
  'ray',
  'extend',
  'hray',
  'infoLine',
  'trendAngle',
  'rect',
  'rotatedRect',
  'ellipse',
  'arrow',
  'arc',
  'curve',
  'fib',
  'fibtime',
  'fibArc',
  'fibCircles',
  'gannFan',
  'gannBox',
  'gannSquare',
  'measure',
  'dateRange',
  'priceRange',
  'datePriceRange',
  'callout',
  'forecast',
  'long',
  'short',
]);

/** Exactly three anchors required to place. */
const THREE_POINT_KINDS = new Set<DrawingKind>([
  'channel',
  'pitchfork',
  'fibext',
  'fibchannel',
  'fibWedge',
  'triangle',
]);

/**
 * Open-ended multi-anchor kinds (double-click finish).
 * Min hydrate count is 2 (polyline/path floor); more points kept up to cap.
 */
const MULTI_POINT_KINDS = new Set<DrawingKind>([
  'polyline',
  'path',
  'brush',
  'highlighter',
  'xabcd',
  'headShoulders',
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

/** Parse `{ time, price }` from unknown JSON; both must be finite (rejects NaN/Infinity). */
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
  if (ONE_POINT_KINDS.has(kind)) return 1;
  if (TWO_POINT_KINDS.has(kind)) return 2;
  if (THREE_POINT_KINDS.has(kind)) return 3;
  if (MULTI_POINT_KINDS.has(kind)) return 2;
  return 1;
}

/**
 * Prefer top-level `text`, then `meta.text` (legacy stores either).
 * Sanitized + length-capped.
 */
function pickText(
  raw: Record<string, unknown>,
  meta: DrawingMeta | undefined,
): string | undefined {
  let candidate: unknown;
  if (typeof raw.text === 'string' && raw.text.length > 0) candidate = raw.text;
  else if (meta && typeof meta.text === 'string' && meta.text.length > 0) {
    candidate = meta.text;
  } else {
    return undefined;
  }
  const cleaned = sanitizeDrawingText(candidate, DRAWING_TEXT_MAX);
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Merge nested `style` with legacy top-level color/width/etc.
 * Rays default `extendRight: true` when unspecified.
 * Color is stroke-safe; width/opacity clamped for paint.
 */
function buildStyle(
  kind: DrawingKind,
  raw: Record<string, unknown>,
  styleRaw: Record<string, unknown> | undefined,
): DrawingStyle {
  const colorRaw =
    (typeof styleRaw?.color === 'string' && styleRaw.color) ||
    (typeof raw.color === 'string' && raw.color) ||
    DEFAULT_COLOR;
  const color = sanitizeStrokeColor(colorRaw, DEFAULT_COLOR);

  const width = clampStrokeWidth(
    asFiniteNumber(styleRaw?.width) ?? asFiniteNumber(raw.width) ?? DEFAULT_WIDTH,
    DEFAULT_WIDTH,
  );

  const lineStyle =
    normalizeLineStyle(styleRaw?.lineStyle) ??
    normalizeLineStyle(raw.lineStyle) ??
    DEFAULT_LINE_STYLE;

  const opacity = clampOpacity(
    asFiniteNumber(styleRaw?.opacity) ??
      asFiniteNumber(raw.opacity) ??
      DEFAULT_OPACITY,
    DEFAULT_OPACITY,
  );

  const style: DrawingStyle = {
    color,
    width,
    lineStyle,
    opacity,
  };

  const extRaw = styleRaw?.extendRight ?? raw.extendRight;
  if (typeof extRaw === 'boolean') {
    style.extendRight = extRaw;
  } else if (kind === 'ray' || kind === 'hray') {
    style.extendRight = true;
  } else if (kind === 'extend' || kind === 'channel') {
    style.extendRight = true;
  }

  const extLeftRaw = styleRaw?.extendLeft ?? raw.extendLeft;
  if (typeof extLeftRaw === 'boolean') {
    style.extendLeft = extLeftRaw;
  } else if (kind === 'extend' || kind === 'channel') {
    style.extendLeft = true;
  }

  const fontRaw = asFiniteNumber(styleRaw?.fontSize) ?? asFiniteNumber(raw.fontSize);
  if (fontRaw != null) {
    style.fontSize = Math.max(8, Math.min(32, Math.round(fontRaw)));
  }

  return style;
}

/** Keep only plain JSON scalars on meta (no nested objects / prototype keys). */
function sanitizeMetaScalar(v: unknown): string | number | boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = sanitizeDrawingText(v, DRAWING_TEXT_MAX);
    return cleaned.length > 0 ? cleaned : undefined;
  }
  return undefined;
}

function buildMeta(
  raw: Record<string, unknown>,
  text: string | undefined,
): DrawingMeta | undefined {
  const base: DrawingMeta = {};
  if (isRecord(raw.meta)) {
    let kept = 0;
    // Object.keys skips non-enumerable; never use Object.assign on untrusted meta
    // (assign can trigger __proto__ pollution on some engines).
    for (const key of Object.keys(raw.meta)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      if (key === 'text') continue; // applied below from pickText / sanitized path
      if (key.length === 0 || key.length > META_KEY_MAX || !META_KEY_RE.test(key)) {
        continue;
      }
      if (key === 'fibLevels' && Array.isArray(raw.meta[key])) {
        const levels: number[] = [];
        for (const item of raw.meta[key] as unknown[]) {
          const n = asFiniteNumber(item);
          if (n == null) continue;
          levels.push(Math.max(-10, Math.min(20, n)));
          if (levels.length >= 24) break;
        }
        if (levels.length) {
          base.fibLevels = levels;
          kept += 1;
          if (kept >= META_KEYS_MAX) break;
        }
        continue;
      }
      const val = sanitizeMetaScalar(raw.meta[key]);
      if (val === undefined) continue;
      base[key] = val;
      kept += 1;
      if (kept >= META_KEYS_MAX) break;
    }
  }
  if (text != null) {
    base.text = text;
  }
  // Drop empty meta
  if (Object.keys(base).length === 0) return undefined;
  return base;
}

/**
 * Collect points from new `points[]` or legacy `p1`/`p2`/`p3`/`price` fields.
 *
 * Preference order:
 * 1. Non-empty `points[]` with enough valid anchors for `kind` (capped)
 * 2. Kind-specific legacy fields:
 *    - `hline` → `price` (or `p1.price`); synthetic `{ time: 0, price }`
 *    - `vline` → `time` (or `p1.time`)
 *    - text-like 1-pt → `p1`
 *    - two-point kinds → `p1` + `p2`
 *    - three-point kinds → `p1` + `p2` + `p3`
 *    - multi → `p1` + `p2` (+ optional further via points[])
 */
function collectPoints(
  kind: DrawingKind,
  raw: Record<string, unknown>,
): Point[] | null {
  const need = minPointsFor(kind);

  // Prefer points[] when present and non-empty — filter NaN/Infinity, cap length.
  // Single pass with scan cap: avoid map/filter allocating full huge arrays.
  if (Array.isArray(raw.points) && raw.points.length > 0) {
    const pts: Point[] = [];
    const scanLimit = Math.min(raw.points.length, POINTS_SCAN_MAX);
    for (let i = 0; i < scanLimit && pts.length < DRAWING_POINTS_MAX; i++) {
      const p = normalizePoint(raw.points[i]);
      if (p) pts.push(p);
    }
    if (pts.length >= need) return pts;
    // fall through to legacy fields if points were invalid / too few
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

  if (TEXT_LIKE_KINDS.has(kind)) {
    const p1 = normalizePoint(raw.p1);
    if (!p1) return null;
    return [p1];
  }

  // Multi / three / two-point: assemble from p1, p2, p3…
  const legacy: Point[] = [];
  const p1 = normalizePoint(raw.p1);
  const p2 = normalizePoint(raw.p2);
  const p3 = normalizePoint(raw.p3);
  if (p1) legacy.push(p1);
  if (p2) legacy.push(p2);
  if (p3) legacy.push(p3);

  // Some multi drawings may only have p1/p2 on disk; still accept if enough
  if (legacy.length >= need) {
    return sanitizePoints(legacy, DRAWING_POINTS_MAX);
  }

  return null;
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

  let id =
    typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : genId();
  if (id.length > DRAWING_ID_MAX) id = id.slice(0, DRAWING_ID_MAX);

  const styleIn = isRecord(raw.style) ? raw.style : undefined;
  const style = buildStyle(kind, raw, styleIn);

  const metaIn = isRecord(raw.meta) ? (raw.meta as DrawingMeta) : undefined;
  const text = pickText(raw, metaIn);
  // Text-like drawings always carry a label in meta (empty string if absent).
  const meta = buildMeta(
    raw,
    text ?? (TEXT_LIKE_KINDS.has(kind) ? '' : undefined),
  );

  const out: Drawing = { id, kind, points, style };
  if (meta) out.meta = meta;
  // Dual-shape: also attach legacy fields so drawing-layer paint/hit-test
  // keep working until the layer fully migrates to points[].
  return attachLegacyFields(out);
}

/**
 * Attach legacy `price` / `p1` / `p2` / `p3` / `text` / top-level `color` for the current SVG layer.
 *
 * Mirrors (in place, on the same object):
 * - always: `color` ← `style.color`
 * - hline: `price` ← `points[0].price`
 * - vline: `time` ← `points[0].time`
 * - text-like 1-pt: `p1`, `text` ← first point + meta
 * - ≥2 points: `p1`, `p2` (+ `p3` when ≥3; optional `text` from meta)
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
  } else if (TEXT_LIKE_KINDS.has(d.kind) && d.points[0]) {
    any.p1 = { ...d.points[0] };
    any.text = d.meta?.text ?? '';
  } else if (d.points.length >= 2) {
    any.p1 = { ...d.points[0]! };
    any.p2 = { ...d.points[1]! };
    if (d.points.length >= 3) {
      any.p3 = { ...d.points[2]! };
    }
    if (d.meta?.text) any.text = d.meta.text;
  }
  return d;
}

/**
 * Normalize a persisted drawings array. Non-arrays → []. Invalid entries dropped.
 * Caps at {@link DRAWING_LIST_MAX} valid drawings (O(n) scan, early stop).
 */
export function normalizeUserDrawings(raw: unknown): Drawing[] {
  if (!Array.isArray(raw)) return [];
  const out: Drawing[] = [];
  for (let i = 0; i < raw.length && out.length < DRAWING_LIST_MAX; i++) {
    const d = normalizeDrawing(raw[i]);
    if (d) out.push(d);
  }
  return out;
}
