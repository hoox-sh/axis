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

/** Volume histogram points — pre-sized single pass (no intermediate `.map` GC). */
export function mapBarsToVolumeData(
  bars: readonly Bar[],
  colors: { up: string; down: string },
): Array<{ time: number; value: number; color: string }> {
  const n = bars.length;
  const out = new Array<{ time: number; value: number; color: string }>(n);
  for (let i = 0; i < n; i++) {
    const b = bars[i]!;
    const vol =
      b.volume != null && Number.isFinite(b.volume) && b.volume >= 0 ? b.volume : 0;
    out[i] = {
      time: b.time,
      value: vol,
      color: b.close >= b.open ? colors.up : colors.down,
    };
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
