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
 * Run window axis — the bar window one engine evaluation covered.
 *
 * ## Why this exists
 *
 * Pine's `bar_index` is a **dataset coordinate**: 0 is the first bar of the
 * dataset the script ran on. TradingView anchors that dataset at load, so an
 * index keeps its meaning for the life of the script (see Pine v6 *Execution
 * model* → “the first bar of the dataset … has an index value of 0”, and
 * `calc_bars_count`, which only moves the execution *start* at load time).
 *
 * AXIS instead re-evaluates a rolling window (`store.rollingWindowBars`,
 * newest N bars) on every live candle. The window head drops a bar per new
 * candle, so `bar_index: 4400` in run A and run B are **different bars**. Any
 * index that outlives its run (markers, results rows, debug pins, Pine
 * `xloc.bar_index` drawings) must therefore be resolved against the axis of
 * **the run that produced it** — never against the live chart array.
 *
 * The axis is stamped onto every run result as `meta.windowT0` /
 * `meta.windowSpan` / `meta.windowCount` by the runner, which is the only
 * place that knows exactly which bars were handed to the engine.
 *
 * This is the AXIS equivalent of TradingView's stable dataset plus Pine's
 * `xloc.bar_time`: resolve the index at the ingestion boundary, store absolute
 * time, and the sliding window stops mattering.
 *
 * @module results/window-axis
 */

/** Bar window an engine run evaluated (absolute time anchors). */
export interface RunWindowAxis {
  /** First bar time of the evaluated window (unix seconds). */
  t0: number;
  /** Bar span in seconds (median of adjacent deltas — robust to gaps). */
  span: number;
  /** Number of bars in the evaluated window. */
  count: number;
  /**
   * True when every adjacent delta equals {@link span}.
   *
   * Index → time is only *exact* on a uniform window. A session series with
   * weekend/holiday gaps cannot be reconstructed from `t0 + i·span`, and a
   * guessed time would silently displace events and drawings — so the index
   * helpers refuse instead ({@link timeForBarIndex} returns null).
   */
  uniform: boolean;
}

/** Meta keys the runner stamps on a run result (see {@link axisStamp}). */
export const WINDOW_AXIS_KEYS = {
  t0: 'windowT0',
  span: 'windowSpan',
  count: 'windowCount',
  uniform: 'windowUniform',
} as const;

/** Plausibility bounds for a window axis (reject ms/µs clocks and garbage). */
const MIN_T0 = 1e8; // 1973 — anything smaller is not a chart bar clock
const MAX_T0 = 1e11; // year 5138 — anything larger is milliseconds

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Median bar span of a bar series.
 *
 * Uses up to {@link SPAN_SAMPLE} adjacent deltas so a weekend gap or a single
 * missing bar cannot stretch the nominal interval.
 */
const SPAN_SAMPLE = 64;

function medianSpan(times: readonly number[]): number {
  const n = times.length;
  if (n < 2) return 0;
  const step = Math.max(1, Math.floor((n - 1) / SPAN_SAMPLE));
  const deltas: number[] = [];
  for (let i = step; i < n; i += step) {
    const d = times[i]! - times[i - step]!;
    if (Number.isFinite(d) && d > 0) deltas.push(d / step);
  }
  if (!deltas.length) return 0;
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)]!;
}

/**
 * Build the axis for a bar window that was (or will be) handed to an engine.
 *
 * @param bars - The evaluated window, oldest → newest (unix seconds)
 * @returns Axis, or null when the window cannot anchor an index
 */
export function windowAxisFromBars(
  bars: readonly { time?: number | null }[] | null | undefined,
): RunWindowAxis | null {
  if (!Array.isArray(bars) || !bars.length) return null;
  const times: number[] = [];
  for (const b of bars) {
    const t = Number(b?.time);
    if (Number.isFinite(t) && t > 0) times.push(t);
  }
  if (!times.length) return null;
  const t0 = times[0]!;
  if (t0 < MIN_T0 || t0 > MAX_T0) return null;
  const count = bars.length;
  const span = medianSpan(times);
  // Uniformity decides whether index → time can be reconstructed exactly.
  let uniform = times.length === count && span > 0;
  if (uniform) {
    for (let i = 1; i < times.length; i++) {
      if (times[i]! - times[i - 1]! !== span) {
        uniform = false;
        break;
      }
    }
  }
  // A single-bar window still anchors index 0 (span unknown → 0).
  return { t0, span: span > 0 ? span : 0, count, uniform: count === 1 ? true : uniform };
}

/**
 * Read a stamped axis back from a run result / `meta` bag.
 *
 * @param meta - `result.meta` (or any object carrying the stamp keys)
 */
export function windowAxisFromMeta(meta: unknown): RunWindowAxis | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const rec = meta as Record<string, unknown>;
  const t0 = Number(rec[WINDOW_AXIS_KEYS.t0]);
  const count = Number(rec[WINDOW_AXIS_KEYS.count]);
  const span = Number(rec[WINDOW_AXIS_KEYS.span]);
  const uniform = rec[WINDOW_AXIS_KEYS.uniform];
  if (!isFiniteNum(t0) || !isFiniteNum(count) || count <= 0) return null;
  if (t0 < MIN_T0 || t0 > MAX_T0) return null;
  return {
    t0,
    count,
    span: isFiniteNum(span) && span > 0 ? span : 0,
    // Older stamps carry no flag: assume uniform only when a span exists.
    uniform: typeof uniform === 'boolean' ? uniform : isFiniteNum(span) && span > 0,
  };
}

/** `meta` fields for {@link windowAxisFromMeta} (spread into a result meta). */
export function axisStamp(
  axis: RunWindowAxis | null | undefined,
): Record<string, number | boolean> {
  if (!axis) return {};
  return {
    [WINDOW_AXIS_KEYS.t0]: axis.t0,
    [WINDOW_AXIS_KEYS.span]: axis.span,
    [WINDOW_AXIS_KEYS.count]: axis.count,
    [WINDOW_AXIS_KEYS.uniform]: axis.uniform,
  };
}

/** Refuse to materialise an axis larger than any chart window we will paint. */
const TIMES_FROM_AXIS_MAX = 100_000;

/**
 * Rebuild the evaluated bar-time list from a uniform window stamp.
 *
 * The engine often ships `windowT0` / `windowSpan` / `windowCount` without
 * `bar_times`. Plot apply still needs those times to join by bar instead of
 * head-padding a short series onto a live chart that grew a few candles —
 * head-padding shifts every overlay value onto newer bars (EMA "slides").
 *
 * Non-uniform windows cannot be reconstructed (`t0 + i·span` would invent
 * times across session gaps) and return null so the caller keeps its
 * index fallback.
 */
export function timesFromWindowAxis(
  axis: RunWindowAxis | null | undefined,
): number[] | null {
  if (!axis || axis.count <= 0) return null;
  const n = Math.floor(axis.count);
  if (!Number.isFinite(n) || n < 1 || n > TIMES_FROM_AXIS_MAX) return null;
  if (n === 1) return [axis.t0];
  if (axis.uniform === false || !(axis.span > 0)) return null;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = axis.t0 + i * axis.span;
  return out;
}

/**
 * Recover the evaluated bar times from a (possibly gappy) window stamp by
 * taking consecutive times off the **chart** axis, never inventing `t0+i·span`.
 *
 * Crypto 1m windows are often non-uniform (a missing minute). Reconstructing
 * from the stamp would return null and apply would head-pad, sliding EMA/SMA
 * onto newer candles. The engine evaluated a contiguous slice of the chart
 * starting at `t0`, so those chart times *are* the axis.
 *
 * When the live window has already dropped `t0`, `span` estimates how many
 * head bars rolled off so the remaining values still land on the remaining
 * times.
 */
export function timesFromWindowOnChart(
  axis: RunWindowAxis | null | undefined,
  chartTimes: readonly number[] | null | undefined,
): number[] | null {
  if (!axis || axis.count <= 0 || !chartTimes?.length) return null;
  const n = Math.floor(axis.count);
  if (!Number.isFinite(n) || n < 1 || n > TIMES_FROM_AXIS_MAX) return null;
  const t0 = axis.t0;
  const first = Number(chartTimes[0]);
  if (!Number.isFinite(first)) return null;

  let i0 = 0;
  while (i0 < chartTimes.length && Number(chartTimes[i0]) < t0) i0++;
  if (i0 >= chartTimes.length) return null;

  if (Number(chartTimes[i0]) !== t0 && t0 < first && axis.span > 0) {
    const dropped = Math.round((first - t0) / axis.span);
    if (!Number.isFinite(dropped) || dropped < 0 || dropped >= n) return null;
    const keep = n - dropped;
    if (keep <= 0) return null;
    const out = chartTimes.slice(0, keep).map(Number).filter(Number.isFinite);
    return out.length ? out : null;
  }

  const end = Math.min(chartTimes.length, i0 + n);
  if (end <= i0) return null;
  const out: number[] = [];
  for (let i = i0; i < end; i++) {
    const t = Number(chartTimes[i]);
    if (Number.isFinite(t)) out.push(t);
  }
  return out.length ? out : null;
}

/**
 * Absolute bar time for an engine `bar_index` in this window.
 *
 * @returns Unix seconds, or null when the index is outside the window or the
 *   window is non-uniform (index → time cannot be reconstructed exactly)
 */
export function timeForBarIndex(
  axis: RunWindowAxis | null | undefined,
  index: unknown,
): number | null {
  if (!axis) return null;
  const i = Number(index);
  if (!Number.isFinite(i) || i < 0 || i >= axis.count) return null;
  if (i === 0) return axis.t0;
  // `uniform` may be absent on a hand-built axis (older callers); a positive
  // span then implies a regular series.
  const uniform = axis.uniform !== false;
  if (axis.span <= 0 || !uniform) return null;
  return axis.t0 + Math.trunc(i) * axis.span;
}

/** Window-relative index for an absolute bar time (nearest bar in the window). */
export function barIndexForTime(
  axis: RunWindowAxis | null | undefined,
  time: unknown,
): number | null {
  if (!axis || axis.span <= 0 || axis.uniform === false) return null;
  const t = Number(time);
  if (!Number.isFinite(t)) return null;
  const raw = Math.round((t - axis.t0) / axis.span);
  if (raw < 0 || raw >= axis.count) return null;
  return raw;
}

/**
 * True when `value` looks like a window-relative bar index rather than a
 * chart timestamp (unix seconds or Pine milliseconds).
 *
 * Small non-negative integers are the only ambiguous shape, so the window
 * count bounds the test: `0 ≤ v < count` is an index, everything else is a
 * clock. Timestamps are ≥ 1e8, far above any realistic window count.
 */
export function looksLikeBarIndex(value: unknown, axis: RunWindowAxis | null | undefined): boolean {
  if (!axis) return false;
  const v = Number(value);
  if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0) return false;
  return v < axis.count;
}
