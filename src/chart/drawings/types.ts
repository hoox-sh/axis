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
 *
 * Defines the canonical chart-space entity shape (`Drawing` with `points[]`),
 * tool ids, style/meta, interaction state, and legacy migration types.
 * Compatible with shapes from legacy `drawing-types.ts`.
 *
 * Does **not**:
 * - Render or hit-test (see geometry / svg-primitives / layer code)
 * - Own DOM, LWC chart APIs, or persistence I/O
 * - Represent Pine Script™ plot/line drawings (those are engine outputs)
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

/** SVG stroke pattern for lines (mapped via `strokeDashFor` in svg-primitives). */
export type LineStyle = 'solid' | 'dashed' | 'dotted';

/** Visual attributes shared by interactive drawings. */
export interface DrawingStyle {
  color: string;
  width: number;
  lineStyle: LineStyle;
  /** Optional fill color (rects, channels, ellipses, fib zones). */
  fill?: string;
  opacity: number;
  /** Extend the line left past the first anchor (trend/extend). */
  extendLeft: boolean;
  /** Extend the line right past the last anchor (rays default true when hydrated). */
  extendRight: boolean;
  fontSize: number;
}

// ── Kind / tool ids ─────────────────────────────────────────────────────────

/**
 * Persisted drawing kinds (and tool-only `eraser`).
 * Extends the legacy set (`hline` | `trend` | `ray` | `rect` | `fib` | `measure` | `text`).
 *
 * Point arity is defined in `TOOL_SPECS` (`defaults.ts`): 1-point (hline, text, …),
 * 2-point (trend, rect, fib, …), 3-point (channel, fibext), or open-ended `n`
 * (polyline, path).
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

/**
 * Kind-specific extras that are not geometry or stroke style.
 * Index signature allows forward-compatible keys without schema churn.
 */
export interface DrawingMeta {
  text?: string;
  /** Override default fib ratios (see `FIB_LEVELS` / `FIB_EXT_LEVELS`). */
  fibLevels?: number[];
  locked?: boolean;
  arrowStart?: boolean;
  arrowEnd?: boolean;
  /** long/short or measure direction hint */
  direction?: 'long' | 'short' | 'up' | 'down' | string;
  [key: string]: unknown;
}

/**
 * Unified drawing entity — points + style + meta (migration target).
 *
 * Geometry always lives in `points` (time/price). During migration, hydrate
 * helpers may also attach legacy top-level `p1`/`p2`/`price`/`text`/`color`
 * for layers that still read the dual shape — see `normalize.ts`.
 */
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

/**
 * How many anchor points a tool needs before placement can finish.
 * - `1` | `2` | `3` — fixed arity; last click commits the drawing
 * - `'n'` — open-ended; commit via finish gesture (double-click / explicit finish)
 */
export type PointArity = 1 | 2 | 3 | 'n';

/** Catalog entry describing placement rules for one {@link DrawingKind}. */
export interface ToolSpec {
  kind: DrawingKind;
  arity: PointArity;
  /** Minimum anchors when `arity` is `'n'` (typically 2). */
  minPoints?: number;
  maxPoints?: number;
  /** When true, UI finishes N-point tools on double-click. */
  finishOnDoubleClick?: boolean;
  defaultStyle?: Partial<DrawingStyle>;
  label: string;
}

// ── Interaction / handles ───────────────────────────────────────────────────

/**
 * Hit-target id for move/resize.
 * `body` moves the whole drawing; `price` is hline; `p1`/`p2`/`p3`/`pN` are anchors.
 */
export type HandleId =
  | 'body'
  | 'price'
  | 'p1'
  | 'p2'
  | 'p3'
  | `p${number}`
  | string;

/** Interactive control point exposed for hit-testing and drag. */
export interface Handle {
  id: HandleId;
  point: ChartPoint;
  /** CSS cursor hint when hovering this handle. */
  cursor?: string;
}

/**
 * Coarse draft lifecycle used by higher-level UI state (distinct from the
 * pure `DraftPhase` discriminant in `draft.ts`).
 */
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

/**
 * OHLC magnet strength for pointer → chart point conversion.
 *
 * - `'off'` — use raw time/price; no bar attraction
 * - `'weak'` — snap only when pointer Y is within `pixelTol` of a target level;
 *   searches nearest bar ± one neighbor
 * - `'strong'` — always snap to the closest OHLC (or configured) level on the
 *   nearest bar by time
 *
 * Implementation: {@link snapToBars} in `snap.ts`.
 */
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
