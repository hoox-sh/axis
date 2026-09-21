// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Helpers for large OHLCV histories (10k–100k candles).
 *
 * - LWC **conflation** thresholds (zoom-out draw cost)
 * - Visible-window index ranges so pan/zoom never walks the full series
 * - Marker caps (plotshape on every bar would otherwise freeze LWC)
 * - Efficient volume series mapping
 * - Coalesced rAF for crosshair / time-scale multi-pane mirrors
 *
 * Full bar history stays in the store (engine needs it). Conflation only
 * reduces *rendered* points when bar spacing is sub-pixel. `minBarSpacing`
 * is lowered on heavy loads so fit-content can actually show 45k+ bars;
 * without that, LWC clamps at 0.5px/bar and never enters the conflation
 * regime — the chart stays dense and janky.
 *
 * @module chart/heavy-data
 */

import type { Bar } from '../store/types';

/** Histories at/above this size enable LWC conflation precompute after paint. */
export const HEAVY_BARS_THRESHOLD = 10_000;

/** Soft threshold: enable conflation without precompute (helps mid-size zoom-out). */
export const CONFLATION_BARS_THRESHOLD = 2_500;

/** 25k+ — precompute at user-visible priority; fatter progressive-paint throttle. */
export const VERY_HEAVY_BARS_THRESHOLD = 25_000;

/**
 * Hard cap on LWC series markers (plotshape / plotchar / plotarrow).
 * 45k markers on the candle series is a guaranteed frame drop.
 */
export const MAX_CHART_MARKERS = 2_500;

/** True when history is large enough that chart paint must stay lean. */
export function isHeavyBarLoad(barCount: number): boolean {
  return Number.isFinite(barCount) && barCount >= HEAVY_BARS_THRESHOLD;
}

/** True when history is large enough to need the aggressive LWC path. */
export function isVeryHeavyBarLoad(barCount: number): boolean {
  return Number.isFinite(barCount) && barCount >= VERY_HEAVY_BARS_THRESHOLD;
}

/**
 * O(log n) bar index for sorted OHLCV by time (exact or nearest).
 * Replaces linear findIndex + full scans on every crosshair move.
 */
export function barIndexAtTimeBinary(
  bars: readonly { time: number }[],
  time: number | null | undefined,
): number {
  const n = bars.length;
  if (!n) return -1;
  if (time == null || !Number.isFinite(time)) return n - 1;
  let lo = 0;
  let hi = n - 1;
  if (time <= bars[0]!.time) return 0;
  if (time >= bars[hi]!.time) return hi;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = bars[mid]!.time;
    if (t === time) return mid;
    if (t < time) lo = mid + 1;
    else hi = mid - 1;
  }
  // Nearest of the two candidates around the insertion point
  const a = Math.max(0, hi);
  const c = Math.min(n - 1, lo);
  return Math.abs(bars[a]!.time - time) <= Math.abs(bars[c]!.time - time) ? a : c;
}

/**
 * Inclusive/exclusive index window into a sorted unix-seconds array.
 * `from` is the first index with `times[i] >= tMin`; `to` is exclusive
 * (first index with `times[i] > tMax`). Empty input → `{ from: 0, to: 0 }`.
 */
export function indexRangeForSortedTimes(
  times: readonly number[],
  tMin: number,
  tMax: number,
): { from: number; to: number } {
  const n = times.length;
  if (!n) return { from: 0, to: 0 };
  const loBound = Number.isFinite(tMin) ? tMin : Number.NEGATIVE_INFINITY;
  const hiBound = Number.isFinite(tMax) ? tMax : Number.POSITIVE_INFINITY;
  if (hiBound < loBound) return { from: 0, to: 0 };

  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] as number) < loBound) lo = mid + 1;
    else hi = mid;
  }
  const from = lo;
  lo = from;
  hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] as number) <= hiBound) lo = mid + 1;
    else hi = mid;
  }
  return { from, to: lo };
}

/**
 * Inclusive/exclusive bar-index window for a sorted OHLCV series.
 * Same contract as {@link indexRangeForSortedTimes}.
 */
export function barIndexRangeForTimeWindow(
  bars: readonly { time: number }[],
  tMin: number,
  tMax: number,
): { from: number; to: number } {
  const n = bars.length;
  if (!n) return { from: 0, to: 0 };
  const loBound = Number.isFinite(tMin) ? tMin : Number.NEGATIVE_INFINITY;
  const hiBound = Number.isFinite(tMax) ? tMax : Number.POSITIVE_INFINITY;
  if (hiBound < loBound) return { from: 0, to: 0 };

  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.time < loBound) lo = mid + 1;
    else hi = mid;
  }
  const from = lo;
  lo = from;
  hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.time <= hiBound) lo = mid + 1;
    else hi = mid;
  }
  return { from, to: lo };
}

/** Keep the newest `max` items (plotshape / marker caps). */
export function capNewest<T>(items: readonly T[], max: number): T[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  if (!Number.isFinite(max) || max <= 0) return [];
  if (items.length <= max) return items.slice();
  return items.slice(items.length - max);
}

/** LWC timeScale options for large datasets (safe on small histories too). */
export function heavyTimeScaleOptions(barCount: number): {
  enableConflation: boolean;
  precomputeConflationOnInit: boolean;
  precomputeConflationPriority: 'background' | 'user-visible' | 'user-blocking';
  conflationThresholdFactor: number;
  minBarSpacing: number;
} {
  const heavy = isHeavyBarLoad(barCount);
  const veryHeavy = isVeryHeavyBarLoad(barCount);
  const mid = barCount >= CONFLATION_BARS_THRESHOLD;
  return {
    // Always on for mid+ loads; tiny histories keep default path (no cost)
    enableConflation: mid || heavy,
    // Precompute only when truly large — costs memory / init, pays off on zoom
    precomputeConflationOnInit: heavy,
    // 25k+ needs chunks ready before the first fit/zoom or the UI hitchs
    precomputeConflationPriority: veryHeavy ? 'user-visible' : 'background',
    // 1.0 = merge only when bars share a sub-pixel column (candles stay crisp)
    conflationThresholdFactor: 1,
    // Default LWC minBarSpacing is 0.5px — that blocks fit-content on 45k
    // candles (never reaches the conflation threshold). Drop it on heavy loads.
    minBarSpacing: heavy ? 0.001 : 0.5,
  };
}

/** Volume histogram points — single pass, skips non-finite time/OHLC rows. */
export function mapBarsToVolumeData(
  bars: readonly Bar[],
  colors: { up: string; down: string },
): Array<{ time: number; value: number; color: string }> {
  const out: Array<{ time: number; value: number; color: string }> = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    if (
      !Number.isFinite(b.time) ||
      !Number.isFinite(b.open) ||
      !Number.isFinite(b.close)
    ) {
      continue;
    }
    const vol =
      b.volume != null && Number.isFinite(b.volume) && b.volume >= 0 ? b.volume : 0;
    out.push({
      time: b.time,
      value: vol,
      color: b.close >= b.open ? colors.up : colors.down,
    });
  }
  return out;
}

/**
 * Coalesce multi-pane crosshair mirrors to one rAF tick.
 * Pointer moves fire ~60–120/s; each call used to hit every pane synchronously.
 */
export function createRafCoalescer(): {
  schedule: (fn: () => void) => void;
  cancel: () => void;
} {
  let raf = 0;
  let pending: (() => void) | null = null;
  return {
    schedule(fn: () => void) {
      pending = fn;
      if (raf) return;
      if (typeof requestAnimationFrame !== 'function') {
        pending?.();
        pending = null;
        return;
      }
      raf = requestAnimationFrame(() => {
        raf = 0;
        const run = pending;
        pending = null;
        try {
          run?.();
        } catch {
          /* caller owns errors */
        }
      });
    },
    cancel() {
      pending = null;
      if (raf && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(raf);
      }
      raf = 0;
    },
  };
}
