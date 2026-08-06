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
 * OHLCV series completeness: detect missing ranges between a past date and now.
 *
 * Gaps are open-time windows larger than one interval step (with a small
 * tolerance). Used by the Data Source Manager to validate cached history and
 * drive gap-fill downloads.
 *
 * @module data/bars-gaps
 */

import type { Bar } from '../store/types';

/** One missing range [fromSec, toSec] inclusive (unix seconds, bar open times). */
export interface BarGap {
  /** First missing open time (unix sec). */
  fromSec: number;
  /** Last missing open time (unix sec). */
  toSec: number;
  /** Approximate missing bar count at the given step. */
  missingBars: number;
}

export interface CoverageReport {
  /** Bars inside [fromSec, toSec] after filter. */
  barCount: number;
  oldestSec: number | null;
  newestSec: number | null;
  /** Expected bars if fully dense at interval step (approx). */
  expectedBars: number;
  gaps: BarGap[];
  /** True when no gaps and range endpoints are covered. */
  complete: boolean;
}

/** AXIS interval string → bar step in seconds. */
export function intervalToSec(interval: string): number {
  const m = /^(\d+)([mhdw])$/.exec(String(interval || '').trim());
  if (!m) return 86_400;
  const n = parseInt(m[1]!, 10);
  const mult: Record<string, number> = {
    m: 60,
    h: 3_600,
    d: 86_400,
    w: 604_800,
  };
  return Math.max(1, n * (mult[m[2]!] || 86_400));
}

/**
 * Align a unix-sec timestamp down to the interval grid (floor).
 * Uses UTC open times matching typical venue klines.
 */
export function alignDown(sec: number, stepSec: number): number {
  if (stepSec <= 0) return Math.floor(sec);
  return Math.floor(sec / stepSec) * stepSec;
}

/**
 * Find gaps in a sorted bar series within [fromSec, toSec].
 *
 * Does **not** re-align to epoch grids (venues use their own open phases).
 * A gap is declared when consecutive open times differ by more than
 * `stepSec * gapFactor` (default 1.5 — allows minor jitter, not multi-bar holes).
 * Also reports leading / trailing holes if the series does not cover the ends.
 */
export function findBarGaps(
  bars: readonly Bar[],
  fromSec: number,
  toSec: number,
  interval: string,
  opts?: { gapFactor?: number },
): BarGap[] {
  const step = intervalToSec(interval);
  const gapFactor = opts?.gapFactor ?? 1.5;
  const threshold = step * gapFactor;
  const from = Math.floor(fromSec);
  const to = Math.floor(toSec);
  if (to < from) return [];

  // Bars inside window, sorted unique
  const inWin = bars
    .filter((b) => b && Number.isFinite(b.time) && b.time >= from && b.time <= to)
    .slice()
    .sort((a, b) => a.time - b.time);

  const gaps: BarGap[] = [];

  if (!inWin.length) {
    // Entire range missing
    const missing = Math.max(1, Math.floor((to - from) / step) + 1);
    gaps.push({ fromSec: from, toSec: to, missingBars: missing });
    return gaps;
  }

  const first = inWin[0]!.time;
  const last = inWin[inWin.length - 1]!.time;

  // Leading gap: target start → first bar
  if (first - from > threshold) {
    const gapTo = first - step;
    if (gapTo >= from) {
      gaps.push({
        fromSec: from,
        toSec: gapTo,
        missingBars: Math.max(1, Math.floor((gapTo - from) / step) + 1),
      });
    }
  }

  // Internal gaps
  for (let i = 1; i < inWin.length; i++) {
    const prev = inWin[i - 1]!.time;
    const cur = inWin[i]!.time;
    const delta = cur - prev;
    if (delta > threshold) {
      const gFrom = prev + step;
      const gTo = cur - step;
      if (gTo >= gFrom) {
        gaps.push({
          fromSec: gFrom,
          toSec: gTo,
          missingBars: Math.max(1, Math.floor((gTo - gFrom) / step) + 1),
        });
      }
    }
  }

  // Trailing gap: last bar → target end
  // Allow up to ~1 incomplete current bar at `to` (live candle)
  if (to - last > threshold) {
    const gapFrom = last + step;
    if (gapFrom <= to) {
      gaps.push({
        fromSec: gapFrom,
        toSec: to,
        missingBars: Math.max(1, Math.floor((to - gapFrom) / step) + 1),
      });
    }
  }

  return gaps;
}

/** Full coverage report for a series in a window. */
export function validateBarCoverage(
  bars: readonly Bar[],
  fromSec: number,
  toSec: number,
  interval: string,
  opts?: { gapFactor?: number },
): CoverageReport {
  const step = intervalToSec(interval);
  const from = Math.floor(fromSec);
  const to = Math.floor(toSec);
  const inWin = bars
    .filter((b) => b && Number.isFinite(b.time) && b.time >= from && b.time <= to)
    .slice()
    .sort((a, b) => a.time - b.time);

  const gaps = findBarGaps(bars, from, to, interval, opts);
  const expectedBars = to >= from ? Math.floor((to - from) / step) + 1 : 0;
  // Density floor: gap finder can miss pathological cases; require ~85% of expected
  const denseEnough =
    expectedBars <= 0 || inWin.length >= Math.max(1, Math.floor(expectedBars * 0.85));

  return {
    barCount: inWin.length,
    oldestSec: inWin.length ? inWin[0]!.time : null,
    newestSec: inWin.length ? inWin[inWin.length - 1]!.time : null,
    expectedBars,
    gaps,
    complete: gaps.length === 0 && inWin.length > 0 && denseEnough,
  };
}

/** Merge overlapping / adjacent gaps (after partial fills). */
export function mergeGaps(gaps: BarGap[], stepSec: number): BarGap[] {
  if (!gaps.length) return [];
  const sorted = gaps.slice().sort((a, b) => a.fromSec - b.fromSec);
  const out: BarGap[] = [];
  let cur = { ...sorted[0]! };
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i]!;
    if (g.fromSec <= cur.toSec + stepSec) {
      cur.toSec = Math.max(cur.toSec, g.toSec);
      cur.missingBars = Math.floor((cur.toSec - cur.fromSec) / stepSec) + 1;
    } else {
      out.push(cur);
      cur = { ...g };
    }
  }
  out.push(cur);
  return out;
}
