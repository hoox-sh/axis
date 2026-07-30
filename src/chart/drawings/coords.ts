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
 * Does **not**:
 * - Snap to OHLC (see `snap.ts`)
 * - Render SVG or own drawing state
 * - Interpret Pine Script™ plot series directly
 */

import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';

/** Pane pixel size used when extending rays / sizing hit areas. */
export interface ViewSize {
  width: number;
  height: number;
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
   * Time → pixel X. Tries unix seconds first, then logical bar index.
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
   */
  clientToPoint(
    clientX: number,
    clientY: number,
    svgRect: DOMRect,
  ): { time: number; price: number } | null;
}

/**
 * Build a coord context bound to a chart + price series.
 * Any LWC series with price ↔ Y conversion works (candles, bars, line, …).
 * `getSize` is read on each `size` access so callers can track pane resize.
 */
export function createCoordContext(
  chart: IChartApi,
  series: ISeriesApi<any>,
  getSize: () => ViewSize,
): CoordContext {
  const timeToX = (time: number): number | null => {
    // Interpret path uses unix seconds; compile-mode drawings often pass bar_index.
    let x = chart.timeScale().timeToCoordinate(time as UTCTimestamp);
    if (x == null && Number.isFinite(time)) {
      // Fallback: treat value as logical bar index (bar_index / compile x1/left).
      try {
        x = chart.timeScale().logicalToCoordinate(time as never);
      } catch {
        x = null;
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
    const time = chart.timeScale().coordinateToTime(x);
    const price = series.coordinateToPrice(y);
    if (time == null || price == null) return null;
    const t =
      typeof time === 'number'
        ? time
        : (time as { timestamp?: number }).timestamp;
    if (t == null || !Number.isFinite(t) || !Number.isFinite(price)) return null;
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
