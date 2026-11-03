// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * 14×14 layout glyph cells and the saved layout that matches the live grid.
 *
 * @module chart/layout-glyph
 */

import type { ChartGridMode, ChartLayoutState, ChartSlot, SavedChartLayout } from './layout';

/** One cell of the layouts-button glyph, in a 14×14 viewBox. */
export type LayoutGlyphCell = {
  x: number;
  y: number;
  w: number;
  h: number;
};

const BOX = 14;
const INSET = 1;
const GAP = 1;

/**
 * Equal cells inside a 1px inset. A 1px gutter between splits leaves
 * half-pixel edges (12 − 1) / 2 so every mode shares the same padding.
 */
function cellsFor(cols: number, rows: number): LayoutGlyphCell[] {
  const inner = BOX - INSET * 2;
  const w = (inner - GAP * (cols - 1)) / cols;
  const h = (inner - GAP * (rows - 1)) / rows;
  const cells: LayoutGlyphCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({
        x: INSET + col * (w + GAP),
        y: INSET + row * (h + GAP),
        w,
        h,
      });
    }
  }
  return cells;
}

/** Cells for the current grid. `1` is a single rect inset by 1. */
export function layoutCells(mode: ChartGridMode): ReadonlyArray<LayoutGlyphCell> {
  switch (mode) {
    case '1':
      return cellsFor(1, 1);
    case '2h':
      return cellsFor(2, 1);
    case '2v':
      return cellsFor(1, 2);
    case '4':
      return cellsFor(2, 2);
    case '6':
      return cellsFor(3, 2);
    case '8':
      return cellsFor(4, 2);
  }
}

function slotsMatch(saved: ChartLayoutState | null | undefined, live: ChartLayoutState): boolean {
  if (!saved || saved.mode !== live.mode) return false;
  const savedSlots = saved.slots;
  const liveSlots = live.slots;
  if (!savedSlots || !liveSlots || savedSlots.length !== liveSlots.length) return false;
  for (let i = 0; i < savedSlots.length; i++) {
    const a = savedSlots[i];
    const b = liveSlots[i];
    if (!a || !b || !slotFieldsMatch(a, b)) return false;
  }
  return true;
}

function slotFieldsMatch(a: ChartSlot, b: ChartSlot): boolean {
  return (
    a.symbol.toLowerCase() === b.symbol.toLowerCase() &&
    a.interval === b.interval &&
    a.chartType === b.chartType &&
    a.exchange === b.exchange
  );
}

function stamp(updatedAt: number | null | undefined): number {
  return typeof updatedAt === 'number' && Number.isFinite(updatedAt)
    ? updatedAt
    : Number.NEGATIVE_INFINITY;
}

/**
 * Name of the newest saved layout whose grid matches the live slots.
 * Slot ids and workspace chrome are ignored. Blank names do not match.
 */
export function matchingSavedLayoutName(
  saved: readonly SavedChartLayout[] | null | undefined,
  live: ChartLayoutState | null | undefined,
): string | null {
  if (!live || !saved || saved.length === 0) return null;
  let best: SavedChartLayout | null = null;
  for (const item of saved) {
    if (!item || !slotsMatch(item.chartLayout, live)) continue;
    if (!best || stamp(item.updatedAt) > stamp(best.updatedAt)) best = item;
  }
  if (!best || typeof best.name !== 'string') return null;
  const name = best.name.trim();
  return name ? name : null;
}
