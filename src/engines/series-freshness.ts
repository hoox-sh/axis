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
 * Engine series freshness — pure staleness predicates shared by the live paint
 * paths and the engine data broker.
 *
 * Why this exists: the engine owns the OHLCV series for engine-owned live mode
 * (calculator `data_session` and stream `series` subscriptions). AXIS paints the
 * chart **from that series**, so a series that is deep enough but frozen — the
 * engine's upstream stopped advancing, or a stale local window was uploaded
 * before the Data Manager repaired it — freezes the chart at the stale tail, on
 * every tick, silently.
 *
 * The predicates here are intentionally permissive at the *step* level: the
 * engine's newest bar is compared against the chart tail (or against "now") and
 * only counts as stale when it lags by more than
 * {@link ENGINE_SERIES_STALE_STEPS} whole interval steps. The forming bar, WS
 * jitter and a 1-slot lag are all normal; days-old tails are not.
 *
 * No store access, no I/O — safe for unit tests and for both the browser and
 * worker bundles.
 *
 * @module engines/series-freshness
 */

import type { Bar } from '../store/types';
import { intervalToSec } from '../data/bars-gaps';

/** Whole interval steps a series may lag before it counts as stale (2 × interval). */
export const ENGINE_SERIES_STALE_STEPS = 2;

/**
 * Missing slots that count as an internal hole, not a weekend or a one-bar slip.
 * A fresh tip can still hide a hole: the engine tick walks only the recent
 * window and leaves the minutes in between unfilled.
 */
export const ENGINE_SERIES_GAP_BARS = 30;

/** Newest bar open time of a bar list (0 when empty / non-finite). */
export function newestBarTime(bars: readonly Bar[] | null | undefined): number {
  if (!Array.isArray(bars) || !bars.length) return 0;
  for (let i = bars.length - 1; i >= 0; i--) {
    const t = bars[i]?.time;
    if (typeof t === 'number' && Number.isFinite(t) && t > 0) return t;
  }
  return 0;
}

/**
 * How many whole interval steps `later` is ahead of `earlier`.
 * Returns 0 when either bound is unknown (nothing to compare) or `later` is not
 * ahead — callers treat 0 as fresh.
 */
export function stepsBehind(earlier: number | null, later: number | null, interval: string): number {
  if (typeof earlier !== 'number' || typeof later !== 'number') return 0;
  if (!Number.isFinite(earlier) || !Number.isFinite(later)) return 0;
  if (earlier <= 0 || later <= 0 || later <= earlier) return 0;
  const step = intervalToSec(interval);
  if (step <= 0) return 0;
  return Math.max(0, Math.floor((later - earlier) / step));
}

/**
 * True when `candidate` (a series whose newest bar is `candidateNewestSec`)
 * lags more than {@link ENGINE_SERIES_STALE_STEPS} steps behind `referenceSec`.
 * An unknown bound counts as **not** stale: callers use this to decide whether
 * to *skip* a paint, and a wrong skip would trade visible staleness for hidden
 * staleness.
 */
export function seriesBehind(
  candidateNewestSec: number | null,
  referenceSec: number | null,
  interval: string,
  steps: number = ENGINE_SERIES_STALE_STEPS,
): boolean {
  return stepsBehind(candidateNewestSec, referenceSec, interval) > Math.max(1, steps);
}

/**
 * True when the engine window `next` is behind the chart window `cur` by more
 * than {@link ENGINE_SERIES_STALE_STEPS} steps — the engine is frozen, not
 * catching up. Painting it would back-date a chart the Data Manager / venue path
 * already holds at "now" (and re-open the same stale window on every tick).
 */
export function engineWindowBehindChart(
  cur: readonly Bar[] | null | undefined,
  next: readonly Bar[] | null | undefined,
  interval: string,
  steps: number = ENGINE_SERIES_STALE_STEPS,
): boolean {
  return seriesBehind(newestBarTime(next), newestBarTime(cur), interval, steps);
}

/**
 * True when the series lags "now" by more than
 * {@link ENGINE_SERIES_STALE_STEPS} steps — the market (venue trigger clock)
 * has moved on while the engine's series has not.
 */
/**
 * Slots implied by `[oldest, newest]` that `count` does not cover.
 * Unknown bounds count as no hole — a status read without `oldest` must not
 * look like a gap.
 */
export function missingSlotsInBounds(
  oldest: number | null,
  newest: number | null,
  count: number,
  interval: string,
): number {
  if (oldest == null || newest == null || count <= 0) return 0;
  if (!Number.isFinite(oldest) || !Number.isFinite(newest) || newest < oldest) return 0;
  const step = intervalToSec(interval);
  if (step <= 0) return 0;
  const expected = Math.floor((newest - oldest) / step) + 1;
  return Math.max(0, expected - count);
}

/**
 * Bars skipped between consecutive stamps. One step apart contributes 0.
 * A Friday-to-Monday jump on a session venue is a large number; compare it
 * with the chart's own gap before calling the engine holed.
 */
export function internalGapBars(
  bars: readonly { time?: number }[] | null | undefined,
  interval: string,
): number {
  if (!bars || bars.length < 2) return 0;
  const step = intervalToSec(interval);
  if (step <= 0) return 0;
  let missing = 0;
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]?.time;
    const cur = bars[i]?.time;
    if (typeof prev !== 'number' || typeof cur !== 'number') continue;
    if (cur - prev > step) missing += Math.floor((cur - prev) / step) - 1;
  }
  return missing;
}

export function seriesBehindNow(
  bars: readonly Bar[] | null | undefined,
  interval: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  steps: number = ENGINE_SERIES_STALE_STEPS,
): boolean {
  return seriesBehind(newestBarTime(bars), nowSec, interval, steps);
}
