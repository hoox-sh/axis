/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Deterministic OHLCV fixtures for unit/integration tests (no network).
 * Bars are oldest → newest; prices walk slightly for strategy/event math.
 */

import type { Bar } from '../../src/store/types';

/**
 * Build `n` bars starting at `startTime` (unix sec) with `step` between opens.
 * Alternating up/down closes keep high/low valid without randomness.
 */
export function makeBars(n = 10, startTime = 1_700_000_000, step = 86_400): Bar[] {
  const out: Bar[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = price + (i % 2 === 0 ? 1 : -0.5);
    out.push({
      time: startTime + i * step,
      open,
      high: Math.max(open, close) + 0.5,
      low: Math.min(open, close) - 0.5,
      close,
      volume: 1000 + i,
    });
    price = close;
  }
  return out;
}

export const SAMPLE_BARS: readonly Bar[] = Object.freeze(
  makeBars(5).map((b) => Object.freeze({ ...b }) as Bar),
) as readonly Bar[];

/**
 * Fresh mutable copy of {@link SAMPLE_BARS} for tests that load/append it
 * into the store. `loadBars` aliases the caller's array and `appendBar`
 * mutates in place, so sharing the singleton across tests pollutes every
 * suite that runs after the first writer — always clone.
 */
export function sampleBars(n = 5, startTime = 1_700_000_000, step = 86_400): Bar[] {
  return makeBars(n, startTime, step);
}
