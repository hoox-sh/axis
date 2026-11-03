// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from 'bun:test';
import {
  _resetHydrateSlotsForTests,
  hydrateEmptyChartSlots,
} from '../src/chart/hydrate-slots.ts';
import {
  getSlotBars,
  removeSlotRuntime,
  setSlotBars,
} from '../src/chart/chart-registry.ts';
import { normalizeChartLayout } from '../src/chart/layout.ts';
import { setStore, store } from '../src/store/index.ts';

function bar(t: number) {
  return { time: t, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 };
}

afterEach(() => {
  _resetHydrateSlotsForTests();
  const slots = store.chartLayout?.slots || [];
  for (const s of slots) removeSlotRuntime(s.id);
});

describe('hydrateEmptyChartSlots', () => {
  it('fills empty non-active slots without writing store.bars', async () => {
    const layout = normalizeChartLayout({ mode: '4' });
    setStore('chartLayout', layout);
    setStore('source', 'mock-walk');
    setStore('bars', [bar(1), bar(2)]);

    const active = layout.activeId;
    const siblings = layout.slots.filter((s) => s.id !== active);
    expect(siblings.length).toBe(3);
    for (const s of siblings) expect(getSlotBars(s.id)).toHaveLength(0);

    const beforeBars = store.bars.slice();
    const result = await hydrateEmptyChartSlots({ sourceId: 'mock-walk' });
    expect(result.attempted).toBe(3);
    expect(result.filled).toBe(3);
    expect(store.bars).toEqual(beforeBars);
    expect(getSlotBars(active)).toHaveLength(0);
    for (const s of siblings) {
      expect(getSlotBars(s.id).length).toBeGreaterThan(0);
    }
  });

  it('skips slots that already have bars', async () => {
    const layout = normalizeChartLayout({ mode: '2h' });
    setStore('chartLayout', layout);
    const other = layout.slots.find((s) => s.id !== layout.activeId)!;
    setSlotBars(other.id, [bar(9)], true);

    const result = await hydrateEmptyChartSlots({ sourceId: 'mock-walk' });
    expect(result.attempted).toBe(0);
    expect(result.filled).toBe(0);
    expect(getSlotBars(other.id)).toHaveLength(1);
  });
});
