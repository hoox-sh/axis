// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Multi-chart grid normalize + named layout pure helpers.
 */

import { describe, expect, it } from 'bun:test';
import {
  CHART_GRID_MODES,
  createChartSlot,
  defaultChartLayout,
  gridClassForMode,
  normalizeChartLayout,
  slotCountForMode,
} from '../src/chart/layout.ts';

describe('chart layout helpers', () => {
  it('slot counts match modes', () => {
    expect(slotCountForMode('1')).toBe(1);
    expect(slotCountForMode('2h')).toBe(2);
    expect(slotCountForMode('2v')).toBe(2);
    expect(slotCountForMode('4')).toBe(4);
    expect(slotCountForMode('6')).toBe(6);
    expect(slotCountForMode('8')).toBe(8);
    expect(CHART_GRID_MODES).toHaveLength(6);
  });

  it('defaultChartLayout is single BTCUSDT cell', () => {
    const L = defaultChartLayout({ symbol: 'ETHUSDT', interval: '1h' });
    expect(L.mode).toBe('1');
    expect(L.slots).toHaveLength(1);
    expect(L.slots[0]!.symbol).toBe('ETHUSDT');
    expect(L.activeId).toBe(L.slots[0]!.id);
  });

  it('normalize grows to 4 preserving first slot', () => {
    const one = defaultChartLayout({ symbol: 'SOLUSDT', interval: '15m' });
    const four = normalizeChartLayout({ mode: '4', activeId: one.activeId, slots: one.slots });
    expect(four.slots).toHaveLength(4);
    expect(four.slots[0]!.symbol).toBe('SOLUSDT');
    expect(four.slots[0]!.id).toBe(one.slots[0]!.id);
    expect(four.mode).toBe('4');
  });

  it('normalize grows to 6 and 8 with distinct default symbols', () => {
    const one = defaultChartLayout({ symbol: 'BTCUSDT', interval: '15m' });
    const six = normalizeChartLayout({ mode: '6', activeId: one.activeId, slots: one.slots });
    expect(six.slots).toHaveLength(6);
    expect(six.mode).toBe('6');
    expect(new Set(six.slots.map((s) => s.symbol)).size).toBe(6);

    const eight = normalizeChartLayout({ mode: '8', activeId: one.activeId, slots: one.slots });
    expect(eight.slots).toHaveLength(8);
    expect(eight.mode).toBe('8');
    expect(new Set(eight.slots.map((s) => s.symbol)).size).toBe(8);
  });

  it('normalize shrinks and keeps active when possible', () => {
    const four = normalizeChartLayout({
      mode: '4',
      slots: [
        createChartSlot({ symbol: 'A' }),
        createChartSlot({ symbol: 'B' }),
        createChartSlot({ symbol: 'C' }),
        createChartSlot({ symbol: 'D' }),
      ],
    });
    const two = normalizeChartLayout({
      mode: '2h',
      activeId: four.slots[1]!.id,
      slots: four.slots,
    });
    expect(two.slots).toHaveLength(2);
    expect(two.activeId).toBe(four.slots[1]!.id);
  });

  it('grid classes', () => {
    expect(gridClassForMode('1')).toContain('grid-cols-1');
    expect(gridClassForMode('2h')).toContain('grid-cols-2');
    expect(gridClassForMode('2v')).toContain('grid-rows-2');
    expect(gridClassForMode('4')).toContain('grid-cols-2');
    expect(gridClassForMode('6')).toBe('grid-cols-3 grid-rows-2');
    expect(gridClassForMode('8')).toBe('grid-cols-4 grid-rows-2');
  });
});
