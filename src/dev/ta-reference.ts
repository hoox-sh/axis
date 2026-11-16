/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Reference implementations of the `ta.*` builtins, mirroring the PYNE
 * (`numba_builtins.py`) semantics exactly, so tests can assert behaviour
 * without a Python subprocess. Also shared by the dev-only mock-walk venue as
 * an independent cross-check for visible drift.
 *
 * Conventions (matching pyne, not JS nulls):
 * - Every function returns `number[]` of the same length as its input(s),
 *   with `Number.NaN` in the cells that are undefined.
 * - NaN means "not available yet / poisoned"; it is never a real value.
 *
 * Seeding rules (identical for {@link ema} and {@link rma}):
 * - NaN until the first index `s >= period - 1` whose window
 *   `[s - period + 1, s]` is entirely non-NaN. The seed is the SMA of that
 *   window. A leading run of NaNs shifts the seed later; it does not poison it.
 * - After the seed, `ema` propagates NaN forever (alpha * NaN stays NaN),
 *   while `rma` holds the previous value when the input is NaN.
 *
 * RSI note (documented deviation): pyne's numba seed branch poisons the
 * running averages when a seed-window delta is NaN, and its recursion maps a
 * NaN delta to a zero gain/loss contribution; either way the affected index
 * and everything after it come out NaN in practice. We implement the simpler,
 * equivalent contract: if either input to a delta is NaN, that index and every
 * later index are NaN. Warm-up cells before `period` are NaN regardless.
 *
 * `highest` / `lowest` skip NaN members (max/min of the finite values in the
 * window) and return NaN only when the whole window is NaN.
 */

/** NaN-safe indexed read (arrays here are index-addressed by construction). */
const numAt = (a: readonly number[], i: number): number => {
  const v = a[i];
  return v === undefined ? Number.NaN : v;
};

/** NaN-safe mean of exactly `period` values ending at/before index `i`. */
function windowAllFinite(src: readonly number[], period: number, i: number): boolean {
  for (let j = i - period + 1; j <= i; j++) {
    if (Number.isNaN(numAt(src, j))) return false;
  }
  return true;
}

function windowSum(src: readonly number[], period: number, i: number): number {
  let sum = 0;
  for (let j = i - period + 1; j <= i; j++) sum += numAt(src, j);
  return sum;
}

function normalizePeriod(period: number): number {
  return Math.floor(period);
}

/** Simple moving average. NaN until `i >= period - 1`; any NaN in window → NaN. */
export function sma(src: readonly number[], period: number): number[] {
  const n = src.length;
  const out = new Array<number>(n).fill(Number.NaN);
  const p = normalizePeriod(period);
  if (!Number.isFinite(period) || p <= 0) return out;
  for (let i = p - 1; i < n; i++) {
    if (!windowAllFinite(src, p, i)) continue;
    out[i] = windowSum(src, p, i) / p;
  }
  return out;
}

/**
 * Exponential moving average. NaN until the first all-finite `period`-wide
 * window seeds the SMA; then `ema = alpha * x + (1 - alpha) * ema` with
 * `alpha = 2 / (period + 1)`. A NaN input poisons this index and all later ones.
 */
export function ema(src: readonly number[], period: number): number[] {
  const n = src.length;
  const out = new Array<number>(n).fill(Number.NaN);
  const p = normalizePeriod(period);
  if (!Number.isFinite(period) || p <= 0) return out;
  const alpha = 2 / (p + 1);
  // Earliest all-finite window wins (pyne seeds on the first such window).
  let seedEnd = -1;
  let seed = Number.NaN;
  for (let s = p - 1; s < n; s++) {
    if (windowAllFinite(src, p, s)) {
      seedEnd = s;
      seed = windowSum(src, p, s) / p;
      break;
    }
  }
  if (seedEnd < 0) return out;
  out[seedEnd] = seed;
  let prev = seed;
  for (let j = seedEnd + 1; j < n; j++) {
    // NaN input poisons `prev` forever — matches pyne's recursion.
    prev = alpha * numAt(src, j) + (1 - alpha) * prev;
    out[j] = prev;
  }
  return out;
}

/**
 * Wilder's smoothed moving average (RMA). Same SMA-seed rule as {@link ema}
 * with `alpha = 1 / period`; after the seed, NaN inputs hold the previous
 * value instead of propagating.
 */
export function rma(src: readonly number[], period: number): number[] {
  const n = src.length;
  const out = new Array<number>(n).fill(Number.NaN);
  const p = normalizePeriod(period);
  if (!Number.isFinite(period) || p <= 0) return out;
  const alpha = 1 / p;
  let seedEnd = -1;
  let seed = Number.NaN;
  for (let s = p - 1; s < n; s++) {
    if (windowAllFinite(src, p, s)) {
      seedEnd = s;
      seed = windowSum(src, p, s) / p;
      break;
    }
  }
  if (seedEnd < 0) return out;
  out[seedEnd] = seed;
  let prev = seed;
  for (let j = seedEnd + 1; j < n; j++) {
    const v = numAt(src, j);
    if (!Number.isNaN(v)) prev = alpha * v + (1 - alpha) * prev;
    out[j] = prev;
  }
  return out;
}

/**
 * Wilder RSI. NaN until index `period`; the seed is the simple average of the
 * first `period` deltas (i = 1..period). `delta >= 0` counts as a gain,
 * otherwise the loss magnitude is used. If `avgLoss == 0` the RSI is 100.
 *
 * NaN inputs: a NaN delta at index j makes every output at index >= j NaN
 * (see module doc). Warm-up cells before `period` are always NaN.
 */
export function rsi(closes: readonly number[], period = 14): number[] {
  const n = closes.length;
  const out = new Array<number>(n).fill(Number.NaN);
  const p = normalizePeriod(period);
  if (!Number.isFinite(period) || p <= 0) return out;
  if (n <= p) return out;

  const fromAverages = (avgGain: number, avgLoss: number): number => {
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  };

  // Seed: simple average of the first `period` deltas (i = 1..period).
  let avgGain = 0;
  let avgLoss = 0;
  let poisoned = false;
  for (let j = 1; j <= p; j++) {
    const d = numAt(closes, j) - numAt(closes, j - 1);
    if (Number.isNaN(d)) {
      poisoned = true;
      break;
    }
    if (d >= 0) avgGain += d;
    else avgLoss -= d;
  }
  if (poisoned) return out;
  avgGain /= p;
  avgLoss /= p;
  out[p] = fromAverages(avgGain, avgLoss);

  const alpha = 1 / p;
  for (let j = p + 1; j < n; j++) {
    const d = numAt(closes, j) - numAt(closes, j - 1);
    if (Number.isNaN(d)) break; // this index and everything after stays NaN
    const gain = d >= 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    avgGain = alpha * gain + (1 - alpha) * avgGain;
    avgLoss = alpha * loss + (1 - alpha) * avgLoss;
    out[j] = fromAverages(avgGain, avgLoss);
  }
  return out;
}

/**
 * Highest value over the trailing `period` bars ending at `i`.
 * NaN until `i >= period - 1`. NaN members are skipped; an all-NaN window
 * yields NaN.
 */
export function highest(src: readonly number[], period: number): number[] {
  const n = src.length;
  const out = new Array<number>(n).fill(Number.NaN);
  const p = normalizePeriod(period);
  if (!Number.isFinite(period) || p <= 0) return out;
  for (let i = p - 1; i < n; i++) {
    let m = Number.NaN;
    for (let j = i - p + 1; j <= i; j++) {
      const v = numAt(src, j);
      if (Number.isNaN(v)) continue;
      if (Number.isNaN(m) || v > m) m = v;
    }
    out[i] = m;
  }
  return out;
}

/**
 * Lowest value over the trailing `period` bars ending at `i`.
 * NaN until `i >= period - 1`. NaN members are skipped; an all-NaN window
 * yields NaN.
 */
export function lowest(src: readonly number[], period: number): number[] {
  const n = src.length;
  const out = new Array<number>(n).fill(Number.NaN);
  const p = normalizePeriod(period);
  if (!Number.isFinite(period) || p <= 0) return out;
  for (let i = p - 1; i < n; i++) {
    let m = Number.NaN;
    for (let j = i - p + 1; j <= i; j++) {
      const v = numAt(src, j);
      if (Number.isNaN(v)) continue;
      if (Number.isNaN(m) || v < m) m = v;
    }
    out[i] = m;
  }
  return out;
}

export interface DonchianBands {
  /** Highest high over the window. */
  upper: number[];
  /** Lowest low over the window. */
  lower: number[];
  /** `(upper + lower) / 2`; NaN when either side is NaN. */
  middle: number[];
}

/**
 * Donchian channel: `upper = highest(highs, period)`,
 * `lower = lowest(lows, period)`, `middle = (upper + lower) / 2`.
 */
export function donchian(
  highs: readonly number[],
  lows: readonly number[],
  period = 20,
): DonchianBands {
  const upper = highest(highs, period);
  const lower = lowest(lows, period);
  const middle = new Array<number>(upper.length);
  for (let i = 0; i < upper.length; i++) {
    const u = numAt(upper, i);
    const l = numAt(lower, i);
    middle[i] = Number.isNaN(u) || Number.isNaN(l) ? Number.NaN : (u + l) / 2;
  }
  return { upper, lower, middle };
}
