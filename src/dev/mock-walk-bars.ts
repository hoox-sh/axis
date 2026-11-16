/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Deterministic 10s-bar synthetic walk for reference/parity tests and the
 * dev-only mock-walk venue.
 *
 * Not a market simulation — a stable, seeded price path with enough shape
 * (slow sine drift + occasional jumps) to exercise RSI / EMA / RMA / Donchian
 * warm-up and NaN handling. `mockWalkBars()` is pure: same (count, seed) in,
 * same bars out. No `Math.random` anywhere.
 *
 * Jump rule: a jump term is added on bars where `i % 211 === 0` (bar 0
 * included), drawn from the same mulberry32 stream. The RNG draw order is
 * fixed: shock → (jump, only on jump bars) → high → low → volume.
 */

import type { Bar } from '../store/types';

export const MOCK_WALK_SEED = 1337;
export const MOCK_WALK_COUNT = 5000;
export const MOCK_WALK_STEP_SEC = 10;
export const MOCK_WALK_START_TIME = 1_700_000_000;

/** Interval between the jump bars, in bars. */
const JUMP_EVERY = 211;

/**
 * Build `count` synthetic bars starting at {@link MOCK_WALK_START_TIME},
 * spaced {@link MOCK_WALK_STEP_SEC} seconds apart.
 *
 * Price path: start at 100; per bar,
 * `drift = sin(i / 97) * 0.0015 + 0.0002` (gentle up-drift with a slow wave),
 * `shock = (rand() - 0.5) * 0.02 * price`, plus `(rand() - 0.5) * 0.06 * price`
 * on every {@link JUMP_EVERY}th bar. `close = max(1, price + drift * price +
 * shock [+ jump])`. `open` is the previous close; `high`/`low` bracket
 * `max/min(open, close)` by up to 0.4%; volume scales with bar range.
 * All outputs are finite.
 */
export function mockWalkBars(
  count: number = MOCK_WALK_COUNT,
  seed: number = MOCK_WALK_SEED,
): Bar[] {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const bars: Bar[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const open = price;
    const drift = Math.sin(i / 97) * 0.0015 + 0.0002;
    const shock = (rand() - 0.5) * 0.02 * price;
    const jump = i % JUMP_EVERY === 0 ? (rand() - 0.5) * 0.06 * price : 0;
    const close = Math.max(1, price + drift * price + shock + jump);
    const high = Math.max(open, close) * (1 + rand() * 0.004);
    const low = Math.min(open, close) * (1 - rand() * 0.004);
    const volume = Math.round(500 + rand() * 1500 + (Math.abs(close - open) / open) * 9000);
    bars.push({
      time: MOCK_WALK_START_TIME + i * MOCK_WALK_STEP_SEC,
      open,
      high,
      low,
      close,
      volume,
    });
    price = close;
  }
  return bars;
}

/** Frozen reference series ({@link MOCK_WALK_COUNT} bars) for tests. */
export const MOCK_WALK_BARS: readonly Bar[] = Object.freeze(mockWalkBars());
