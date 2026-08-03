/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Drawing coordinate helpers: bar period, future logical ↔ time (500 bars).
 */

import { describe, expect, it } from 'bun:test';
import {
  DRAWING_FUTURE_BARS,
  estimateBarPeriod,
  unixTimeToLogicalIndex,
  logicalIndexToUnixTime,
  clampTimeToFutureHorizon,
} from '../src/chart/drawings/coords';

function bars(n: number, start = 1_700_000_000, period = 3600) {
  return Array.from({ length: n }, (_, i) => ({
    time: start + i * period,
  }));
}

describe('estimateBarPeriod', () => {
  it('returns median of last deltas', () => {
    expect(estimateBarPeriod(bars(10, 0, 60))).toBe(60);
    expect(estimateBarPeriod(bars(5, 0, 3600))).toBe(3600);
  });

  it('falls back when short series', () => {
    expect(estimateBarPeriod([])).toBe(60);
    expect(estimateBarPeriod([{ time: 1 }])).toBe(60);
  });
});

describe('unixTimeToLogicalIndex / logicalIndexToUnixTime', () => {
  const b = bars(100, 1_700_000_000, 3600); // 100 hourly bars
  const lastIdx = 99;
  const lastT = b[lastIdx]!.time;

  it('maps known bar times to indices', () => {
    expect(unixTimeToLogicalIndex(b[0]!.time, b)).toBe(0);
    expect(unixTimeToLogicalIndex(b[50]!.time, b)).toBe(50);
    expect(unixTimeToLogicalIndex(lastT, b)).toBe(lastIdx);
  });

  it('extrapolates up to DRAWING_FUTURE_BARS past the end', () => {
    const t100 = lastT + 100 * 3600;
    const logical = unixTimeToLogicalIndex(t100, b);
    expect(logical).toBeCloseTo(lastIdx + 100, 5);

    const t600 = lastT + 600 * 3600; // beyond 500
    const capped = unixTimeToLogicalIndex(t600, b);
    expect(capped).toBe(lastIdx + DRAWING_FUTURE_BARS);
  });

  it('round-trips future times within horizon', () => {
    for (const extra of [1, 10, 50, 200, 500]) {
      const t = lastT + extra * 3600;
      const logical = unixTimeToLogicalIndex(t, b)!;
      const back = logicalIndexToUnixTime(logical, b)!;
      expect(back).toBeCloseTo(t, 5);
    }
  });

  it('logical past horizon clamps time', () => {
    const t = logicalIndexToUnixTime(lastIdx + 999, b)!;
    expect(t).toBe(lastT + DRAWING_FUTURE_BARS * 3600);
  });

  it('interpolates between bars', () => {
    const mid = (b[10]!.time + b[11]!.time) / 2;
    const logical = unixTimeToLogicalIndex(mid, b)!;
    expect(logical).toBeCloseTo(10.5, 5);
  });
});

describe('clampTimeToFutureHorizon', () => {
  const b = bars(10, 1000, 10);
  const last = b[9]!.time;

  it('leaves past/present alone', () => {
    expect(clampTimeToFutureHorizon(last, b)).toBe(last);
    expect(clampTimeToFutureHorizon(last - 5, b)).toBe(last - 5);
  });

  it('caps far-future times', () => {
    const far = last + 10_000;
    const max = last + 10 * DRAWING_FUTURE_BARS;
    expect(clampTimeToFutureHorizon(far, b)).toBe(max);
  });
});
