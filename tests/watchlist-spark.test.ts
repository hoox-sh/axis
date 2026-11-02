/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Watchlist sparkline — seed from the 24h open, tip updates, and SVG path.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import {
  SPARK_LIMIT,
  SPARK_MIN_INTERVAL_MS,
  noteSparkPrice,
  resetWatchlistSparks,
  seedSpark,
  sparkPath,
  sparkSeries,
} from '../src/ui/watchlist-spark';

beforeEach(() => {
  resetWatchlistSparks();
});

describe('sparkPath', () => {
  it('draws a rising series upward and a flat series on the midline', () => {
    const up = sparkPath([1, 2, 3], 48, 12);
    const y = up.match(/[\d.]+/g)?.filter((_, i) => i % 2 === 1).map(Number) ?? [];
    expect(y.length).toBe(3);
    expect(y[0] ?? 0).toBeGreaterThan(y[2] ?? 0);

    const flat = sparkPath([5], 48, 12);
    expect(flat).toBe('M 1.00 6.00 L 47.00 6.00');
    expect(sparkPath([], 48, 12)).toBe('');
    expect(sparkPath([4, 4, 4], 48, 12)).toBe(flat);
  });
});

describe('seed and live prints', () => {
  it('seeds open→last once and then tracks the tip', () => {
    const t0 = 10_000;
    seedSpark('btcusdt', 100, 110, t0);
    seedSpark('BTCUSDT', 1, 2, t0 + 10);
    expect(sparkSeries('BTCUSDT')).toEqual([100, 110]);

    noteSparkPrice('BTCUSDT', 111, t0 + 100);
    expect(sparkSeries('BTCUSDT')).toEqual([100, 111]);

    noteSparkPrice('BTCUSDT', 112, t0 + SPARK_MIN_INTERVAL_MS + 100);
    expect(sparkSeries('BTCUSDT')).toEqual([100, 111, 112]);
  });

  it('caps the series', () => {
    const t0 = 50_000;
    noteSparkPrice('ETHUSDT', 1, t0);
    for (let i = 1; i <= SPARK_LIMIT + 5; i++) {
      noteSparkPrice('ETHUSDT', i + 1, t0 + i * SPARK_MIN_INTERVAL_MS);
    }
    const series = sparkSeries('ETHUSDT');
    expect(series).toHaveLength(SPARK_LIMIT);
    expect(series[series.length - 1]).toBe(SPARK_LIMIT + 5 + 1);
  });

  it('ignores a bad price', () => {
    noteSparkPrice('SOLUSDT', Number.NaN, 1);
    expect(sparkSeries('SOLUSDT')).toEqual([]);
  });
});
