// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Default chart viewport.
 *
 * A fresh load shows the newest bars at the right edge, with a small empty
 * margin. Resume and reconnect keep that view. They do not fit the whole
 * history, and they do not leave a multi-hundred-bar future margin that
 * pushes the candles to the left of the time scale.
 *
 * Tune {@link DEFAULT_VISIBLE_BARS} and {@link CHART_RIGHT_OFFSET} here.
 * Both are bar counts, so they stay stable across timeframes.
 */

/** Real bars a fresh chart shows, ending at the newest bar. */
export const DEFAULT_VISIBLE_BARS = 160;

/**
 * Empty bars to the right of the newest candle.
 * Drawing coordinates may still extrapolate further, but the visible margin
 * never grows past this — a 500-bar future offset is about five days of 15m
 * and leaves the candles on the far left.
 */
export const CHART_RIGHT_OFFSET = 16;

export interface LogicalSpan {
  from: number;
  to: number;
}

/** Logical range covering the last `visibleBars` real bars plus the right margin. */
export function recentLogicalRange(
  barCount: number,
  visibleBars = DEFAULT_VISIBLE_BARS,
  rightOffset = CHART_RIGHT_OFFSET,
): LogicalSpan {
  const n = Math.max(0, Math.floor(Number.isFinite(barCount) ? barCount : 0));
  const offset = Math.max(0, Math.floor(Number.isFinite(rightOffset) ? rightOffset : 0));
  const span = Math.max(
    1,
    Math.floor(Number.isFinite(visibleBars) ? visibleBars : DEFAULT_VISIBLE_BARS),
  );
  if (n <= 0) return { from: 0, to: Math.max(1, offset) };
  const shown = Math.min(span, n);
  const to = n - 1 + offset;
  // A short history starts at the first bar. A longer one ends on the newest.
  const from = n <= span ? 0 : to - shown - offset;
  return { from, to };
}

/**
 * Cut logical bars that sit further right than the last candle plus the
 * allowed margin. The left edge stays, so a zoom the user chose is kept
 * and only the empty future tail shrinks.
 */
export function trimFutureOverhang(
  range: LogicalSpan | null,
  barCount: number,
  rightOffset = CHART_RIGHT_OFFSET,
): LogicalSpan | null {
  if (!range) return null;
  if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to <= range.from) {
    return null;
  }
  const n = Math.max(0, Math.floor(Number.isFinite(barCount) ? barCount : 0));
  const offset = Math.max(0, Number.isFinite(rightOffset) ? rightOffset : 0);
  const last = n > 0 ? n - 1 : 0;
  const maxTo = last + offset;
  // The whole range sits past the candles (a window reset). Leave the span
  // alone so the caller can slide it back onto the new tip.
  if (range.from > last) return range;
  const to = Math.min(range.to, maxTo);
  if (to <= range.from) return recentLogicalRange(Math.max(n, 1), DEFAULT_VISIBLE_BARS, offset);
  return { from: range.from, to };
}

type TimeScaleLike = {
  options?: () => { rightOffset?: number };
  applyOptions?: (opts: { rightOffset: number }) => void;
  setVisibleLogicalRange?: (range: LogicalSpan) => void;
};

/** Snap a stuck future margin (the old 500-bar allowance) back to the default. */
export function capChartRightOffset(chart: { timeScale?: () => TimeScaleLike }): void {
  try {
    const ts = chart.timeScale?.();
    if (!ts?.applyOptions) return;
    const cur = Number(ts.options?.()?.rightOffset ?? 0);
    if (Number.isFinite(cur) && cur > CHART_RIGHT_OFFSET) {
      ts.applyOptions({ rightOffset: CHART_RIGHT_OFFSET });
    }
  } catch {
    /* mock time scales omit options() */
  }
}

/** Pin the price time scale to the newest bars plus the default right margin. */
export function showRecentLogicalRange(
  chart: { timeScale?: () => TimeScaleLike },
  barCount: number,
): void {
  capChartRightOffset(chart);
  try {
    chart.timeScale?.().setVisibleLogicalRange?.(recentLogicalRange(barCount));
  } catch {
    /* mock time scales may not implement the setter */
  }
}
