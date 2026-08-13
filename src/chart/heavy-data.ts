// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Helpers for large OHLCV histories (10k+ candles).
 *
 * - LWC **conflation** thresholds (zoom-out draw cost)
 * - Efficient volume series mapping
 * - Coalesced rAF for crosshair multi-pane mirrors
 *
 * Full bar history stays in the store (engine needs it). Conflation only
 * reduces *rendered* points when bar spacing is sub-pixel.
 *
 * @module chart/heavy-data
 */

import type { Bar } from '../store/types';

/** Histories at/above this size enable LWC conflation precompute after paint. */
export const HEAVY_BARS_THRESHOLD = 10_000;

/** Soft threshold: enable conflation without precompute (helps mid-size zoom-out). */
export const CONFLATION_BARS_THRESHOLD = 2_500;

/** True when history is large enough that chart paint must stay lean. */
export function isHeavyBarLoad(barCount: number): boolean {
  return Number.isFinite(barCount) && barCount >= HEAVY_BARS_THRESHOLD;
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

/** LWC timeScale options for large datasets (safe on small histories too). */
export function heavyTimeScaleOptions(barCount: number): {
  enableConflation: boolean;
  precomputeConflationOnInit: boolean;
  precomputeConflationPriority: 'background' | 'user-visible' | 'user-blocking';
  conflationThresholdFactor: number;
} {
  const heavy = isHeavyBarLoad(barCount);
  const mid = barCount >= CONFLATION_BARS_THRESHOLD;
  return {
    // Always on for mid+ loads; tiny histories keep default path (no cost)
    enableConflation: mid || heavy,
    // Precompute only when truly large — costs memory / init, pays off on zoom
    precomputeConflationOnInit: heavy,
    precomputeConflationPriority: 'background',
    // 1.0 = merge only when bars share a sub-pixel column (candles stay crisp)
    conflationThresholdFactor: 1,
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
