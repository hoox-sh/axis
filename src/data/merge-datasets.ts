// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
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

/** Relative OHLC disagreement treated as a conflict (default 1e-6). */
export const DEFAULT_CONFLICT_TOLERANCE = 1e-6;

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
  return Math.abs(a - b) <= tol * scale;
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
      if (!keepCurrent) curByTime.set(b.time, b);
    }
    // Agreement → keep existing (identical values)
  }

  const bars = [...curByTime.values()].sort((a, b) => a.time - b.time);
  return { bars, conflicts, added };
}
