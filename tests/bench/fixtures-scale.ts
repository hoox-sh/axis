/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Large deterministic OHLCV builders for optional AXIS_BENCH firehose suites.
 * Prefer pre-sized arrays over push loops so setup cost stays out of the timed path.
 */

import type { Bar } from '../../src/store/types';

/** Default history size for firehose benches (~50k open bars). */
export const BENCH_HISTORY_BARS = 50_000;

/** Default tick count for appendBar firehose. */
export const BENCH_TICK_COUNT = 500_000;

/**
 * Build `n` bars oldest → newest with a gentle walk (no randomness).
 * Pre-allocates the array so construction is linear and GC-friendly.
 */
export function makeScaleBars(
  n = BENCH_HISTORY_BARS,
  startTime = 1_700_000_000,
  step = 60,
): Bar[] {
  const out = new Array<Bar>(n);
  let px = 100;
  for (let i = 0; i < n; i++) {
    const open = px;
    const close = open + ((i & 1) === 0 ? 0.25 : -0.15);
    out[i] = {
      time: startTime + i * step,
      open,
      high: Math.max(open, close) + 0.5,
      low: Math.min(open, close) - 0.5,
      close,
      volume: 1000 + (i % 50),
    };
    px = close;
  }
  return out;
}

/**
 * Synthetic live tick: most ticks update the open bar in place; every
 * `ticksPerBar`th tick advances time by `step` (bar close → new open).
 */
export function nextFirehoseBar(
  last: Bar,
  tickIndex: number,
  ticksPerBar = 10,
  step = 60,
): Bar {
  const advance = tickIndex > 0 && tickIndex % ticksPerBar === 0;
  const open = advance ? last.close : last.open;
  const close = open + ((tickIndex & 3) === 0 ? 0.1 : -0.05);
  return {
    time: advance ? last.time + step : last.time,
    open,
    high: Math.max(open, close, last.high) + (advance ? 0 : 0.01),
    low: Math.min(open, close, advance ? close : last.low) - (advance ? 0 : 0.01),
    close,
    volume: (last.volume || 0) + 1,
  };
}
