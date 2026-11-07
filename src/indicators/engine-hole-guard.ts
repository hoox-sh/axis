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
 * Chart guard: never deliver a series computed over a holed engine window.
 *
 * The engine evaluates its own bar window. When that window is missing minutes
 * **in the middle** (its stored series lost a stretch), every plot it returns
 * has a Pine `na` for the chart bars it never saw. Painting that run puts a
 * break — or, worse, a connector — in the user's indicator for data the engine
 * simply did not have.
 *
 * The guard holds the **last good plots** for a bounded window instead
 * ({@link ENGINE_HOLE_HOLD_MS} / {@link ENGINE_HOLE_HOLD_MAX}) while the repair
 * runs, so the chart never shows a hole the engine is already fixing. A hole
 * that outlives the hold is painted with a break (the renderer path), so a
 * permanently unfixable window can never freeze an indicator forever.
 *
 * A *shorter* engine window (a free-tier `windowBars` clamp, a head-padded
 * history) is **not** a hole: only chart bars the axis skipped *between its own
 * first and last bar* count.
 *
 * @module indicators/engine-hole-guard
 */

import { appendLog } from '../store';

/** How long one hole may hold the last good plots (ms). */
export const ENGINE_HOLE_HOLD_MS = 120_000;
/** How many applies one hole may hold before the guard gives up. */
export const ENGINE_HOLE_HOLD_MAX = 4;
/** One warning per script per this window (ms). */
export const ENGINE_HOLE_WARN_MS = 60_000;

type Hold = { firstAt: number; count: number };

const holds = new Map<string, Hold>();
const warnedAt = new Map<string, number>();

/**
 * Chart bar times the engine axis skipped **inside its own span**.
 *
 * Missing head/tail bars are a shorter window (normal, head-padded); only an
 * internal skip means the engine's series is holed.
 *
 * @param chartTimes candle axis (oldest → newest)
 * @param engineTimes the run's own bar axis (ascending), when it shipped one
 * @returns the skipped times that sit between the axis' first and last bar
 */
export function engineHoleTimes(
  chartTimes: readonly number[],
  engineTimes: readonly number[] | null | undefined,
): number[] {
  if (!chartTimes?.length || !engineTimes?.length) return [];
  const first = Number(engineTimes[0]);
  const last = Number(engineTimes[engineTimes.length - 1]);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return [];
  const have = new Set<number>();
  for (const t of engineTimes) {
    const n = Number(t);
    if (Number.isFinite(n)) have.add(n);
  }
  const holes: number[] = [];
  for (const t of chartTimes) {
    const n = Number(t);
    if (!Number.isFinite(n) || n <= first || n >= last) continue;
    if (!have.has(n)) holes.push(n);
  }
  return holes;
}

/**
 * Decide what to do with a run whose engine axis is holed.
 *
 * @param key script id (or the editor key)
 * @param holes internal hole size in bars; `0` clears the guard
 * @param now clock override for tests
 * @returns `hold` (keep the last good plots), `paint` (render with breaks) or
 *   `clear` (no hole — the guard forgot this script)
 */
export function noteEngineHole(
  key: string,
  holes: number,
  now = Date.now(),
): 'hold' | 'paint' | 'clear' {
  const id = key || '__editor__';
  if (!Number.isFinite(holes) || holes <= 0) {
    holds.delete(id);
    return 'clear';
  }
  const prev = holds.get(id);
  if (!prev) {
    holds.set(id, { firstAt: now, count: 1 });
    return 'hold';
  }
  const next: Hold = { firstAt: prev.firstAt, count: prev.count + 1 };
  holds.set(id, next);
  if (next.count > ENGINE_HOLE_HOLD_MAX) return 'paint';
  if (now - next.firstAt > ENGINE_HOLE_HOLD_MS) return 'paint';
  return 'hold';
}

/**
 * Log the hold once per script per {@link ENGINE_HOLE_WARN_MS}.
 *
 * @param key script id (or the editor key)
 * @param holes internal hole size in bars
 * @param now clock override for tests
 * @returns whether this call emitted the line
 */
export function warnEngineHole(key: string, holes: number, now = Date.now()): boolean {
  const id = key || '__editor__';
  const last = warnedAt.get(id) ?? 0;
  if (now - last < ENGINE_HOLE_WARN_MS) return false;
  warnedAt.set(id, now);
  appendLog(
    'warn',
    `Engine series has an internal hole of ${holes} bar(s) — holding the last good plots while it repairs`,
    'engine',
    { toast: false },
  );
  return true;
}

/** @internal test helper — forget every hold/warn entry. */
export function _resetEngineHoleGuardForTests(): void {
  holds.clear();
  warnedAt.clear();
}

/**
 * Chart-guard entry point: should this run be withheld?
 *
 * @param key script id (or the editor key); `undefined` = the editor run
 * @param holeTimes internal hole times from {@link engineHoleTimes}
 * @param now clock override for tests
 * @returns `true` when the caller must keep the last good plots and skip the
 *   apply (the repair has already been triggered by the caller)
 */
export function holdForEngineHole(
  key: string | undefined,
  holeTimes: readonly number[],
  now = Date.now(),
): boolean {
  const id = key ?? '__editor__';
  if (!holeTimes.length) {
    noteEngineHole(id, 0, now);
    return false;
  }
  if (noteEngineHole(id, holeTimes.length, now) !== 'hold') return false;
  warnEngineHole(id, holeTimes.length, now);
  return true;
}
