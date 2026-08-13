/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * chart-registry — slot bars / chartDataGen store + imperative manager API.
 *
 * Bun uses solid-js server build (no computed re-runs). Browser/Vite client
 * solid tracks getSlotBars / getSlotChartDataGen inside ChartHost.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import type { Bar } from '../src/store/types';
import {
  setSlotBars,
  getSlotBars,
  getSlotChartDataGen,
  setSlotManager,
  getSlotManager,
  setSlotDrawingLayer,
  getSlotDrawingLayer,
  disposeSlotChart,
  removeSlotRuntime,
  setActiveSlotId,
  getActiveSlotId,
  getActiveManager,
  getActiveDrawingLayer,
  getSlotRuntime,
} from '../src/chart/chart-registry';

const SLOT = 'registry-test-a';
const SLOT_B = 'registry-test-b';

function bar(t: number, px = 100): Bar {
  return { time: t, open: px, high: px + 1, low: px - 1, close: px, volume: 1 };
}

beforeEach(() => {
  removeSlotRuntime(SLOT);
  removeSlotRuntime(SLOT_B);
  setActiveSlotId(null);
});

describe('chart-registry API', () => {
  it('setSlotBars / getSlotBars / getSlotChartDataGen', () => {
    expect(getSlotBars(SLOT)).toEqual([]);
    expect(getSlotChartDataGen(SLOT)).toBe(0);

    setSlotBars(SLOT, [bar(1)], true);
    expect(getSlotBars(SLOT)).toHaveLength(1);
    expect(getSlotChartDataGen(SLOT)).toBe(1);

    setSlotBars(SLOT, [bar(1), bar(2)], true);
    expect(getSlotBars(SLOT)).toHaveLength(2);
    expect(getSlotChartDataGen(SLOT)).toBe(2);

    setSlotBars(SLOT, [bar(1)], false);
    expect(getSlotBars(SLOT)).toHaveLength(1);
    expect(getSlotChartDataGen(SLOT)).toBe(2);
  });

  it('manager and drawing layer stay independent of bars', () => {
    const mgr = { dispose: () => {} } as never;
    const layer = { destroy: () => {} } as never;
    setSlotManager(SLOT, mgr);
    setSlotDrawingLayer(SLOT, layer);
    expect(getSlotManager(SLOT)).toBe(mgr);
    expect(getSlotDrawingLayer(SLOT)).toBe(layer);

    setSlotBars(SLOT, [bar(10)], true);
    expect(getSlotManager(SLOT)).toBe(mgr);
    expect(getSlotDrawingLayer(SLOT)).toBe(layer);

    disposeSlotChart(SLOT);
    expect(getSlotManager(SLOT)).toBeUndefined();
    expect(getSlotDrawingLayer(SLOT)).toBeUndefined();
    // bars kept for quick re-show
    expect(getSlotBars(SLOT)).toHaveLength(1);
    expect(getSlotChartDataGen(SLOT)).toBe(1);
  });

  it('removeSlotRuntime drops bars and clears active id', () => {
    setActiveSlotId(SLOT);
    setSlotBars(SLOT, [bar(1)], true);
    setSlotManager(SLOT, { dispose: () => {} } as never);
    removeSlotRuntime(SLOT);
    expect(getSlotBars(SLOT)).toEqual([]);
    expect(getSlotChartDataGen(SLOT)).toBe(0);
    expect(getSlotManager(SLOT)).toBeUndefined();
    expect(getActiveSlotId()).toBeNull();
  });

  it('active helpers route to active slot', () => {
    const mgr = { dispose: () => {} } as never;
    const layer = { destroy: () => {} } as never;
    setSlotManager(SLOT, mgr);
    setSlotDrawingLayer(SLOT, layer);
    setActiveSlotId(SLOT);
    expect(getActiveManager()).toBe(mgr);
    expect(getActiveDrawingLayer()).toBe(layer);
    setActiveSlotId(null);
    expect(getActiveManager()).toBeUndefined();
    expect(getActiveDrawingLayer()).toBeUndefined();
  });

  it('getSlotRuntime mirrors current slot state', () => {
    setSlotBars(SLOT, [bar(5)], true);
    setSlotManager(SLOT, { dispose: () => {} } as never);
    const r = getSlotRuntime(SLOT);
    expect(r.bars).toHaveLength(1);
    expect(r.chartDataGen).toBe(1);
    expect(r.manager).toBeDefined();
  });
});

describe('chart-registry slot data paths', () => {
  it('bumps chartDataGen when setSlotBars defaults bumpGen', () => {
    expect(getSlotChartDataGen(SLOT)).toBe(0);
    setSlotBars(SLOT, [bar(1)], true);
    expect(getSlotChartDataGen(SLOT)).toBe(1);
    expect(getSlotBars(SLOT)).toHaveLength(1);
    setSlotBars(SLOT, [bar(1), bar(2)], true);
    expect(getSlotChartDataGen(SLOT)).toBe(2);
    expect(getSlotBars(SLOT)).toHaveLength(2);
  });

  it('updates bars without bumping gen when bumpGen is false', () => {
    setSlotBars(SLOT, [bar(1)], true);
    expect(getSlotChartDataGen(SLOT)).toBe(1);
    setSlotBars(SLOT, [bar(1), bar(2), bar(3)], false);
    expect(getSlotBars(SLOT)).toHaveLength(3);
    expect(getSlotChartDataGen(SLOT)).toBe(1);
  });

  it('isolates bars per slot id', () => {
    setSlotBars(SLOT, [bar(1)], true);
    setSlotBars(SLOT_B, [bar(9), bar(10)], true);
    expect(getSlotBars(SLOT)).toHaveLength(1);
    expect(getSlotBars(SLOT_B)).toHaveLength(2);
    expect(getSlotChartDataGen(SLOT)).toBe(1);
    expect(getSlotChartDataGen(SLOT_B)).toBe(1);
  });

  it('removeSlotRuntime clears bars and gen for that slot', () => {
    setSlotBars(SLOT, [bar(1), bar(2)], true);
    removeSlotRuntime(SLOT);
    expect(getSlotBars(SLOT)).toHaveLength(0);
    expect(getSlotChartDataGen(SLOT)).toBe(0);
  });

  it('disposeSlotChart keeps bars for quick re-show', () => {
    setSlotBars(SLOT, [bar(1)], true);
    setSlotManager(SLOT, { dispose: () => {} } as never);
    disposeSlotChart(SLOT);
    expect(getSlotManager(SLOT)).toBeUndefined();
    expect(getSlotBars(SLOT)).toHaveLength(1);
    expect(getSlotChartDataGen(SLOT)).toBe(1);
  });
});
