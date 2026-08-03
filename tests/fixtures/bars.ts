/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
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

export const SAMPLE_BARS = makeBars(5);
