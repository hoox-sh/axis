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
 * Dataset merge with conflict detection — pure functions.
 *
 * When a dataset is loaded against the current one (cache load, CSV upload,
 * backfill merge), overlapping timestamps whose OHLCV disagree beyond a
 * tolerance are **conflicts**. A resolution policy picks the winner:
 *
 * - `newest-wins` (default) — the incoming (newer) dataset wins conflicts
 * - `keep-current` — the existing series wins
 * - `prefer-incoming` — alias of `newest-wins` (explicit intent)
 *
 * Non-overlapping bars from both sides are always unioned. No I/O.
 *
 * @module data/merge-datasets
 */

import type { Bar } from '../store/types';

export type MergePolicy = 'newest-wins' | 'keep-current' | 'prefer-incoming';

/**
 * Relative OHLC disagreement treated as a conflict (default 1e-6).
 */
export const DEFAULT_CONFLICT_TOLERANCE = 1e-6;

/**
 * Absolute floor for the conflict tolerance.
 *
 * The tolerance is relative to the price scale, so a 0.00001-priced asset was
 * compared at 1e-11 — float noise then reported a conflict on every write.
 */
export const CONFLICT_ABS_FLOOR = 1e-9;

export interface BarConflict {
  time: number;
  current: Bar;
  incoming: Bar;
}

export interface MergeResult {
  /** Union of both series, sorted by time, conflicts resolved by policy. */
  bars: Bar[];
  /** Overlapping timestamps whose OHLCV disagreed beyond tolerance. */
  conflicts: BarConflict[];
  /** Bars only present in the incoming series. */
  added: number;
}

function closeEnough(a: number, b: number, tol: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Math.max(tol * scale, CONFLICT_ABS_FLOOR);
}

/** True when two bars at the same time disagree beyond `tolerance`. */
export function barsConflict(
  a: Bar,
  b: Bar,
  tolerance: number = DEFAULT_CONFLICT_TOLERANCE,
): boolean {
  return !(
    closeEnough(a.open, b.open, tolerance) &&
    closeEnough(a.high, b.high, tolerance) &&
    closeEnough(a.low, b.low, tolerance) &&
    closeEnough(a.close, b.close, tolerance) &&
    closeEnough(a.volume ?? 0, b.volume ?? 0, tolerance)
  );
}

/**
 * Merge `incoming` into `current` with conflict resolution.
 *
 * Both inputs may be unsorted / overlapping; output is sorted + deduped by
 * time. Conflicts (same time, OHLCV differs) are resolved by `policy`:
 * `keep-current` keeps the existing bar, otherwise the incoming bar wins.
 *
 * **Closed candles are immutable.** A bar the venue reported as closed
 * (`closed === true`) is final; a *forming* bar for the same open time must
 * not overwrite it. Without this rule a stale REST page fetched before the
 * bar closed would replace the final candle with a partial one — the chart
 * would visibly regress on every background refresh.
 */
export function mergeWithConflictPolicy(
  current: readonly Bar[],
  incoming: readonly Bar[],
  opts?: { policy?: MergePolicy; tolerance?: number },
): MergeResult {
  const policy: MergePolicy = opts?.policy ?? 'newest-wins';
  const tolerance = opts?.tolerance ?? DEFAULT_CONFLICT_TOLERANCE;
  const keepCurrent = policy === 'keep-current';

  const curByTime = new Map<number, Bar>();
  for (const b of current) {
    if (b && Number.isFinite(b.time)) curByTime.set(b.time, b);
  }

  const conflicts: BarConflict[] = [];
  let added = 0;

  for (const b of incoming) {
    if (!b || !Number.isFinite(b.time)) continue;
    const existing = curByTime.get(b.time);
    if (existing == null) {
      curByTime.set(b.time, b);
      added += 1;
      continue;
    }
    if (barsConflict(existing, b, tolerance)) {
      conflicts.push({ time: b.time, current: existing, incoming: b });
      // A closed candle is final — a forming bar never reopens it.
      const closedWins = existing.closed === true && b.closed !== true;
      if (!keepCurrent && !closedWins) curByTime.set(b.time, b);
    }
    // Agreement → keep existing (identical values)
  }

  const bars = [...curByTime.values()].sort((a, b) => a.time - b.time);
  return { bars, conflicts, added };
}

/**
 * True when a series is strictly ascending by time (no duplicates).
 *
 * The dataset store keeps its series repaired (sorted + unique), so the hot
 * path can use the linear merge below instead of rebuilding a Map and
 * re-sorting the whole series on every page write.
 */
export function isSortedUnique(bars: readonly Bar[]): boolean {
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!;
    const cur = bars[i]!;
    if (!prev || !cur) return false;
    if (!Number.isFinite(cur.time) || cur.time <= prev.time) return false;
  }
  return true;
}

/**
 * Linear merge of two **time-sorted, unique** series.
 *
 * The dataset write hot path: the stored series is already repaired, so the
 * page is merged into it in one pass instead of rebuilding a Map, re-sorting
 * and re-sanitizing the whole series on every page of a backfill.
 *
 * Conflicts (same open time, different OHLCV) are resolved by `policy`; a
 * closed candle is never replaced by a forming one.
 */
export function mergeSortedSeries(
  current: readonly Bar[],
  incoming: readonly Bar[],
  opts?: { policy?: MergePolicy; tolerance?: number },
): { bars: Bar[]; conflicts: BarConflict[]; added: number } {
  const policy: MergePolicy = opts?.policy ?? 'newest-wins';
  const tolerance = opts?.tolerance ?? DEFAULT_CONFLICT_TOLERANCE;
  const keepCurrent = policy === 'keep-current';

  const out: Bar[] = [];
  const conflicts: BarConflict[] = [];
  let added = 0;
  let i = 0;
  let j = 0;

  while (i < current.length && j < incoming.length) {
    const a = current[i]!;
    const b = incoming[j]!;
    if (a.time < b.time) {
      out.push(a);
      i += 1;
      continue;
    }
    if (b.time < a.time) {
      out.push(b);
      j += 1;
      added += 1;
      continue;
    }
    // Same open time
    if (barsConflict(a, b, tolerance)) {
      conflicts.push({ time: a.time, current: a, incoming: b });
      const closedWins = a.closed === true && b.closed !== true;
      out.push(keepCurrent || closedWins ? a : b);
    } else {
      out.push(a);
    }
    i += 1;
    j += 1;
  }
  while (i < current.length) out.push(current[i++]!);
  while (j < incoming.length) {
    out.push(incoming[j++]!);
    added += 1;
  }
  return { bars: out, conflicts, added };
}
