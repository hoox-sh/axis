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
 * AXIS interactive drawing tools — chart annotations (not Pine label/line).
 */

export type DrawingToolId =
  | 'cursor'
  | 'hline'
  | 'trend'
  | 'ray'
  | 'rect'
  | 'fib'
  | 'measure'
  | 'text';

export type DrawingKind = Exclude<DrawingToolId, 'cursor'>;

export interface Point {
  time: number;
  price: number;
}

export type DrawingLineStyle = 'solid' | 'dashed' | 'dotted';

export interface DrawingBase {
  id: string;
  kind: DrawingKind;
  color: string;
  /** Optional user label */
  text?: string;
  /** Stroke width (default 1.5) */
  lineWidth?: number;
  /** Stroke pattern */
  lineStyle?: DrawingLineStyle;
  /** Fill opacity 0–1 for shapes (rect) */
  fillOpacity?: number;
  /** When true, refuse drag/delete unless unlocked */
  locked?: boolean;
  /**
   * Dual-shape fields from normalize (optional).
   * Layer still paints via price/p1/p2; these keep style/points for future.
   */
  points?: Point[];
  style?: {
    color?: string;
    width?: number;
    lineStyle?: DrawingLineStyle;
    opacity?: number;
    extendRight?: boolean;
    extendLeft?: boolean;
  };
  meta?: { text?: string; locked?: boolean; [key: string]: unknown };
}

export interface HLineDrawing extends DrawingBase {
  kind: 'hline';
  price: number;
}

export interface TwoPointDrawing extends DrawingBase {
  kind: 'trend' | 'ray' | 'rect' | 'fib' | 'measure';
  p1: Point;
  p2: Point;
}

export interface TextDrawing extends DrawingBase {
  kind: 'text';
  p1: Point;
  text: string;
}

export type Drawing = HLineDrawing | TwoPointDrawing | TextDrawing;

export const DRAWING_COLORS = {
  default: '#939fff',
  up: '#5ecf8a',
  down: '#e85d4c',
  measure: '#e8a03a',
  muted: 'rgba(147, 159, 255, 0.55)',
} as const;

/** Resolve paint style from dual legacy/unified drawing fields. */
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

/** Fibonacci retracement ratios (price levels between p1→p2). */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

export function needsTwoPoints(tool: DrawingToolId): boolean {
  return tool === 'trend' || tool === 'ray' || tool === 'rect' || tool === 'fib' || tool === 'measure';
}

export function toolLabel(tool: DrawingToolId): string {
  switch (tool) {
    case 'cursor':
      return 'Cursor';
    case 'hline':
      return 'Horizontal line';
    case 'trend':
      return 'Trend line';
    case 'ray':
      return 'Ray';
    case 'rect':
      return 'Rectangle';
    case 'fib':
      return 'Fibonacci';
    case 'measure':
      return 'Measure';
    case 'text':
      return 'Text';
  }
}
