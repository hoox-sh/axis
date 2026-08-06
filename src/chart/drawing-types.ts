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
 * AXIS interactive drawing model — chart annotations placed by the user.
 *
 * Distinct from Pine script drawings (`pine-drawings.ts` / `DrawingLayer` script
 * group): these are editable, selectable, and persisted via the store.
 *
 * ## Dual field shape (legacy + unified)
 * Runtime geometry uses kind-specific legacy fields (`price`, `p1`/`p2`). Style
 * also lives on both flat fields (`color`, `lineWidth`, `lineStyle`) and a nested
 * `style` object. Prefer {@link resolveDrawingStyle} for paint/lock reads so either
 * form works; create/patch paths write both so older persisted drawings keep working.
 */

/** Active toolbar tool (includes non-placing `cursor`). */
export type DrawingToolId =
  | 'cursor'
  | 'hline'
  | 'vline'
  | 'trend'
  | 'ray'
  | 'extend'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'fib'
  | 'measure'
  | 'text';

/** Placed drawing kinds only (excludes the select cursor). */
export type DrawingKind = Exclude<DrawingToolId, 'cursor'>;

/** Chart anchor in series space: unix seconds (or logical bar index for some script x). */
export interface Point {
  time: number;
  price: number;
}

/** Stroke pattern for user drawings. */
export type DrawingLineStyle = 'solid' | 'dashed' | 'dotted';

/**
 * Shared fields for every user drawing.
 * Geometry is on the kind-specific interfaces; style uses dual legacy + `style`.
 */
export interface DrawingBase {
  id: string;
  kind: DrawingKind;
  /** Legacy stroke color (also mirrored under `style.color` when created by the layer). */
  color: string;
  /** Optional user label (text tool also sets this as the visible string). */
  text?: string;
  /** Legacy stroke width (default 1.5). Prefer `style.width` when both exist. */
  lineWidth?: number;
  /** Legacy stroke pattern. Prefer `style.lineStyle` when both exist. */
  lineStyle?: DrawingLineStyle;
  /** Fill opacity 0–1 for shapes (rect); not dual-mirrored into `style` today. */
  fillOpacity?: number;
  /** When true, layer refuses drag/delete (unless unlocked). Also read from `meta.locked`. */
  locked?: boolean;
  /**
   * Optional dual-shape geometry from normalize / future unified model.
   * Layer still paints via `price` / `p1` / `p2`; `points` is kept for round-trip.
   */
  points?: Point[];
  /**
   * Nested style (preferred when set). Created drawings mirror color/width/lineStyle
   * here so consumers can migrate off flat fields gradually.
   */
  style?: {
    color?: string;
    width?: number;
    lineStyle?: DrawingLineStyle;
    opacity?: number;
    extendRight?: boolean;
    extendLeft?: boolean;
  };
  /**
   * Free-form metadata.
   * - `meta.locked` is treated like top-level `locked`
   * - `meta.symbol` anchors the drawing to a chart symbol (uppercased ticker);
   *   the layer only paints drawings for the active symbol (plus untagged legacy)
   * - `meta.hidden` hides the drawing in the layer / Layers panel
   */
  meta?: {
    text?: string;
    locked?: boolean;
    /** Uppercased ticker this drawing belongs to (e.g. `BTCUSDT`). */
    symbol?: string;
    hidden?: boolean;
    [key: string]: unknown;
  };
}

/** Full-width horizontal price level. */
export interface HLineDrawing extends DrawingBase {
  kind: 'hline';
  price: number;
}

/** Full-height vertical time level. */
export interface VLineDrawing extends DrawingBase {
  kind: 'vline';
  time: number;
}

/** Two-anchor drawings: lines, shapes, fib, measure. */
export interface TwoPointDrawing extends DrawingBase {
  kind: 'trend' | 'ray' | 'extend' | 'rect' | 'ellipse' | 'arrow' | 'fib' | 'measure';
  p1: Point;
  p2: Point;
}

/** Point label with free text (prompted on place). */
export interface TextDrawing extends DrawingBase {
  kind: 'text';
  p1: Point;
  text: string;
}

/** Discriminated union of user drawings stored in the app state. */
export type Drawing = HLineDrawing | VLineDrawing | TwoPointDrawing | TextDrawing;

/** Palette used by the toolbar presets and layer defaults. */
export const DRAWING_COLORS = {
  default: '#939fff',
  up: '#5ecf8a',
  down: '#e85d4c',
  measure: '#e8a03a',
  muted: 'rgba(147, 159, 255, 0.55)',
} as const;

/**
 * Resolve paint + lock flags from dual legacy/unified drawing fields.
 * Precedence: nested `style.*` → flat `color`/`lineWidth`/`lineStyle` → defaults.
 * `locked` is true if either `d.locked` or `d.meta?.locked` is set.
 */
export function resolveDrawingStyle(d: DrawingBase): {
  color: string;
  width: number;
  lineStyle: DrawingLineStyle;
  fillOpacity: number;
  locked: boolean;
} {
  return {
    color: d.style?.color || d.color || DRAWING_COLORS.default,
    width: d.style?.width ?? d.lineWidth ?? 1.5,
    lineStyle: d.style?.lineStyle ?? d.lineStyle ?? 'solid',
    fillOpacity: d.fillOpacity ?? 0.15,
    locked: Boolean(d.locked ?? d.meta?.locked),
  };
}

/** Fibonacci retracement ratios painted between p1→p2 price span. */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

/** Tools that need two click anchors (draft → place) rather than one click. */
export function needsTwoPoints(tool: DrawingToolId): boolean {
  return (
    tool === 'trend' ||
    tool === 'ray' ||
    tool === 'extend' ||
    tool === 'rect' ||
    tool === 'ellipse' ||
    tool === 'arrow' ||
    tool === 'fib' ||
    tool === 'measure'
  );
}

/** Human-readable label for toolbar flyouts and titles. */
export function toolLabel(tool: DrawingToolId): string {
  switch (tool) {
    case 'cursor':
      return 'Cursor';
    case 'hline':
      return 'Horizontal line';
    case 'vline':
      return 'Vertical line';
    case 'trend':
      return 'Trend line';
    case 'ray':
      return 'Ray';
    case 'extend':
      return 'Extended line';
    case 'rect':
      return 'Rectangle';
    case 'ellipse':
      return 'Ellipse';
    case 'arrow':
      return 'Arrow';
    case 'fib':
      return 'Fibonacci';
    case 'measure':
      return 'Measure';
    case 'text':
      return 'Text';
  }
}
