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
 * Wire frames for the shared market feed (`/api/feed`).
 *
 * Shapes match `src/engine/feed-client.ts` on the PWA side:
 * - `{ kind: 'snapshot', feed, seq, from, to, bars }`
 * - `{ kind: 'delta', feed, seq, forming, upTo, times, open, high, low, close, volume }`
 *
 * Pure builders — no I/O. `seq` is owned by the caller (the Durable Object):
 * it starts at 1 on first emission and increases by exactly 1 per message;
 * snapshots and deltas share the same counter.
 *
 * @module worker/feed/frames
 */

/** One OHLCV bar. `time` is unix seconds. */
export interface FeedBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** True once the venue has closed the kline. */
  closed: boolean;
}

/** Parallel-array delta payload (matches the PWA `FeedDelta` shape). */
export interface FeedDeltaArrays {
  times: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

function finite(value: number, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`feed frame: non-finite ${what}`);
  }
  return value;
}

function sanitizeBar(bar: FeedBar): FeedBar {
  return {
    time: Math.floor(finite(bar.time, 'bar.time')),
    open: finite(bar.open, 'bar.open'),
    high: finite(bar.high, 'bar.high'),
    low: finite(bar.low, 'bar.low'),
    close: finite(bar.close, 'bar.close'),
    volume: finite(bar.volume, 'bar.volume'),
    closed: bar.closed === true,
  };
}

/**
 * Build a `snapshot` frame. Bars are passed through with their own `closed`
 * flags (the tip keeps whatever the upstream said); every bar keeps `closed`.
 */
export function buildSnapshotFrame(feed: string, seq: number, bars: readonly FeedBar[]): string {
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error('feed frame: snapshot seq must be an integer >= 1');
  }
  const clean = bars.map(sanitizeBar);
  if (clean.length === 0) {
    throw new Error('feed frame: snapshot requires at least one bar');
  }
  const first = clean[0] as FeedBar;
  const last = clean[clean.length - 1] as FeedBar;
  return JSON.stringify({
    kind: 'snapshot',
    feed,
    seq,
    from: first.time,
    to: last.time,
    bars: clean,
  });
}

/** Build a `delta` frame from parallel arrays. */
export function buildDeltaFrame(
  feed: string,
  seq: number,
  forming: boolean,
  upTo: number,
  arrays: FeedDeltaArrays,
): string {
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error('feed frame: delta seq must be an integer >= 1');
  }
  const n = arrays.times.length;
  for (const key of ['open', 'high', 'low', 'close', 'volume'] as const) {
    if (arrays[key].length !== n) {
      throw new Error(`feed frame: delta array length mismatch on ${key}`);
    }
  }
  const times = arrays.times.map((t) => Math.floor(finite(t, 'times[]')));
  return JSON.stringify({
    kind: 'delta',
    feed,
    seq,
    forming: forming === true,
    upTo: Math.floor(finite(upTo, 'upTo')),
    times,
    open: arrays.open.map((v) => finite(v, 'open[]')),
    high: arrays.high.map((v) => finite(v, 'high[]')),
    low: arrays.low.map((v) => finite(v, 'low[]')),
    close: arrays.close.map((v) => finite(v, 'close[]')),
    volume: arrays.volume.map((v) => finite(v, 'volume[]')),
  });
}

/**
 * Parse Binance REST `klines` rows (`[openTime, open, high, low, close, volume, closeTime, …]`)
 * into bars. Malformed rows are skipped. A bar counts as `closed` when its
 * `closeTime` is at or before `nowMs` (REST returns the in-progress kline as
 * the last row); when `closeTime` is missing it is derived from `intervalMs`.
 * `nowMs` is injectable for tests.
 */
export function barsFromKlines(
  raw: unknown,
  intervalMs: number,
  nowMs: number = Date.now(),
): FeedBar[] {
  if (!Array.isArray(raw)) return [];
  const out: FeedBar[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const openTime = Number(row[0]);
    const open = Number.parseFloat(String(row[1]));
    const high = Number.parseFloat(String(row[2]));
    const low = Number.parseFloat(String(row[3]));
    const close = Number.parseFloat(String(row[4]));
    const volume = Number.parseFloat(String(row[5]));
    if (!Number.isFinite(openTime)) continue;
    if (![open, high, low, close, volume].every(Number.isFinite)) continue;
    const closeTimeRaw = row.length > 6 ? Number(row[6]) : Number.NaN;
    const closeTime = Number.isFinite(closeTimeRaw) ? closeTimeRaw : openTime + intervalMs - 1;
    out.push({
      time: Math.floor(openTime / 1000),
      open,
      high,
      low,
      close,
      volume,
      closed: closeTime <= nowMs,
    });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}
