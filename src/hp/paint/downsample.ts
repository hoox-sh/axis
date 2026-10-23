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
 * Cold-viewport downsampling (HP PR 5 follow-up, §9.2 conflation).
 *
 * The hot window plus one cold page cover at most `2 · HOT_CAP` bars. A
 * viewport wider than that (a zoomed-out chart) cannot be filled
 * candle-for-candle from shared memory — and paging the whole series in
 * would break the `O(HOT_CAP)` contract. So the overlay falls back to
 * downsampling the chart window the main thread already owns: one bin per
 * pixel column, `open` = first open, `high`/`low` = column extremes,
 * `close` = last close, `volume` = column sum.
 *
 * `x` is the bin center in **viewport-relative slots** (fractional when a
 * bin spans several slots). The WebGL2 renderer positions
 * `(a_x − rightEdgeIndex) · spacing` in float, so fractional centers land
 * exactly where Lightweight Charts' own sub-pixel candles merge — this is
 * the plan's "min/max per pixel" conflation, and at far zoom it is visually
 * what LWC's own candles collapse into. Volume stays viewport-relative
 * (normalized against the visible bin maximum by the fill).
 *
 * This reads `store.bars` — the exact array LWC paints — so parity is by
 * construction, and it needs no SAB traffic at all. The exact hot+page
 * fill stays the path wherever the viewport is coverable; this is only
 * the fallback for wider ranges.
 *
 * @module hp/paint/downsample
 */

import type { Bar } from '../../store/types';
import { BAR_FLAG_CLOSED, BAR_FLAG_FORMING, type VisualSourceBar } from './visual-attr';

/** Clip a chart-window range to `[0, chartBars)` (LWC's right margin holds no bars). */
export function clipViewportToChart(
  chartBars: number,
  fromBase: number,
  count: number,
): { fromIdx: number; count: number } | null {
  if (!Number.isFinite(chartBars) || !Number.isFinite(fromBase) || !Number.isFinite(count)) {
    return null;
  }
  if (!(chartBars > 0)) return null;
  const n = Math.trunc(count);
  if (n <= 0) return null;
  const from = Math.max(Math.trunc(fromBase), 0);
  const to = Math.min(Math.trunc(fromBase) + n, Math.trunc(chartBars));
  if (to <= from) return null;
  return { fromIdx: from, count: to - from };
}

/**
 * Bin `count` slots starting at `fromIdx` into at most `pixelWidth` candles.
 *
 * `fromIdx` and `viewportFrom` share the chart's index space; `x` is
 * viewport-relative (`x = slotCenter − viewportFrom`), so record 0 starts at
 * the viewport's left edge exactly like the exact fill's slot 0. Bins are
 * contiguous and cover `[fromIdx, fromIdx + count)` without gaps: bin `i`
 * of `bins` holds
 * `[fromIdx + ⌊i·count/bins⌋, fromIdx + ⌊(i+1)·count/bins⌋)`.
 *
 * An empty range, a non-positive pixel width, or bars missing for a bin
 * yield no records for that span — the caller keeps LWC underneath.
 */
export function downsampleToPixelColumns(
  bars: readonly Bar[],
  fromIdx: number,
  count: number,
  pixelWidth: number,
  viewportFrom: number,
): VisualSourceBar[] {
  if (!Number.isFinite(fromIdx) || !Number.isFinite(count) || !Number.isFinite(pixelWidth))
    return [];
  const n = Math.trunc(count);
  const w = Math.trunc(pixelWidth);
  if (n <= 0 || w <= 0) return [];
  const start = Math.trunc(fromIdx);
  if (start < 0) return [];

  const bins = Math.min(n, w);
  const out: VisualSourceBar[] = [];
  for (let i = 0; i < bins; i++) {
    const b0 = start + Math.floor((i * n) / bins);
    const b1 = start + Math.floor(((i + 1) * n) / bins);
    if (b1 <= b0) continue;
    let open = 0;
    let high = -Infinity;
    let low = Infinity;
    let close = 0;
    let volume = 0;
    let flags = BAR_FLAG_CLOSED;
    let seen = 0;
    for (let s = b0; s < b1; s++) {
      const bar = bars[s];
      if (!bar) continue;
      if (seen === 0) open = bar.open ?? 0;
      const h = bar.high ?? 0;
      const l = bar.low ?? 0;
      if (h > high) high = h;
      if (l < low) low = l;
      close = bar.close ?? 0;
      volume += bar.volume ?? 0;
      flags = bar.closed === false ? BAR_FLAG_FORMING : BAR_FLAG_CLOSED;
      seen++;
    }
    if (seen <= 0) continue;
    out.push({
      x: (b0 + b1 - 1) / 2 - viewportFrom,
      open,
      high,
      low,
      close,
      volume,
      flags,
    });
  }
  return out;
}
