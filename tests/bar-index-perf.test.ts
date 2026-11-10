/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Strategy fill matching must stay O(1) per event after one index build.
 * A linear scan of 10k bars per fill blocked the main thread for seconds.
 */

import { describe, expect, it } from 'bun:test';
import { barIndexAtExactTime, signalBarIndex } from '../src/results/events';
import type { Bar } from '../src/store/types';

function bars(n: number): Bar[] {
  return Array.from({ length: n }, (_, i) => ({
    time: 1_700_000_000 + i * 60,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 1,
  }));
}

describe('bar index lookup', () => {
  it('returns the first exact time and misses unknown times', () => {
    const series = bars(8);
    series.splice(3, 0, { ...series[3]!, time: series[3]!.time });
    expect(barIndexAtExactTime(series, series[0]!.time)).toBe(0);
    expect(barIndexAtExactTime(series, series[4]!.time)).toBe(3);
    expect(barIndexAtExactTime(series, 42)).toBe(-1);
  });

  it('resolves thousands of fills against 100k bars well under a linear scan', () => {
    const n = 100_000;
    const series = bars(n);
    const fills = 5_000;
    const t0 = performance.now();
    for (let i = 0; i < fills; i++) {
      const time = series[(i * 17) % n]!.time;
      const idx = signalBarIndex({ type: 'entry', time, bar_index: i } as never, series);
      if (idx !== (i * 17) % n) throw new Error(`wrong index ${idx} for fill ${i}`);
    }
    const ms = performance.now() - t0;
    // A findIndex per fill is ~5e3 * 1e5 comparisons and takes seconds.
    // The indexed path has to stay inside a frame budget.
    expect(ms).toBeLessThan(200);
  });
});
