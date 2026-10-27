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

import { chartDebug } from '../debug';

/**
 * Boundary guard for Lightweight Charts `setData` payloads.
 *
 * LWC 5.2 asserts **asynchronously**, during the render pass rather than at
 * `setData` time: its candlestick style getter calls
 * `ensureNotNull(valueAt(barIndex))` and throws `Value is null` /
 * `Value is undefined` when a stored row is missing OHLC, when two rows share
 * an open time, or when an OHLC field is null. That throw lands in a rAF
 * callback, so it escapes every `try { series.setData() } catch` in the app and
 * surfaces as a raw uncaught window error on every redraw.
 *
 * Dropping bad rows is therefore not enough — a dropped row still leaves the
 * series shorter than the time axis the overlay mapper walks. This guard
 * **repairs** the payload instead:
 * - duplicate / non-ascending open times: keep the **last** write for that
 *   stamp (matches DatasetStore conflict resolution) and re-sort, instead of
 *   dropping history;
 * - missing / null / non-finite OHLC: fall back to the nearest valid bar
 *   (previous, else next) so a candle is never half-blank;
 * - value rows: `null` becomes `0` (LWC rejects null); an omitted `value` is
 *   left alone because that is how AXIS encodes a Pine `na` whitespace gap.
 *
 * Rows that still cannot be repaired are dropped, and the caller reports any
 * non-zero repair count so repeat offenders stay visible instead of showing up
 * as a bare library assertion.
 *
 * Leaf module: imported by both `chart/manager-access` and `chart/pane-manager`
 * (no import cycle).
 *
 * @module chart/series-sanitize
 */

export interface SeriesSanitizeResult<T> {
  clean: T[];
  /** Rows that could not be repaired and were removed. */
  dropped: number;
  /** Duplicate open times collapsed (last write wins). */
  merged: number;
  /** Rows whose missing values were filled from a neighbour. */
  filled: number;
  firstBadIndex: number;
  firstBadReason: string;
  nonIntegerTimes: number;
}

/** True when the payload looks like OHLC rows rather than `{time,value}`. */
export function looksLikeOhlcData(data: readonly unknown[]): boolean {
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    return 'open' in r || 'high' in r || 'low' in r || 'close' in r;
  }
  return false;
}

/**
 * Time range of the last successfully painted candle series.
 *
 * Every overlay / equity / volume payload shares the chart's single time
 * scale with the candles. When a payload carries times outside the candle
 * range — a stale overlay window after the candles repainted with a slid
 * engine window is the classic case — LWC's renderer asks the candle PlotList
 * for an index it does not hold and throws `Value is null` on every paint.
 * Clamping co-painted payloads to this range keeps the shared scale covered.
 *
 * Scoping: the range is stored **per chart** — either passed explicitly to
 * {@link clampPointsToPaintedRange} (preferred; `PaneManager` owns its own
 * range so layout slot B can never inherit slot A's window) or, for legacy
 * callers without a manager, in the module-global below. The global is a
 * fallback only; new code must thread the per-chart range through.
 */
export interface PaintedCandleRange {
  first: number;
  last: number;
}

/**
 * Legacy module-global fallback for callers without a chart instance.
 * Multi-chart unsafe by construction — prefer the per-chart range owned by
 * `PaneManager` (`notePaintedCandleRange` / `extendPaintedCandleRange`).
 */
let paintedCandleRange: PaintedCandleRange | null = null;

/** Record a successful candle paint (call after `setData` returns). */
export function notePaintedCandleRange(first: number, last: number): void {
  if (Number.isFinite(first) && Number.isFinite(last) && last >= first) {
    paintedCandleRange = { first, last };
  }
}

/**
 * Grow a painted range to cover a live appended bar without a full repaint.
 * Pure — returns the (possibly new) range; never creates one from `null` so
 * live ticks cannot arm the clamp before the first full paint.
 */
export function extendPaintedRange(
  range: PaintedCandleRange | null,
  time: unknown,
): PaintedCandleRange | null {
  if (typeof time !== 'number' || !Number.isFinite(time)) return range;
  if (!range) return null;
  if (time < range.first) return { first: time, last: range.last };
  if (time > range.last) return { first: range.first, last: time };
  return range;
}

/** Test helper — forget the painted range so clamping is a no-op again. */
export function resetPaintedCandleRangeForTests(): void {
  paintedCandleRange = null;
}

/**
 * Drop points outside the last painted candle range (both ends).
 *
 * @param range - This chart's painted range. `undefined` falls back to the
 *   legacy module-global (legacy callers); explicit `null` means "no range
 *   recorded for this chart" and is always a no-op — even when another chart
 *   has painted. No-op as well for payloads already inside the range.
 *   Order-preserving; whitespace `{ time }` rows are kept when their time is
 *   in range. Points outside the candle range cannot render against this chart
 *   anyway — they only extend the shared time scale past the candles, which is
 *   what trips LWC's `Value is null` assertion.
 */
export function clampPointsToPaintedRange<T extends { time?: unknown }>(
  points: readonly T[],
  range?: PaintedCandleRange | null,
  allowedTimes?: ReadonlySet<number> | null,
): T[] {
  const active = range === undefined ? paintedCandleRange : range;
  if (!active || points.length === 0) return [...points];
  const { first, last } = active;
  // Copy-on-write: the common case is "nothing is out of range", and the
  // payload is copied on every overlay apply — an unconditional clone costs
  // one array allocation per plot per tick.
  let out: T[] | null = null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const t = p == null ? undefined : (p as { time?: unknown }).time;
    const inRange = typeof t === 'number' && Number.isFinite(t) && t >= first && t <= last;
    // The candle series can have **holes** (a missing slot the venue never
    // delivered). A co-painted row at such a slot is a time the candles do
    // not hold: the shared time scale is the union of every series' rows, so
    // the candlestick painter throws `Value is null` on every render. The
    // allowed-time set drops exactly those rows.
    const allowed = !allowedTimes || (typeof t === 'number' && allowedTimes.has(t));
    if (inRange && allowed) {
      out?.push(p);
      continue;
    }
    if (!out) {
      out = points.slice(0, i) as T[];
    }
  }
  return out ?? (points as T[]);
}

/**
 * Project co-painted rows onto the candle axis.
 *
 * The library's shared time scale is the union of every series' rows, and
 * every renderer asks **its own** series for the bar at the rendered index.
 * A co-painted series must therefore carry exactly the candles' times:
 *
 * - a row at a time the candles do not have (a venue hole the candles
 *   dropped, a stale window) extends the shared time scale past the
 *   candles → the candlestick painter cannot find that bar and throws
 *   `Value is null`,
 * - a candle time the series does not have leaves the series' own renderer
 *   without a bar at that index.
 *
 * The projection keeps the script's value where the row's time is a candle
 * time and emits a whitespace row (Pine `na`) for every candle time the
 * script had no value for. Rows outside the axis are dropped.
 *
 * `candleTimes` `null` → the rows pass through unchanged (no axis yet).
 */
export function projectToCandleAxis<T extends { time?: unknown }>(
  rows: readonly T[],
  candleTimes: readonly number[] | null | undefined,
  blank: (time: number) => T,
): T[] {
  if (!candleTimes || !candleTimes.length) return rows as T[];
  // Fast path: the rows already sit on the axis, in order — the common case
  // after a time-join. No copy, no map (this runs per plot per apply).
  if (rows.length === candleTimes.length) {
    let onAxis = true;
    for (let i = 0; i < rows.length; i++) {
      const t = Number(rows[i] == null ? undefined : rows[i].time);
      if (!Number.isFinite(t) || t !== candleTimes[i]) {
        onAxis = false;
        break;
      }
    }
    if (onAxis) return rows as T[];
  }
  const byTime = new Map<number, T>();
  for (const r of rows) {
    const t = Number(r == null ? undefined : r.time);
    if (!Number.isFinite(t)) continue;
    if (!byTime.has(t)) byTime.set(t, r);
  }
  const out: T[] = new Array(candleTimes.length);
  for (let i = 0; i < candleTimes.length; i++) {
    const t = candleTimes[i]!;
    const hit = byTime.get(t);
    out[i] = hit ?? blank(t);
  }
  return out;
}

/**
 * Derive a clamp window from a series' own rows (first/last finite time).
 *
 * Used as the **pre-paint fallback**: an engine/indicator overlay can apply
 * before the debounced history paint has recorded a range, and a `null` range
 * makes {@link clampPointsToPaintedRange} a silent no-op — so a wider overlay
 * window can extend the shared time scale past the candles, which is what trips
 * LWC's `Value is null` assert on later paints. Reading the extent the candle
 * series already holds closes that hole. Returns `null` when the rows carry no
 * usable time, preserving the old no-op behaviour for an empty chart.
 */
export function rangeFromSeriesData(
  rows: readonly { time?: unknown }[],
): PaintedCandleRange | null {
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const t = row == null ? undefined : row.time;
    if (typeof t !== 'number' || !Number.isFinite(t)) continue;
    if (t < first) first = t;
    if (t > last) last = t;
  }
  return Number.isFinite(first) && Number.isFinite(last) && last >= first ? { first, last } : null;
}

/** Nearest row with finite OHLC (previous bar first, then next). */
function findOhlcDonor(
  rows: readonly unknown[],
  index: number,
): { open: number; high: number; low: number; close: number } | null {
  const usable = (row: unknown) => {
    const r = row as Record<string, unknown> | null;
    if (!r) return null;
    if (
      Number.isFinite(r.open as number) &&
      Number.isFinite(r.high as number) &&
      Number.isFinite(r.low as number) &&
      Number.isFinite(r.close as number)
    ) {
      return {
        open: r.open as number,
        high: r.high as number,
        low: r.low as number,
        close: r.close as number,
      };
    }
    return null;
  };
  for (let i = index - 1; i >= 0; i--) {
    const hit = usable(rows[i]);
    if (hit) {
      chartDebug('findOhlcDonor', { verdict: 'found-prev', index, donorIndex: i, ohlc: hit });
      return hit;
    }
  }
  for (let i = index + 1; i < rows.length; i++) {
    const hit = usable(rows[i]);
    if (hit) {
      chartDebug('findOhlcDonor', { verdict: 'found-next', index, donorIndex: i, ohlc: hit });
      return hit;
    }
  }
  chartDebug('findOhlcDonor', { verdict: 'none', index });
  return null;
}

/**
 * Repair + validate a series payload before it reaches `setData`.
 *
 * Mutates rows in place only to fill missing values; returns the accepted
 * rows in ascending time order.
 */
export function sanitizeSeriesDataForSetData<T extends { time?: unknown }>(
  data: readonly T[],
  opts?: { requireOhlc?: boolean },
): SeriesSanitizeResult<T> {
  const requireOhlc = opts?.requireOhlc === true;
  const out: T[] = [];
  /** Index in `out` of each accepted time — last write wins. */
  const byTime = new Map<number, number>();
  let dropped = 0;
  let merged = 0;
  let filled = 0;
  /** Value-row fixes applied during the intake pass (counted once). */
  let valueFixes = 0;
  let firstBadIndex = -1;
  let firstBadReason = '';
  let nonIntegerTimes = 0;

  chartDebug('sanitizeSeriesDataForSetData', {
    verdict: 'start',
    requireOhlc,
    inputLen: data.length,
    firstRow: data.length ? data[0] : undefined,
    lastRow: data.length ? data[data.length - 1] : undefined,
  });

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const t = row == null ? undefined : (row as { time?: unknown }).time;
    if (typeof t !== 'number' || !Number.isFinite(t)) {
      dropped++;
      if (firstBadIndex < 0) {
        firstBadIndex = i;
        firstBadReason = `bad-time:${String(t)}`;
      }
      continue;
    }
    if (!Number.isInteger(t)) nonIntegerTimes++;
    if (requireOhlc) {
      const o = row as unknown as Record<string, unknown>;
      if (
        !Number.isFinite(o.open as number) ||
        !Number.isFinite(o.high as number) ||
        !Number.isFinite(o.low as number) ||
        !Number.isFinite(o.close as number)
      ) {
        // Deferred: the fill pass repairs it from a neighbour when possible.
        if (firstBadIndex < 0) {
          firstBadIndex = i;
          firstBadReason = 'bad-ohlc';
        }
      }
    } else {
      const r = row as unknown as Record<string, unknown>;
      // `null` reaches LWC as-is and trips its null assertion — coerce it to
      // 0. A **non-finite number** is a Pine `na` the engine could not
      // serialize: it must become whitespace (an omitted `value`), not a
      // numeric 0 — a zero draws a line at the axis, a `na` is a gap.
      if (r.value === null) {
        r.value = 0;
        valueFixes++;
      } else if (r.value !== undefined && !Number.isFinite(r.value as number)) {
        delete r.value;
        valueFixes++;
      }
    }
    const existing = byTime.get(t);
    if (existing !== undefined) {
      out[existing] = row;
      merged++;
      continue;
    }
    byTime.set(t, out.length);
    out.push(row);
  }

  // A poisoned leading row can leave the series out of order after dedupe.
  if (out.length > 1) {
    for (let i = 1; i < out.length; i++) {
      if ((out[i] as { time: number }).time < (out[i - 1] as { time: number }).time) {
        out.sort((a, b) => (a as { time: number }).time - (b as { time: number }).time);
        break;
      }
    }
  }

  if (requireOhlc) {
    // Fill missing OHLC fields from the nearest valid neighbour (previous preferred).
    // Only fields that are actually non-finite are repaired — valid fields are
    // preserved. Replacing all four values from a single donor could make
    // multiple bars identical (collapse to lines).
    for (let i = 0; i < out.length; i++) {
      const row = out[i] as unknown as Record<string, unknown>;
      const open = row.open as number;
      const high = row.high as number;
      const low = row.low as number;
      const close = row.close as number;
      if (
        Number.isFinite(open) &&
        Number.isFinite(high) &&
        Number.isFinite(low) &&
        Number.isFinite(close)
      ) {
        continue;
      }
      const donor = findOhlcDonor(out, i);
      if (!donor) {
        dropped++;
        out.splice(i, 1);
        i--;
        continue;
      }
      const repaired: string[] = [];
      if (!Number.isFinite(open)) {
        row.open = donor.open;
        repaired.push('open');
      }
      if (!Number.isFinite(high)) {
        row.high = donor.high;
        repaired.push('high');
      }
      if (!Number.isFinite(low)) {
        row.low = donor.low;
        repaired.push('low');
      }
      if (!Number.isFinite(close)) {
        row.close = donor.close;
        repaired.push('close');
      }
      filled++;
      chartDebug('sanitizeSeriesDataForSetData', {
        verdict: 'filled-fields-from-donor',
        rowIndex: i,
        repaired,
        donorOhlc: { open: donor.open, high: donor.high, low: donor.low, close: donor.close },
      });
    }
  } else {
    // Intake already coerced null/NaN to 0 — report those fixes once.
    filled += valueFixes;
  }

  chartDebug('sanitizeSeriesDataForSetData', {
    verdict: 'done',
    requireOhlc,
    inputLen: data.length,
    outputLen: out.length,
    dropped,
    merged,
    filled,
    firstBadIndex,
    firstBadReason,
    nonIntegerTimes,
    firstRow: out.length ? out[0] : undefined,
    lastRow: out.length ? out[out.length - 1] : undefined,
  });

  return { clean: out, dropped, merged, filled, firstBadIndex, firstBadReason, nonIntegerTimes };
}
