/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pure align / percent-normalize helpers for second-symbol compare overlay.
 */

import { describe, expect, it, beforeAll, beforeEach, afterEach } from 'bun:test';
import {
  alignAbsolute,
  alignByTime,
  applyCompareOverlay,
  buildCompareSeriesData,
  clearCompareOverlay,
  COMPARE_MAIN_PCT_KEY,
  COMPARE_SERIES_KEY,
  extractCloses,
  normalizeToPercent,
  toPercentChange,
} from '../src/chart/compare-overlay';
import type { Bar } from '../src/store/types';
import './setup';
import { installLightweightChartsMock } from './helpers/mock-lwc';

beforeAll(() => {
  installLightweightChartsMock();
});

const { PaneManager } = await import('../src/chart/pane-manager');

function bar(time: number, close: number): Bar {
  return {
    time,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 10,
  };
}

describe('extractCloses / alignByTime', () => {
  it('skips non-finite closes', () => {
    expect(
      extractCloses([
        { time: 1, close: 10 },
        { time: 2, close: Number.NaN },
        { time: 3, close: 12 },
      ]),
    ).toEqual([
      { time: 1, close: 10 },
      { time: 3, close: 12 },
    ]);
  });

  it('inner-joins on common timestamps', () => {
    const main = [
      { time: 1, close: 100 },
      { time: 2, close: 110 },
      { time: 3, close: 120 },
    ];
    const cmp = [
      { time: 2, close: 50 },
      { time: 3, close: 55 },
      { time: 4, close: 60 },
    ];
    expect(alignByTime(main, cmp)).toEqual([
      { time: 2, main: 110, compare: 50 },
      { time: 3, main: 120, compare: 55 },
    ]);
  });

  it('returns empty when no overlap', () => {
    expect(
      alignByTime(
        [{ time: 1, close: 1 }],
        [{ time: 9, close: 2 }],
      ),
    ).toEqual([]);
  });

  it('sorts unsorted inputs', () => {
    const main = [
      { time: 3, close: 30 },
      { time: 1, close: 10 },
    ];
    const cmp = [
      { time: 1, close: 5 },
      { time: 3, close: 15 },
    ];
    expect(alignByTime(main, cmp).map((r) => r.time)).toEqual([1, 3]);
  });
});

describe('toPercentChange', () => {
  it('maps (v/v0 - 1) * 100 from first value', () => {
    // Use powers-of-two-friendly bases to avoid float noise
    expect(toPercentChange([50, 100, 25])).toEqual([0, 100, -50]);
  });

  it('returns empty for empty or zero baseline', () => {
    expect(toPercentChange([])).toEqual([]);
    expect(toPercentChange([0, 1, 2])).toEqual([]);
  });
});

describe('normalizeToPercent', () => {
  it('aligns then normalizes each series from first common bar', () => {
    const main = [bar(1, 100), bar(2, 100), bar(3, 150)];
    // Compare starts later — baseline is first common (t=2)
    const cmp = [bar(2, 50), bar(3, 75)];
    const { main: m, compare: c, baselineTime } = normalizeToPercent(main, cmp);
    expect(baselineTime).toBe(2);
    expect(m).toEqual([
      { time: 2, value: 0 },
      { time: 3, value: 50 },
    ]);
    expect(c).toEqual([
      { time: 2, value: 0 },
      { time: 3, value: 50 },
    ]);
  });

  it('returns empty when no common times', () => {
    const r = normalizeToPercent([bar(1, 10)], [bar(99, 20)]);
    expect(r.main).toEqual([]);
    expect(r.compare).toEqual([]);
    expect(r.baselineTime).toBeNull();
  });
});

describe('alignAbsolute / buildCompareSeriesData', () => {
  it('absolute mode keeps raw closes on common times', () => {
    const main = [bar(1, 100), bar(2, 200)];
    const cmp = [bar(1, 10), bar(2, 12)];
    const { compare } = alignAbsolute(main, cmp);
    expect(compare).toEqual([
      { time: 1, value: 10 },
      { time: 2, value: 12 },
    ]);
  });

  it('percent mode omits main unless includeMainPercent', () => {
    const main = [bar(1, 100), bar(2, 150)];
    const cmp = [bar(1, 50), bar(2, 75)];
    const solo = buildCompareSeriesData(main, cmp, 'percent', false);
    expect(solo.mainPercent).toEqual([]);
    expect(solo.compare[0]?.value).toBe(0);
    expect(solo.compare[1]?.value).toBe(50);

    const dual = buildCompareSeriesData(main, cmp, 'percent', true);
    expect(dual.mainPercent).toHaveLength(2);
    expect(dual.mainPercent[1]?.value).toBe(50);
  });

  it('absolute mode never returns mainPercent', () => {
    const main = [bar(1, 100)];
    const cmp = [bar(1, 50)];
    const r = buildCompareSeriesData(main, cmp, 'absolute', true);
    expect(r.mainPercent).toEqual([]);
    expect(r.compare[0]?.value).toBe(50);
  });
});

describe('applyCompareOverlay / clearCompareOverlay', () => {
  let root: HTMLElement;
  let pm: InstanceType<typeof PaneManager>;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    pm = new PaneManager(root);
    pm.createPane('price', 'price', 'Price');
  });

  afterEach(() => {
    try {
      pm.dispose();
    } catch {
      /* ignore */
    }
    root?.remove();
  });

  it('creates compare series and clears it', () => {
    const main = [bar(1, 100), bar(2, 110), bar(3, 120)];
    const cmp = [bar(1, 50), bar(2, 55), bar(3, 60)];
    applyCompareOverlay(pm, {
      mainBars: main,
      compareBars: cmp,
      symbol: 'ETHUSDT',
      mode: 'percent',
    });
    const pane = pm.getPane('price')!;
    expect(pane.series[COMPARE_SERIES_KEY]).toBeDefined();
    expect(pane.series[COMPARE_MAIN_PCT_KEY]).toBeUndefined();

    clearCompareOverlay(pm);
    expect(pane.series[COMPARE_SERIES_KEY]).toBeUndefined();
  });

  it('dual percent adds main % companion series', () => {
    const main = [bar(1, 100), bar(2, 110)];
    const cmp = [bar(1, 50), bar(2, 60)];
    applyCompareOverlay(pm, {
      mainBars: main,
      compareBars: cmp,
      symbol: 'ETHUSDT',
      mode: 'percent',
      normalizeMain: true,
    });
    const pane = pm.getPane('price')!;
    expect(pane.series[COMPARE_SERIES_KEY]).toBeDefined();
    expect(pane.series[COMPARE_MAIN_PCT_KEY]).toBeDefined();
  });

  it('no-op clear when manager missing or empty data', () => {
    expect(() => clearCompareOverlay(undefined)).not.toThrow();
    applyCompareOverlay(pm, {
      mainBars: [bar(1, 100)],
      compareBars: [bar(99, 1)],
      symbol: 'X',
      mode: 'percent',
    });
    expect(pm.getPane('price')!.series[COMPARE_SERIES_KEY]).toBeUndefined();
  });
});
