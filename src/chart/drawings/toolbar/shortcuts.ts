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
 * Drawing-toolbar shared constants.
 *
 * Single source of truth for rail geometry, icon optics, and shortcuts so
 * `DrawingToolbar` and its extracted subcomponents stay pixel-consistent.
 * Does not mount UI or touch the chart layer.
 *
 * @module chart/drawings/toolbar/shortcuts
 */

import { DRAWING_COLORS } from '../../drawing-types';
import type { DrawingLineStyle, DrawingToolId } from '../../drawing-types';

/** Rail grid — matches `.axis-draw-tool` / `.axis-draw-btn` in `src/index.css`. */
export const RAIL_BUTTON_PX = 32;
/** Optical icon size for tool glyphs (16px box, 1.7 stroke). */
export const TOOL_ICON_PX = 16;
export const TOOL_ICON_STROKE = 1.7;
/** Utility toggles (magnet / lock / eye) read slightly heavier at small size. */
export const UTILITY_ICON_PX = 16;
export const UTILITY_ICON_STROKE = 2;
/** Grip affordance size. */
export const GRIP_ICON_PX = 14;
export const GRIP_ICON_STROKE = 2.25;
/** Pointer slop before a press becomes a drag. */
export const DRAG_SLOP_PX = 4;
/** Keyboard nudge step (Shift = large). */
export const NUDGE_PX = 4;
export const NUDGE_LARGE_PX = 16;

export const COLOR_PRESETS = [
  DRAWING_COLORS.default,
  DRAWING_COLORS.up,
  DRAWING_COLORS.down,
  DRAWING_COLORS.measure,
  '#eceef4',
  '#8b8e9c',
] as const;

export const LINE_STYLES: DrawingLineStyle[] = ['solid', 'dashed', 'dotted'];

/**
 * Chart-scope chords already in the shortcut registry — do not invent new ones.
 * Kept here so rail, flyout, and settings share one map.
 */
export const TOOL_SHORTCUT: Partial<Record<DrawingToolId, string>> = {
  cursor: 'Q',
  eraser: 'E',
  measure: 'M',
  trend: 'L',
  fib: 'F',
  rect: 'R',
  text: 'T',
  hline: 'H',
  brush: 'X',
};

export function titleWithShortcut(name: string, shortcut?: string): string {
  return shortcut ? `${name} (${shortcut})` : name;
}
