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
 * Merge PYNE session delta envelopes onto the cached full result.
 *
 * Full 10k-bar series per tick is what made engine-owned live mode laggy:
 * with `delta: true` the backend answers tail-only (`delta.base_index`,
 * `delta.count`, `delta.tail_len`) or flags-only for unchanged ticks. This
 * module resolves any tick payload against the cached full payload:
 *
 * - full envelope (no `delta` block) → adopted as the new cache (covers old
 *   backends that ignore the flag and fresh creates);
 * - minimal unchanged update (no `delta`, empty plots/series) → cache reused;
 * - delta update → `cached[:base_index] + tail` per column after count/key
 *   validation, or null when unmergeable (caller recreates / full-runs).
 *
 * Sessions are append-only with in-place tip revises, so `count` is the
 * version counter: `count < cachedCount` or `base_index > cachedCount` means
 * the session rebased and the cache is useless.
 *
 * @module engines/session-delta
 */

export interface SessionDeltaInfo {
  base_index: number;
  count: number;
  tail_len: number;
}

function isFiniteInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.floor(v) === v;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** `delta` block of an update payload, or null when absent/malformed. */
export function readDeltaInfo(payload: unknown): SessionDeltaInfo | null {
  if (!isRecord(payload)) return null;
  const d = payload.delta;
  if (!isRecord(d)) return null;
  const base_index = d.base_index;
  const count = d.count;
  const tail_len = d.tail_len;
  if (!isFiniteInt(base_index) || !isFiniteInt(count) || !isFiniteInt(tail_len)) return null;
  if (base_index < 0 || count < 0 || tail_len <= 0) return null;
  if (tail_len !== count - base_index) return null;
  return { base_index, count, tail_len };
}

function plotsOf(payload: Record<string, unknown>): unknown[] | null {
  const p = payload.plots;
  if (p === undefined) return [];
  return Array.isArray(p) ? p : null;
}

function seriesOf(payload: Record<string, unknown>): Record<string, unknown[]> | null {
  const s = payload.series;
  if (s === undefined) return {};
  if (!isRecord(s)) return null;
  for (const v of Object.values(s)) {
    if (!Array.isArray(v)) return null;
  }
  return s as Record<string, unknown[]>;
}

/**
 * Resolve a tick payload against the cached full payload.
 *
 * @returns the full payload to evaluate/apply (a fresh object; inputs are
 *   never mutated), or null when the update cannot be honored — the caller
 *   must recreate the session / fall back to a full run, never apply partial
 *   data.
 */
export function resolveSessionPayload(
  cached: unknown,
  update: unknown,
): Record<string, unknown> | null {
  if (!isRecord(update)) return null;
  if ('delta' in update) {
    // A delta response must merge or fail — never adopt a tail as a full
    // result (a corrupt block would otherwise paint 2 bars as the window).
    const delta = readDeltaInfo(update);
    if (!delta) return null;
    return mergeDelta(cached, update, delta);
  }
  // No delta block: either a full envelope (adopt it) or a minimal
  // unchanged update (empty plots/series — reuse the cache).
  const upPlots = plotsOf(update);
  const upSeries = seriesOf(update);
  if (upPlots === null || upSeries === null) return null;
  const empty =
    upPlots.length === 0 &&
    Object.keys(upSeries).length === 0 &&
    update.unchanged === true;
  if (empty) {
    return isRecord(cached) ? { ...cached } : null;
  }
  return { ...update };
}

/** Merge a validated delta block onto the cached full payload (or null). */
function mergeDelta(
  cached: unknown,
  update: Record<string, unknown>,
  delta: SessionDeltaInfo,
): Record<string, unknown> | null {
  if (!isRecord(cached)) return null;
  const cachedCount = cached.count;
  if (!isFiniteInt(cachedCount)) return null;
  if (delta.count < cachedCount || delta.base_index > cachedCount) return null;
  const upPlots = plotsOf(update);
  const upSeries = seriesOf(update);
  const cachedPlots = plotsOf(cached);
  const cachedSeries = seriesOf(cached);
  if (upPlots === null || upSeries === null || cachedPlots === null || cachedSeries === null) {
    return null;
  }
  const upKeys = Object.keys(upSeries).sort();
  const cachedKeys = Object.keys(cachedSeries).sort();
  if (upKeys.length !== cachedKeys.length || upKeys.some((k, i) => k !== cachedKeys[i])) {
    return null;
  }
  const mergedPlots = spliceColumn(cachedPlots, upPlots, delta);
  if (mergedPlots === null) return null;
  const mergedSeries: Record<string, unknown[]> = {};
  for (const k of upKeys) {
    const merged = spliceColumn(cachedSeries[k]!, upSeries[k]!, delta);
    if (merged === null) return null;
    mergedSeries[k] = merged;
  }
  // The bar-time axis travels with the tail — splice it the same way, or the
  // merged payload would carry a tail-sized axis for a full window and the
  // apply path would fall back to an index join (displaced plot).
  const cachedTimes = timesOf(cached);
  const upTimes = timesOf(update);
  let mergedTimes: unknown[] | undefined;
  if (cachedTimes !== null || upTimes !== null) {
    if (cachedTimes === null || upTimes === null) return null;
    const spliced = spliceColumn(cachedTimes, upTimes, delta);
    if (spliced === null) return null;
    mergedTimes = spliced;
  }
  const { delta: _drop, ...rest } = update;
  void _drop;
  return {
    ...rest,
    plots: mergedPlots,
    series: mergedSeries,
    count: delta.count,
    ...(mergedTimes ? { times: mergedTimes } : {}),
  };
}

/** Bar-time axis of a payload (top level `times` / `bar_times`), else null. */
function timesOf(payload: unknown): unknown[] | null {
  if (!isRecord(payload)) return null;
  for (const key of ['times', 'bar_times'] as const) {
    const v = payload[key];
    if (Array.isArray(v) && v.length) return v;
  }
  return null;
}

/**
 * Splice a delta tail onto a cached column. Both-empty columns carry no
 * length information (plotless strategies) and stay empty; otherwise the
 * splice must land exactly on `delta.count`.
 */
function spliceColumn(
  full: unknown[],
  tail: unknown[],
  delta: SessionDeltaInfo,
): unknown[] | null {
  if (full.length === 0 && tail.length === 0) return tail;
  if (tail.length !== delta.tail_len) return null;
  const merged = [...full.slice(0, delta.base_index), ...tail];
  return merged.length === delta.count ? merged : null;
}
