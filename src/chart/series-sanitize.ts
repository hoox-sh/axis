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
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Boundary guard for Lightweight Charts `setData` payloads.
 *
 * Exchange OHLC is clean ~99.9% of the time, so this does **not** repair,
 * clamp, or fill anything. It only drops rows that LWC cannot render:
 * - non-finite or missing open time
 * - non-finite OHLC (no donor fill — copying a neighbor's OHLC onto a
 *   different candle collapses its values)
 * - duplicate open times (last write wins)
 *
 * @module chart/series-sanitize
 */

/** True when the payload looks like OHLC rows rather than `{time,value}`. */
export function looksLikeOhlcData(data: readonly unknown[]): boolean {
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    return 'open' in r || 'high' in r || 'low' in r || 'close' in r;
  }
  return false;
}

/** Time range of the last successfully painted candle series. */
export interface PaintedCandleRange {
  first: number;
  last: number;
}

/** Legacy module-global fallback for callers without a chart instance. */
let paintedCandleRange: PaintedCandleRange | null = null;

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

/** Grow a painted range to cover a live appended bar without a full repaint. */
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

/**
 * Drop points outside the last painted candle range (both ends).
 */
export function clampPointsToPaintedRange<T extends { time?: unknown }>(
  points: readonly T[],
  range?: PaintedCandleRange | null,
  allowedTimes?: ReadonlySet<number> | null,
): T[] {
  const active = range === undefined ? paintedCandleRange : range;
  if (!active || points.length === 0) return [...points];
  const { first, last } = active;
  let out: T[] | null = null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const t = p == null ? undefined : (p as { time?: unknown }).time;
    const inRange = typeof t === 'number' && Number.isFinite(t) && t >= first && t <= last;
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
 */
export function projectToCandleAxis<T extends { time?: unknown }>(
  rows: readonly T[],
  candleTimes: readonly number[] | null | undefined,
  blank: (time: number) => T,
): T[] {
  if (!candleTimes || !candleTimes.length) return rows as T[];
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

/**
 * Drop rows LWC cannot render before `setData`. No clamping, no donor fill,
 * no repair — bad rows are simply removed.
 * - Non-finite or missing time
 * - Non-finite OHLC (open/high/low/close)
 * - Duplicate open times (last write wins)
 */
export function filterValidCandleRows<
  T extends { time?: number; open?: number; high?: number; low?: number; close?: number },
>(rows: readonly T[]): T[] {
  const out: T[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const t = r.time;
    if (typeof t !== 'number' || !Number.isFinite(t)) continue;
    if (
      !Number.isFinite(r.open as number) ||
      !Number.isFinite(r.high as number) ||
      !Number.isFinite(r.low as number) ||
      !Number.isFinite(r.close as number)
    ) {
      continue;
    }
    if (seen.has(t)) {
      // Last write wins for duplicate times
      const idx = out.findIndex((x) => x != null && x.time === t);
      if (idx >= 0) out[idx] = r;
      continue;
    }
    seen.add(t);
    out.push(r);
  }
  return out;
}
