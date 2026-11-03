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
 * Layout glyph cells and saved-layout name matching (no storage).
 */

import { describe, expect, it } from 'bun:test';
import type { ChartGridMode, ChartLayoutState, ChartSlot, SavedChartLayout } from '../src/chart/layout';
import { layoutCells, matchingSavedLayoutName, type LayoutGlyphCell } from '../src/chart/layout-glyph';

function cellPair(cells: ReadonlyArray<LayoutGlyphCell>, axis: 'x' | 'y'): [LayoutGlyphCell, LayoutGlyphCell] {
  const ordered = [...cells].sort((a, b) => a[axis] - b[axis] || a.x - b.x || a.y - b.y);
  const first = ordered[0];
  const second = ordered[1];
  if (!first || !second) throw new Error(`expected two cells, got ${cells.length}`);
  return [first, second];
}

describe('layoutCells', () => {
  it('counts cells and places 2h beside and 2v stacked inside 14×14', () => {
    expect(layoutCells('1')).toEqual([{ x: 1, y: 1, w: 12, h: 12 }]);

    const side = layoutCells('2h');
    expect(side).toHaveLength(2);
    const [left, right] = cellPair(side, 'x');
    expect(left.x).toBeLessThan(right.x);
    expect(left.y).toBe(right.y);
    expect(right.x - (left.x + left.w)).toBe(1);

    const stack = layoutCells('2v');
    expect(stack).toHaveLength(2);
    const [top, bottom] = cellPair(stack, 'y');
    expect(top.y).toBeLessThan(bottom.y);
    expect(top.x).toBe(bottom.x);
    expect(bottom.y - (top.y + top.h)).toBe(1);

    const quad = layoutCells('4');
    expect(quad).toHaveLength(4);
    const xs = quad.map((cell) => cell.x);
    const ys = quad.map((cell) => cell.y);
    expect(Math.min(...xs)).toBeLessThan(Math.max(...xs));
    expect(Math.min(...ys)).toBeLessThan(Math.max(...ys));

    const six = layoutCells('6');
    expect(six).toHaveLength(6);
    const eight = layoutCells('8');
    expect(eight).toHaveLength(8);

    for (const cell of [...side, ...stack, ...quad, ...six, ...eight]) {
      expect(cell.w).toBeGreaterThan(0);
      expect(cell.h).toBeGreaterThan(0);
      expect(cell.x).toBeGreaterThanOrEqual(0);
      expect(cell.y).toBeGreaterThanOrEqual(0);
      expect(cell.x + cell.w).toBeLessThanOrEqual(14);
      expect(cell.y + cell.h).toBeLessThanOrEqual(14);
    }
  });
});

function slot(partial: Pick<ChartSlot, 'symbol'> & Partial<ChartSlot>): ChartSlot {
  return {
    id: partial.id ?? 'slot',
    symbol: partial.symbol,
    interval: partial.interval ?? '15m',
    chartType: partial.chartType ?? 'candles',
    exchange: partial.exchange ?? 'binance',
  };
}

function layout(
  mode: ChartGridMode,
  slots: ChartSlot[],
  activeId = 'live-active',
): ChartLayoutState {
  return { mode, activeId, slots };
}

function snap(
  name: string,
  updatedAt: number,
  chartLayout: ChartLayoutState,
  extra?: Partial<SavedChartLayout>,
): SavedChartLayout {
  return {
    id: `saved-${updatedAt}-${name}`,
    name,
    updatedAt,
    chartLayout,
    ...extra,
  };
}

describe('matchingSavedLayoutName', () => {
  const btc = slot({ id: 'a', symbol: 'BTCUSDT' });
  const eth = slot({ id: 'b', symbol: 'ETHUSDT', interval: '1h', chartType: 'line', exchange: 'okx' });
  const live = layout('2h', [btc, eth]);

  it('ignores slot ids and chrome and keeps the newest name', () => {
    const renamedIds = layout('2h', [
      slot({ id: 'other-a', symbol: 'btcusdt' }),
      slot({ id: 'other-b', symbol: 'ethusdt', interval: '1h', chartType: 'line', exchange: 'okx' }),
    ], 'not-the-live-active');
    const matches = [
      snap('Older desk', 10, renamedIds, {
        theme: 'light',
        uiScale: 1.25,
        historyBars: 400,
        panes: [],
      }),
      snap('  Newer desk  ', 40, {
        ...renamedIds,
        slots: renamedIds.slots.map((s, i) => ({ ...s, id: `newest-${i}` })),
      }),
      snap('Middle', 25, renamedIds),
    ];
    expect(matchingSavedLayoutName(matches, live)).toBe('Newer desk');
  });

  it('rejects a different symbol, mode, index order, or slot field', () => {
    expect(matchingSavedLayoutName([snap('Other', 5, layout('2h', [slot({ symbol: 'SOLUSDT' }), eth]))], live)).toBeNull();
    expect(matchingSavedLayoutName([snap('Stack', 5, layout('2v', [btc, eth]))], live)).toBeNull();
    expect(matchingSavedLayoutName([snap('Flip', 5, layout('2h', [eth, btc]))], live)).toBeNull();
    expect(
      matchingSavedLayoutName(
        [snap('Interval', 5, layout('2h', [btc, slot({ ...eth, id: 'b2', interval: '4h' })]))],
        live,
      ),
    ).toBeNull();
    expect(
      matchingSavedLayoutName(
        [snap('Type', 5, layout('2h', [btc, slot({ ...eth, id: 'b3', chartType: 'bars' })]))],
        live,
      ),
    ).toBeNull();
    expect(
      matchingSavedLayoutName(
        [snap('Venue', 5, layout('2h', [btc, slot({ ...eth, id: 'b4', exchange: 'binance' })]))],
        live,
      ),
    ).toBeNull();
    expect(matchingSavedLayoutName([snap('Short', 5, layout('2h', [btc]))], live)).toBeNull();
  });

  it('returns null for a blank name, empty saves, or missing live state', () => {
    expect(matchingSavedLayoutName([snap('   ', 9, live), snap('', 3, live)], live)).toBeNull();
    expect(matchingSavedLayoutName([snap('Named', 1, live), snap('  \n', 8, live)], live)).toBeNull();
    expect(matchingSavedLayoutName([], live)).toBeNull();
    expect(matchingSavedLayoutName(null, live)).toBeNull();
    expect(matchingSavedLayoutName(undefined, live)).toBeNull();
    expect(matchingSavedLayoutName([snap('Desk', 1, live)], null)).toBeNull();
    expect(matchingSavedLayoutName([snap('Desk', 1, live)], undefined)).toBeNull();
  });
});
