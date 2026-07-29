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
 * Unified interactive drawing model (D0 foundation).
 * Compatible with migration from legacy `drawing-types.ts` shapes.
 */

// ── Geometry ────────────────────────────────────────────────────────────────

/** Chart coordinate in series time / price space. */
export interface ChartPoint {
  time: number;
  price: number;
}

/**
 * Alias of {@link ChartPoint} — matches legacy `Point` from `drawing-types.ts`.
 * Prefer `ChartPoint` in new code.
 */
export type Point = ChartPoint;

// ── Style ───────────────────────────────────────────────────────────────────

export type LineStyle = 'solid' | 'dashed' | 'dotted';

export interface DrawingStyle {
  color: string;
  width: number;
  lineStyle: LineStyle;
  /** Optional fill color (rects, channels, ellipses, fib zones). */
  fill?: string;
  opacity: number;
  extendLeft: boolean;
  extendRight: boolean;
  fontSize: number;
}

// ── Kind / tool ids ─────────────────────────────────────────────────────────

/**
 * Persisted drawing kinds (and tool-only `eraser`).
 * Extends the legacy set (`hline` | `trend` | `ray` | `rect` | `fib` | `measure` | `text`).
 */
export type DrawingKind =
  | 'hline'
  | 'vline'
  | 'trend'
  | 'ray'
  | 'extend'
  | 'rect'
  | 'fib'
  | 'fibext'
  | 'measure'
  | 'text'
  | 'channel'
  | 'ellipse'
  | 'arrow'
  | 'priceLabel'
  | 'long'
  | 'short'
  | 'polyline'
  | 'path'
  /** Tool-only; not typically persisted as a drawing entity. */
  | 'eraser';

/**
 * Active tool id. `cursor` is selection/pan; remaining ids are drawing tools.
 * Includes all {@link DrawingKind} values (eraser is tool-only).
 */
export type DrawingToolId = 'cursor' | DrawingKind;

// ── Meta / entity ───────────────────────────────────────────────────────────

export interface DrawingMeta {
  text?: string;
  fibLevels?: number[];
  locked?: boolean;
  arrowStart?: boolean;
  arrowEnd?: boolean;
  /** long/short or measure direction hint */
  direction?: 'long' | 'short' | 'up' | 'down' | string;
  [key: string]: unknown;
}

/** Unified drawing entity — points + style + meta (migration target). */
export interface Drawing {
  id: string;
  kind: DrawingKind;
  points: ChartPoint[];
  style: DrawingStyle;
  meta: DrawingMeta;
  visible?: boolean;
  zIndex?: number;
}

// ── Tool specs ──────────────────────────────────────────────────────────────

/** How many anchor points a tool needs (fixed or open-ended). */
export type PointArity = 1 | 2 | 3 | 'n';

export interface ToolSpec {
  kind: DrawingKind;
  arity: PointArity;
  minPoints?: number;
  maxPoints?: number;
  finishOnDoubleClick?: boolean;
  defaultStyle?: Partial<DrawingStyle>;
  label: string;
}

// ── Interaction / handles ───────────────────────────────────────────────────

export type HandleId =
  | 'body'
  | 'price'
  | 'p1'
  | 'p2'
  | 'p3'
  | `p${number}`
  | string;

export interface Handle {
  id: HandleId;
  point: ChartPoint;
  /** CSS cursor hint when hovering this handle. */
  cursor?: string;
}

export type DraftPhase = 'idle' | 'placing' | 'preview' | 'complete';

/** In-progress pointer drag of an existing drawing (or its handle). */
export interface DragState {
  id: string;
  handle: HandleId;
  start: ChartPoint;
  origin: Drawing;
  /** Client/screen coords at drag start (optional). */
  startClient?: { x: number; y: number };
}

/** In-progress multi-click draft while placing a new drawing. */
export interface DraftState {
  tool: DrawingToolId;
  phase: DraftPhase;
  points: ChartPoint[];
  /** Live pointer preview (not yet committed). */
  preview?: ChartPoint;
}

export type MagnetMode = 'off' | 'weak' | 'strong';

// ── Legacy shapes (pre-unified model) ───────────────────────────────────────

/**
 * Legacy kinds only — mirrors `drawing-types.ts` `DrawingKind`.
 * Used by migration helpers and stored-data loaders.
 */
export type LegacyDrawingKind =
  | 'hline'
  | 'trend'
  | 'ray'
  | 'rect'
  | 'fib'
  | 'measure'
  | 'text';

export type LegacyDrawingToolId = 'cursor' | LegacyDrawingKind;

export interface LegacyDrawingBase {
  id: string;
  kind: LegacyDrawingKind;
  color: string;
  /** Optional user label */
  text?: string;
}

/** Legacy horizontal line — price-only (no time anchors). */
export interface LegacyHLineDrawing extends LegacyDrawingBase {
  kind: 'hline';
  price: number;
}

/** Legacy two-point drawings (trend, ray, rect, fib, measure). */
export interface LegacyTwoPointDrawing extends LegacyDrawingBase {
  kind: 'trend' | 'ray' | 'rect' | 'fib' | 'measure';
  p1: ChartPoint;
  p2: ChartPoint;
}

/** Legacy text annotation. */
export interface LegacyTextDrawing extends LegacyDrawingBase {
  kind: 'text';
  p1: ChartPoint;
  text: string;
}

/**
 * Discriminated union matching the old `Drawing` type from `drawing-types.ts`.
 * Prefer unified {@link Drawing} for new code.
 */
export type LegacyDrawing =
  | LegacyHLineDrawing
  | LegacyTwoPointDrawing
  | LegacyTextDrawing;

/** @deprecated Use {@link LegacyHLineDrawing} — kept for migration naming. */
export type HLineDrawing = LegacyHLineDrawing;
/** @deprecated Use {@link LegacyTwoPointDrawing}. */
export type TwoPointDrawing = LegacyTwoPointDrawing;
/** @deprecated Use {@link LegacyTextDrawing}. */
export type TextDrawing = LegacyTextDrawing;

/**
 * Type-guard / migration helper contracts (implementations live in later slices).
 */
export type IsLegacyDrawing = (value: unknown) => value is LegacyDrawing;
export type MigrateLegacyDrawing = (legacy: LegacyDrawing) => Drawing;
export type IsUnifiedDrawing = (value: unknown) => value is Drawing;
