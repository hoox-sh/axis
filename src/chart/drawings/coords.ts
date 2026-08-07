// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Coordinate context for AXIS drawing tools.
 *
 * Maps (time, price) ↔ SVG/screen coords via Lightweight Charts timeScale +
 * series price scale. Unix time is tried first; logical bar index is the
 * fallback (compile-mode `bar_index` / Pine plot x coordinates).
 *
 * Interactive drawings may extend up to {@link DRAWING_FUTURE_BARS} past the
 * last series bar (trendlines into empty right space). LWC `coordinateToTime`
 * returns null there — we extrapolate via logical index × bar period.
 *
 * Does **not**:
 * - Snap to OHLC (see `snap.ts`)
 * - Render SVG or own drawing state
 * - Interpret Pine Script™ plot series directly
 */

import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';

/**
 * Max bars past the last OHLCV bar for interactive drawings (place + paint).
 * Matches chart right-offset headroom for empty future whitespace.
 */
export const DRAWING_FUTURE_BARS = 500;

/** Default right-margin bars on the price pane (breathing room to start a draw). */
export const DRAWING_RIGHT_OFFSET_DEFAULT = 20;

/** Minimal bar shape for period / logical ↔ time math. */
export interface TimeBarLike {
  time: number;
}

/** Pane pixel size used when extending rays / sizing hit areas. */
export interface ViewSize {
  width: number;
  height: number;
}

/**
 * Median positive delta among the last few bars (seconds or ms as stored).
 * Falls back to 60 when the series is too short / irregular.
 */
export function estimateBarPeriod(bars: readonly TimeBarLike[]): number {
  const n = bars.length;
  if (n < 2) return 60;
  const samples: number[] = [];
  const from = Math.max(1, n - 24);
  for (let i = from; i < n; i++) {
    const t0 = Number(bars[i - 1]!.time);
    const t1 = Number(bars[i]!.time);
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;
    const d = t1 - t0;
    if (Number.isFinite(d) && d > 0) samples.push(d);
  }
  if (!samples.length) return 60;
  samples.sort((a, b) => a - b);
  const mid = samples[Math.floor(samples.length / 2)];
  return mid && Number.isFinite(mid) && mid > 0 ? mid : 60;
}

/**
 * Map a unix (or series) time to a continuous logical bar index.
 * Past the last bar: lastIndex + (time − lastTime) / period, capped at
 * lastIndex + {@link DRAWING_FUTURE_BARS}.
 */
export function unixTimeToLogicalIndex(
  time: number,
  bars: readonly TimeBarLike[],
  futureBars = DRAWING_FUTURE_BARS,
): number | null {
  if (!bars.length || !Number.isFinite(time)) return null;
  const lastIdx = bars.length - 1;
  const first = bars[0]!;
  const last = bars[lastIdx]!;
  const firstT = Number(first.time);
  const lastT = Number(last.time);
  if (!Number.isFinite(firstT) || !Number.isFinite(lastT)) return null;
  const period = estimateBarPeriod(bars);
  if (!Number.isFinite(period) || period <= 0) return null;

  if (time >= lastT) {
    const extra = (time - lastT) / period;
    const capped = Math.min(Math.max(0, extra), Math.max(0, futureBars));
    return Number.isFinite(capped) ? lastIdx + capped : null;
  }
  if (time <= firstT) {
    const logical = (time - firstT) / period; // may be negative
    return Number.isFinite(logical) ? logical : null;
  }

  // Binary search between bars; interpolate fractionally
  let lo = 0;
  let hi = lastIdx;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = Number(bars[mid]!.time);
    if (!Number.isFinite(t)) {
      // Skip corrupt bar times by shrinking toward finite ends
      hi = mid - 1;
      continue;
    }
    if (t === time) return mid;
    if (t < time) lo = mid + 1;
    else hi = mid - 1;
  }
  // hi = last with t < time; lo = first with t > time
  if (hi < 0) return 0;
  if (lo > lastIdx) return lastIdx;
  const t0 = Number(bars[hi]!.time);
  const t1 = Number(bars[lo]!.time);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return hi;
  const frac = t1 !== t0 ? (time - t0) / (t1 - t0) : 0;
  const logical = hi + frac;
  return Number.isFinite(logical) ? logical : null;
}

/**
 * Map a continuous logical index back to series time (extrapolates past end).
 * Caps future span at {@link DRAWING_FUTURE_BARS} bars.
 */
export function logicalIndexToUnixTime(
  logical: number,
  bars: readonly TimeBarLike[],
  futureBars = DRAWING_FUTURE_BARS,
): number | null {
  if (!bars.length || !Number.isFinite(logical)) return null;
  const lastIdx = bars.length - 1;
  const firstT = Number(bars[0]!.time);
  const lastT = Number(bars[lastIdx]!.time);
  if (!Number.isFinite(firstT) || !Number.isFinite(lastT)) return null;
  const period = estimateBarPeriod(bars);
  if (!Number.isFinite(period) || period <= 0) return null;
  const maxLogical = lastIdx + Math.max(0, futureBars);

  if (logical >= lastIdx) {
    const capped = Math.min(logical, maxLogical);
    const t = lastT + (capped - lastIdx) * period;
    return Number.isFinite(t) ? t : null;
  }
  if (logical <= 0) {
    const t = firstT + logical * period;
    return Number.isFinite(t) ? t : null;
  }

  const i0 = Math.floor(logical);
  const i1 = Math.min(lastIdx, i0 + 1);
  const frac = logical - i0;
  const t0 = Number(bars[i0]!.time);
  const t1 = Number(bars[i1]!.time);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  const t = t0 + (t1 - t0) * frac;
  return Number.isFinite(t) ? t : null;
}

/**
 * Cap a future time at lastBar + futureBars × period.
 * Times at or before lastBar are unchanged. Missing lastBar → unchanged.
 */
export function clampTimeToFutureHorizon(
  time: number,
  bars: readonly TimeBarLike[],
  futureBars = DRAWING_FUTURE_BARS,
): number {
  // Non-finite input: return unchanged (callers must treat as invalid).
  if (!Number.isFinite(time)) return time;
  if (!bars.length) return time;
  const last = Number(bars[bars.length - 1]!.time);
  if (!Number.isFinite(last)) return time;
  if (time <= last) return time;
  const period = estimateBarPeriod(bars);
  if (!Number.isFinite(period) || period <= 0) return last;
  const maxT = last + period * Math.max(0, futureBars);
  if (!Number.isFinite(maxT)) return last;
  return time > maxT ? maxT : time;
}

/** True when v is a finite number (pixel / chart coord). */
function finiteCoord(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Bound helpers for one chart + series pair.
 * All methods may return `null` when the scale cannot resolve a coordinate
 * (off-scale price, missing time, etc.).
 */
export interface CoordContext {
  /** Chart point → SVG x/y (null if either axis fails). */
  toXY(p: { time: number; price: number }): { x: number; y: number } | null;
  priceToY(price: number): number | null;
  /**
   * Time → pixel X. Tries unix seconds first, then logical bar index
   * (including extrapolated future times when `bars` are provided).
   */
  timeToX(time: number): number | null;
  size: ViewSize;
  /**
   * Unix time → logical index when resolvable; otherwise returns `time` if finite
   * (already a bar_index-style logical).
   */
  timeToLogical(time: number): number | null;
  /**
   * Pointer client coords + SVG bounding rect → chart time/price.
   * Expects the SVG overlay to share the pane's coordinate origin.
   * Past the last bar, extrapolates time via logical index (up to
   * {@link DRAWING_FUTURE_BARS}).
   */
  clientToPoint(
    clientX: number,
    clientY: number,
    svgRect: DOMRect,
  ): { time: number; price: number } | null;
}

export type CreateCoordContextOpts = {
  /** OHLCV (or time-only) series for future-time extrapolation. */
  getBars?: () => readonly TimeBarLike[] | null | undefined;
};

/**
 * Build a coord context bound to a chart + price series.
 * Any LWC series with price ↔ Y conversion works (candles, bars, line, …).
 * `getSize` is read on each `size` access so callers can track pane resize.
 */
export function createCoordContext(
  chart: IChartApi,
  series: ISeriesApi<any>,
  getSize: () => ViewSize,
  opts: CreateCoordContextOpts = {},
): CoordContext {
  const barsOf = () => {
    const b = opts.getBars?.();
    return b?.length ? b : null;
  };

  const timeToX = (time: number): number | null => {
    if (!Number.isFinite(time)) return null;
    // Interpret path uses unix seconds; compile-mode drawings often pass bar_index.
    let x: number | null = null;
    try {
      x = chart.timeScale().timeToCoordinate(time as UTCTimestamp);
    } catch {
      x = null;
    }
    if (!finiteCoord(x)) x = null;
    if (x == null) {
      const bars = barsOf();
      if (bars) {
        const logical = unixTimeToLogicalIndex(time, bars);
        if (logical != null) {
          try {
            const lx = chart.timeScale().logicalToCoordinate(logical as never);
            x = finiteCoord(lx) ? lx : null;
          } catch {
            x = null;
          }
        }
      }
      if (x == null) {
        // Fallback: treat value as logical bar index (bar_index / compile x1/left).
        try {
          const lx = chart.timeScale().logicalToCoordinate(time as never);
          x = finiteCoord(lx) ? lx : null;
        } catch {
          x = null;
        }
      }
    }
    return x;
  };

  const priceToY = (price: number): number | null => {
    if (!Number.isFinite(price)) return null;
    try {
      const y = series.priceToCoordinate(price);
      return finiteCoord(y) ? y : null;
    } catch {
      return null;
    }
  };

  const toXY = (p: {
    time: number;
    price: number;
  }): { x: number; y: number } | null => {
    if (!Number.isFinite(p.time) || !Number.isFinite(p.price)) return null;
    const x = timeToX(p.time);
    const y = priceToY(p.price);
    if (x == null || y == null) return null;
    return { x, y };
  };

  const timeToLogical = (time: number): number | null => {
    if (!Number.isFinite(time)) return null;
    try {
      const x = chart.timeScale().timeToCoordinate(time as UTCTimestamp);
      if (finiteCoord(x)) {
        const logical = chart.timeScale().coordinateToLogical(x);
        if (finiteCoord(logical)) return logical;
      }
    } catch {
      /* fall through */
    }
    const bars = barsOf();
    if (bars) {
      const fromBars = unixTimeToLogicalIndex(time, bars);
      if (fromBars != null && Number.isFinite(fromBars)) return fromBars;
    }
    // Already a logical bar index (compile-mode / bar_index)
    return time;
  };

  const clientToPoint = (
    clientX: number,
    clientY: number,
    svgRect: DOMRect,
  ): { time: number; price: number } | null => {
    if (
      !Number.isFinite(clientX) ||
      !Number.isFinite(clientY) ||
      !svgRect ||
      !Number.isFinite(svgRect.left) ||
      !Number.isFinite(svgRect.top)
    ) {
      return null;
    }
    const x = clientX - svgRect.left;
    const y = clientY - svgRect.top;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    let price: number | null = null;
    try {
      const p = series.coordinateToPrice(y);
      price = finiteCoord(p) ? p : null;
    } catch {
      price = null;
    }
    if (price == null) return null;

    let t: number | null = null;
    try {
      const rawTime = chart.timeScale().coordinateToTime(x);
      if (rawTime != null) {
        t =
          typeof rawTime === 'number'
            ? rawTime
            : (rawTime as { timestamp?: number }).timestamp ?? null;
      }
    } catch {
      t = null;
    }
    // Past last bar: LWC returns null — extrapolate via logical index
    if (t == null || !Number.isFinite(t)) {
      try {
        const logical = chart.timeScale().coordinateToLogical(x);
        const bars = barsOf();
        if (finiteCoord(logical) && bars) {
          t = logicalIndexToUnixTime(logical, bars);
        }
      } catch {
        t = null;
      }
    }
    if (t == null || !Number.isFinite(t)) return null;
    const bars = barsOf();
    if (bars) t = clampTimeToFutureHorizon(t, bars);
    if (!Number.isFinite(t)) return null;
    return { time: t, price };
  };

  return {
    toXY,
    priceToY,
    timeToX,
    get size() {
      return getSize();
    },
    timeToLogical,
    clientToPoint,
  };
}
