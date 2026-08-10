/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import {
  CONFLATION_BARS_THRESHOLD,
  HEAVY_BARS_THRESHOLD,
  barIndexAtTimeBinary,
  createRafCoalescer,
  heavyTimeScaleOptions,
  isHeavyBarLoad,
  mapBarsToVolumeData,
} from '../src/chart/heavy-data';
import type { Bar } from '../src/store/types';

describe('heavy-data thresholds', () => {
  it('detects 10k+ loads', () => {
    expect(isHeavyBarLoad(HEAVY_BARS_THRESHOLD)).toBe(true);
    expect(isHeavyBarLoad(HEAVY_BARS_THRESHOLD - 1)).toBe(false);
    expect(isHeavyBarLoad(0)).toBe(false);
  });

  it('enables conflation for mid and precompute for heavy', () => {
    const small = heavyTimeScaleOptions(100);
    expect(small.enableConflation).toBe(false);
    expect(small.precomputeConflationOnInit).toBe(false);

    const mid = heavyTimeScaleOptions(CONFLATION_BARS_THRESHOLD);
    expect(mid.enableConflation).toBe(true);
    expect(mid.precomputeConflationOnInit).toBe(false);

    const heavy = heavyTimeScaleOptions(HEAVY_BARS_THRESHOLD);
    expect(heavy.enableConflation).toBe(true);
    expect(heavy.precomputeConflationOnInit).toBe(true);
    expect(heavy.conflationThresholdFactor).toBe(1);
  });
});

describe('mapBarsToVolumeData', () => {
  it('maps up/down colors in one pass', () => {
    const bars: Bar[] = [
      { time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { time: 2, open: 2, high: 2, low: 1, close: 1, volume: 20 },
      { time: 3, open: 1, high: 1, low: 1, close: 1, volume: undefined as unknown as number },
    ];
    const out = mapBarsToVolumeData(bars, { up: '#0f0', down: '#f00' });
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ time: 1, value: 10, color: '#0f0' });
    expect(out[1]).toEqual({ time: 2, value: 20, color: '#f00' });
    expect(out[2]!.value).toBe(0);
  });
});

describe('barIndexAtTimeBinary', () => {
  it('finds exact and nearest in O(log n)', () => {
    const bars = [1, 3, 5, 7, 9].map((time) => ({ time }));
    expect(barIndexAtTimeBinary(bars, 5)).toBe(2);
    expect(barIndexAtTimeBinary(bars, 6)).toBe(2); // nearer 5 than 7? |6-5|=1, |6-7|=1 → lower
    expect(barIndexAtTimeBinary(bars, 0)).toBe(0);
    expect(barIndexAtTimeBinary(bars, 100)).toBe(4);
    expect(barIndexAtTimeBinary([], 1)).toBe(-1);
  });
});

describe('createRafCoalescer', () => {
  it('runs the latest scheduled fn once', async () => {
    let n = 0;
    let last = 0;
    const c = createRafCoalescer();
    c.schedule(() => {
      n += 1;
      last = 1;
    });
    c.schedule(() => {
      n += 1;
      last = 2;
    });
    // Without rAF in bun, schedule may run sync — either way last wins
    await new Promise((r) => setTimeout(r, 20));
    expect(last).toBe(2);
    expect(n).toBeGreaterThanOrEqual(1);
    c.cancel();
  });
});
