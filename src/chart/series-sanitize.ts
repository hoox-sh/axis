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
 * Time range of the last successfully painted candle series (module-local).
 *
 * Every overlay / equity / volume payload shares the chart's single time
 * scale with the candles. When a payload carries times outside the candle
 * range — a stale overlay window after the candles repainted with a slid
 * engine window is the classic case — LWC's renderer asks the candle PlotList
 * for an index it does not hold and throws `Value is null` on every paint.
 * Clamping co-painted payloads to this range keeps the shared scale covered.
 */
let paintedCandleRange: { first: number; last: number } | null = null;

/** Record a successful candle paint (call after `setData` returns). */
export function notePaintedCandleRange(first: number, last: number): void {
  if (Number.isFinite(first) && Number.isFinite(last) && last >= first) {
    paintedCandleRange = { first, last };
  }
}

/** Test helper — forget the painted range so clamping is a no-op again. */
export function resetPaintedCandleRangeForTests(): void {
  paintedCandleRange = null;
}

/**
 * Drop points outside the last painted candle range (both ends).
 *
 * No-op until the first candle paint, and a no-op for payloads already
 * inside the range. Order-preserving; whitespace `{ time }` rows are kept
 * when their time is in range. Points outside the candle range cannot render
 * against this chart anyway — they only extend the shared time scale past
 * the candles, which is what trips LWC's `Value is null` assertion.
 */
export function clampPointsToPaintedRange<T extends { time?: unknown }>(
  points: readonly T[],
): T[] {
  const range = paintedCandleRange;
  if (!range || points.length === 0) return [...points];
  const { first, last } = range;
  const out: T[] = [];
  for (const p of points) {
    const t = p == null ? undefined : (p as { time?: unknown }).time;
    if (typeof t !== 'number' || !Number.isFinite(t)) continue;
    if (t < first || t > last) continue;
    out.push(p);
  }
  return out;
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
    if (hit) return hit;
  }
  for (let i = index + 1; i < rows.length; i++) {
    const hit = usable(rows[i]);
    if (hit) return hit;
  }
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
      // `null` reaches LWC as-is and trips its null assertion. An omitted
      // `value` is a deliberate Pine `na` whitespace gap — leave it.
      if (r.value === null || (r.value !== undefined && !Number.isFinite(r.value as number))) {
        r.value = 0;
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
    // Fill missing OHLC from the nearest valid neighbour (previous preferred).
    for (let i = 0; i < out.length; i++) {
      const row = out[i] as unknown as Record<string, unknown>;
      if (
        Number.isFinite(row.open as number) &&
        Number.isFinite(row.high as number) &&
        Number.isFinite(row.low as number) &&
        Number.isFinite(row.close as number)
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
      row.open = donor.open;
      row.high = donor.high;
      row.low = donor.low;
      row.close = donor.close;
      filled++;
    }
  } else {
    // Intake already coerced null/NaN to 0 — report those fixes once.
    filled += valueFixes;
  }

  return { clean: out, dropped, merged, filled, firstBadIndex, firstBadReason, nonIntegerTimes };
}
