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
 * Default styles, palette, fib levels, and tool specs for interactive drawings.
 */

import type {
  DrawingKind,
  DrawingStyle,
  DrawingToolId,
  PointArity,
  ToolSpec,
} from './types';

// ── Palette (matches legacy `drawing-types.ts`) ─────────────────────────────

export const DRAWING_COLORS = {
  default: '#939fff',
  up: '#5ecf8a',
  down: '#e85d4c',
  measure: '#e8a03a',
  muted: 'rgba(147, 159, 255, 0.55)',
} as const;

export type DrawingColorKey = keyof typeof DRAWING_COLORS;

// ── Default style ───────────────────────────────────────────────────────────

export const DEFAULT_STYLE: DrawingStyle = {
  color: DRAWING_COLORS.default,
  width: 1.5,
  lineStyle: 'solid',
  opacity: 1,
  extendLeft: false,
  extendRight: false,
  fontSize: 12,
};

// ── Fibonacci levels ────────────────────────────────────────────────────────

/** Fibonacci retracement ratios (price levels between p1→p2). */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

/** Fibonacci extension ratios beyond the retracement range. */
export const FIB_EXT_LEVELS = [0, 0.5, 1, 1.272, 1.618, 2, 2.618] as const;

// ── Tool specs ──────────────────────────────────────────────────────────────

function spec(
  kind: DrawingKind,
  arity: PointArity,
  label: string,
  extra: Partial<ToolSpec> = {},
): ToolSpec {
  return { kind, arity, label, ...extra };
}

/**
 * Spec per {@link DrawingKind}: arity, label, and optional placement hints.
 * `cursor` is not a drawing kind — see {@link ALL_DRAWING_TOOLS}.
 */
export const TOOL_SPECS: Record<DrawingKind, ToolSpec> = {
  hline: spec('hline', 1, 'Horizontal line'),
  vline: spec('vline', 1, 'Vertical line'),
  trend: spec('trend', 2, 'Trend line'),
  ray: spec('ray', 2, 'Ray'),
  extend: spec('extend', 2, 'Extended line'),
  rect: spec('rect', 2, 'Rectangle'),
  fib: spec('fib', 2, 'Fibonacci'),
  fibext: spec('fibext', 3, 'Fib extension'),
  measure: spec('measure', 2, 'Measure'),
  text: spec('text', 1, 'Text'),
  channel: spec('channel', 3, 'Parallel channel'),
  ellipse: spec('ellipse', 2, 'Ellipse'),
  arrow: spec('arrow', 2, 'Arrow'),
  priceLabel: spec('priceLabel', 1, 'Price label'),
  long: spec('long', 2, 'Long position'),
  short: spec('short', 2, 'Short position'),
  polyline: spec('polyline', 'n', 'Polyline', {
    minPoints: 2,
    finishOnDoubleClick: true,
  }),
  path: spec('path', 'n', 'Path', {
    minPoints: 2,
    finishOnDoubleClick: true,
  }),
  eraser: spec('eraser', 1, 'Eraser'),
};

/** All drawing tool ids including selection cursor (toolbar order). */
export const ALL_DRAWING_TOOLS: readonly DrawingToolId[] = [
  'cursor',
  'hline',
  'vline',
  'trend',
  'ray',
  'extend',
  'rect',
  'fib',
  'fibext',
  'measure',
  'text',
  'channel',
  'ellipse',
  'arrow',
  'priceLabel',
  'long',
  'short',
  'polyline',
  'path',
  'eraser',
] as const;

/** Points required to finish a placement (UI-facing). */
export type RequiredPoints = 0 | 1 | 2 | 3 | 'multi';

/**
 * How many anchor points the tool needs before it can be committed.
 * `cursor` → 0; open-ended (`n`) → `'multi'`.
 */
export function requiredPoints(tool: DrawingToolId): RequiredPoints {
  if (tool === 'cursor') return 0;
  const arity = TOOL_SPECS[tool].arity;
  if (arity === 'n') return 'multi';
  return arity;
}

/** True when the tool places with exactly two anchors (legacy helper parity). */
export function needsTwoPoints(tool: DrawingToolId): boolean {
  if (tool === 'cursor') return false;
  return TOOL_SPECS[tool].arity === 2;
}

export function toolLabel(tool: DrawingToolId): string {
  if (tool === 'cursor') return 'Cursor';
  return TOOL_SPECS[tool].label;
}
