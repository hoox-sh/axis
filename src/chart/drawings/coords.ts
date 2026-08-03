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
    const d = Number(bars[i]!.time) - Number(bars[i - 1]!.time);
    if (Number.isFinite(d) && d > 0) samples.push(d);
  }
  if (!samples.length) return 60;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] || 60;
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
  const period = estimateBarPeriod(bars);

  if (time >= last.time) {
    const extra = (time - last.time) / period;
    const capped = Math.min(Math.max(0, extra), Math.max(0, futureBars));
    return lastIdx + capped;
  }
  if (time <= first.time) {
    return (time - first.time) / period; // may be negative
  }

  // Binary search between bars; interpolate fractionally
  let lo = 0;
  let hi = lastIdx;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = bars[mid]!.time;
    if (t === time) return mid;
    if (t < time) lo = mid + 1;
    else hi = mid - 1;
  }
  // hi = last with t < time; lo = first with t > time
  if (hi < 0) return 0;
  if (lo > lastIdx) return lastIdx;
  const t0 = bars[hi]!.time;
  const t1 = bars[lo]!.time;
  const frac = t1 !== t0 ? (time - t0) / (t1 - t0) : 0;
  return hi + frac;
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
  const period = estimateBarPeriod(bars);
  const maxLogical = lastIdx + Math.max(0, futureBars);

  if (logical >= lastIdx) {
    const capped = Math.min(logical, maxLogical);
    return bars[lastIdx]!.time + (capped - lastIdx) * period;
  }
  if (logical <= 0) {
    return bars[0]!.time + logical * period;
  }

  const i0 = Math.floor(logical);
  const i1 = Math.min(lastIdx, i0 + 1);
  const frac = logical - i0;
  const t0 = bars[i0]!.time;
  const t1 = bars[i1]!.time;
  return t0 + (t1 - t0) * frac;
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
  if (!bars.length || !Number.isFinite(time)) return time;
  const last = bars[bars.length - 1]!.time;
  if (time <= last) return time;
  const maxT = last + estimateBarPeriod(bars) * Math.max(0, futureBars);
  return time > maxT ? maxT : time;
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
    // Interpret path uses unix seconds; compile-mode drawings often pass bar_index.
    let x = chart.timeScale().timeToCoordinate(time as UTCTimestamp);
    if (x == null && Number.isFinite(time)) {
      const bars = barsOf();
      if (bars) {
        const logical = unixTimeToLogicalIndex(time, bars);
        if (logical != null) {
          try {
            x = chart.timeScale().logicalToCoordinate(logical as never);
          } catch {
            x = null;
          }
        }
      }
      if (x == null) {
        // Fallback: treat value as logical bar index (bar_index / compile x1/left).
        try {
          x = chart.timeScale().logicalToCoordinate(time as never);
        } catch {
          x = null;
        }
      }
    }
    return x;
  };

  const priceToY = (price: number): number | null => {
    return series.priceToCoordinate(price);
  };

  const toXY = (p: {
    time: number;
    price: number;
  }): { x: number; y: number } | null => {
    const x = timeToX(p.time);
    const y = priceToY(p.price);
    if (x == null || y == null) return null;
    return { x, y };
  };

  const timeToLogical = (time: number): number | null => {
    const x = chart.timeScale().timeToCoordinate(time as UTCTimestamp);
    if (x != null) {
      const logical = chart.timeScale().coordinateToLogical(x);
      return logical ?? null;
    }
    const bars = barsOf();
    if (bars) {
      const fromBars = unixTimeToLogicalIndex(time, bars);
      if (fromBars != null) return fromBars;
    }
    // Already a logical bar index (compile-mode / bar_index)
    if (Number.isFinite(time)) return time;
    return null;
  };

  const clientToPoint = (
    clientX: number,
    clientY: number,
    svgRect: DOMRect,
  ): { time: number; price: number } | null => {
    const x = clientX - svgRect.left;
    const y = clientY - svgRect.top;
    const price = series.coordinateToPrice(y);
    if (price == null || !Number.isFinite(price)) return null;

    let t: number | null = null;
    const rawTime = chart.timeScale().coordinateToTime(x);
    if (rawTime != null) {
      t =
        typeof rawTime === 'number'
          ? rawTime
          : (rawTime as { timestamp?: number }).timestamp ?? null;
    }
    // Past last bar: LWC returns null — extrapolate via logical index
    if (t == null || !Number.isFinite(t)) {
      const logical = chart.timeScale().coordinateToLogical(x);
      const bars = barsOf();
      if (logical != null && bars) {
        t = logicalIndexToUnixTime(logical, bars);
      }
    }
    if (t == null || !Number.isFinite(t)) return null;
    const bars = barsOf();
    if (bars) t = clampTimeToFutureHorizon(t, bars);
    return { time: t as number, price };
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
