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
 * Session sparkline for watchlist rows.
 *
 * No extra market request. The line is seeded from the 24h open to the last
 * price, then extended with live prints. Samples inside
 * {@link SPARK_MIN_INTERVAL_MS} update the tip instead of adding a point.
 *
 * @module ui/watchlist-spark
 */

export const SPARK_LIMIT = 24;
export const SPARK_MIN_INTERVAL_MS = 1500;

type SparkSample = { t: number; p: number };

const buffers = new Map<string, SparkSample[]>();

function keyOf(symbol: string): string {
  return String(symbol || '').toUpperCase();
}

function pricesOf(buf: SparkSample[] | undefined): number[] {
  return buf ? buf.map((s) => s.p) : [];
}

export function resetWatchlistSparks(): void {
  buffers.clear();
}

export function sparkSeries(symbol: string): number[] {
  return pricesOf(buffers.get(keyOf(symbol)));
}

/**
 * Two-point slope from the 24h open to last. No-op once any sample exists,
 * so live prints are not rewritten by a later ticker refresh.
 */
export function seedSpark(symbol: string, open: number | undefined, last: number, now = Date.now()): void {
  const key = keyOf(symbol);
  if (!key || buffers.has(key)) return;
  if (!Number.isFinite(last) || last <= 0) return;
  const buf: SparkSample[] = [];
  if (open != null && Number.isFinite(open) && open > 0 && open !== last) {
    buf.push({ t: now - SPARK_MIN_INTERVAL_MS * 2, p: open });
  }
  buf.push({ t: now, p: last });
  buffers.set(key, buf);
}

/** Record a print. Returns the current series (possibly unchanged). */
export function noteSparkPrice(symbol: string, price: number, now = Date.now()): number[] {
  const key = keyOf(symbol);
  if (!key || !Number.isFinite(price) || price <= 0) return sparkSeries(symbol);
  const buf = buffers.get(key) ?? [];
  const last = buf[buf.length - 1];
  if (!last) {
    buf.push({ t: now, p: price });
  } else if (price !== last.p) {
    if (now - last.t < SPARK_MIN_INTERVAL_MS) {
      buf[buf.length - 1] = { t: last.t, p: price };
    } else {
      buf.push({ t: now, p: price });
      if (buf.length > SPARK_LIMIT) buf.splice(0, buf.length - SPARK_LIMIT);
    }
  }
  buffers.set(key, buf);
  return pricesOf(buf);
}

/**
 * SVG path in a width×height box. Y grows downward. A flat series sits on
 * the midline. Empty input returns `''`.
 */
export function sparkPath(values: number[], width: number, height: number, pad = 1): string {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0 || width <= 0 || height <= 0) return '';
  const left = pad;
  const right = Math.max(left, width - pad);
  const top = pad;
  const bottom = Math.max(top, height - pad);
  if (clean.length === 1 || clean.every((v) => v === clean[0])) {
    const y = ((top + bottom) / 2).toFixed(2);
    return `M ${left.toFixed(2)} ${y} L ${right.toFixed(2)} ${y}`;
  }
  let min = Infinity;
  let max = -Infinity;
  for (const v of clean) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min;
  const innerH = bottom - top;
  return clean
    .map((v, i) => {
      const x = left + (i / (clean.length - 1)) * (right - left);
      const y = top + (1 - (v - min) / span) * innerH;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}
