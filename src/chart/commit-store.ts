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
 * Commit-once for chart primitives.
 *
 * ## Rule
 *
 * A plot value, bgcolor, fill band, plotshape, drawing, or barcolor belongs to
 * a **bar time**. Once that bar is no longer the forming tip, its painted value
 * is **sealed**: a later engine run cannot change it, re-index it, re-align it,
 * or drop it. Only the forming tip (`time === chartTip`) is mutable.
 *
 * This is what makes the rest of the chart cheap. Because a sealed value never
 * moves, the engine's `bar_index` can shift with the rolling window without
 * anything on screen sliding, and the apply path never has to re-derive
 * geometry it already painted.
 *
 * ## Deletion
 *
 * One exception, and only one: a script's own `max_lines_count` /
 * `max_labels_count` / `max_boxes_count` garbage collection may **delete** its
 * oldest sealed objects. Deletion is not editing. See `chart/pyne-drawings.ts`
 * and `chart/drawing-layer.ts`.
 *
 * ## Shape
 *
 * The cache is keyed by `owner` (script id) and plot key, then by bar time. It
 * is cleared on a full load (`resetCommitStore` from `loadBars`) because a new
 * symbol / interval / window is a new dataset, not a patch.
 *
 * @module chart/commit-store
 */

import { chartDebug } from '../debug';

/** Last bar time the chart has committed. `0` before the first commit. */
let chartTip = 0;

/** `owner\0key` → (bar time → committed value). Values may be numbers or objects. */
const seriesCache = new Map<string, Map<number, unknown>>();

/** Sealed values a run tried to change (guard telemetry). */
let blockedWrites = 0;

/** @internal guard counter — sealed writes the apply path had to reject. */
export function sealedWriteCount(): number {
  return blockedWrites;
}

/** @internal test hook — clear the cache and counters. */
export function _resetCommitStoreForTests(): void {
  chartTip = 0;
  seriesCache.clear();
  blockedWrites = 0;
}

/** Drop every committed value. Called on a full load / reload. */
export function resetCommitStore(): void {
  chartTip = 0;
  seriesCache.clear();
  blockedWrites = 0;
}

/** The chart's committed tip time (unix seconds), `0` when nothing is committed. */
export function commitTipTime(): number {
  return chartTip;
}

/** True when `time` is behind the tip and therefore immutable. */
export function isSealed(time: number, tip: number = chartTip): boolean {
  return tip > 0 && Number.isFinite(time) && time < tip;
}

/**
 * The tip boundary for one commit. The run's own newest bar opens the mutable
 * slot, and the chart tip can only move forward: a stale run whose window is
 * older than the chart cannot reopen bars the chart already sealed.
 */
export function commitBoundary(runTimes: readonly number[]): number {
  const last = runTimes.length ? Number(runTimes[runTimes.length - 1]) : 0;
  if (Number.isFinite(last) && last > chartTip) chartTip = last;
  return chartTip;
}

/**
 * Merge one series column against its committed values.
 *
 * Sealed times keep the value the chart already painted; the tip and any time
 * never seen before take `values[i]`. Returns a new array aligned to `times`.
 */
export function commitSeriesColumn(
  owner: string,
  key: string,
  times: readonly number[],
  values: readonly unknown[],
  boundary: number,
): unknown[] {
  const cacheKey = `${owner}\u0000${key}`;
  let cache = seriesCache.get(cacheKey);
  if (!cache) {
    cache = new Map();
    seriesCache.set(cacheKey, cache);
  }
  const out = new Array<unknown>(times.length);
  for (let i = 0; i < times.length; i++) {
    const time = Number(times[i]);
    // Keep the value verbatim: a plot column is a number, an OHLC overlay
    // column is an object, and a bgcolor column can be a string. Coercing here
    // would erase every non-numeric plot kind.
    const incoming = values[i] ?? null;
    if (isSealed(time, boundary) && cache.has(time)) {
      const committed = cache.get(time) ?? null;
      // Object values are new instances each run; only count scalar rewrites.
      if (typeof committed !== 'object' && committed !== incoming) blockedWrites += 1;
      out[i] = committed;
      continue;
    }
    out[i] = incoming;
    if (Number.isFinite(time)) cache.set(time, incoming);
  }
  prune(cache, times.length);
  return out;
}

/**
 * Merge every column of a run's series map. One call at the apply boundary
 * makes plots, plotshape, bgcolor, fills, and barcolor all immutable, because
 * every one of them is derived from these columns.
 */
export function commitSeriesMap(
  owner: string,
  seriesMap: Record<string, unknown[] | (number | null)[]>,
  times: readonly number[],
): Record<string, unknown[] | (number | null)[]> {
  const boundary = commitBoundary(times);
  const out: Record<string, unknown[] | (number | null)[]> = {};
  for (const [key, column] of Object.entries(seriesMap)) {
    if (!Array.isArray(column)) {
      out[key] = column;
      continue;
    }
    out[key] = commitSeriesColumn(owner, key, times, column, boundary);
  }
  return out;
}

/**
 * Keep the cache bounded. A sliding window can outlive its oldest times, so
 * drop the oldest entries once the cache is several windows deep.
 */
function prune(cache: Map<number, unknown>, windowSize: number): void {
  const limit = Math.max(2048, windowSize * 4);
  if (cache.size <= limit) return;
  let drop = cache.size - limit;
  for (const key of cache.keys()) {
    if (drop <= 0) break;
    cache.delete(key);
    drop -= 1;
  }
}

/** Debug snapshot for the guard (Settings → Debug / chart debug log). */
export function commitStoreDebug(): {
  tip: number;
  owners: number;
  values: number;
  blocked: number;
} {
  let values = 0;
  for (const cache of seriesCache.values()) values += cache.size;
  chartDebug('commitStore', {
    tip: chartTip,
    owners: seriesCache.size,
    values,
    blocked: blockedWrites,
  });
  return { tip: chartTip, owners: seriesCache.size, values, blocked: blockedWrites };
}
