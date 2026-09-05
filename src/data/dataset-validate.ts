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
 * Dataset validation & repair — pure functions over bar series.
 *
 * Fixes "wrongly added price gaps" in two passes:
 * 1. {@link repairBars} — removes corrupt rows (bad OHLC / non-finite time),
 *    dedupes by open time, sorts, and snaps misaligned timestamps back to the
 *    interval grid (misaligned bars are a common source of phantom gaps).
 * 2. {@link classifyGaps} — splits detected gaps into **fillable** (venue
 *    should have data — chase these) and **legitimate** (closures: weekends
 *    for session venues, declared maintenance windows — never chase these).
 *
 * {@link validateDataset} composes both into a {@link DatasetReport} for the
 * DSM panel. No I/O, no store access — safe for unit tests.
 *
 * @module data/dataset-validate
 */

import type { Bar } from '../store/types';
import { sanitizeBar } from './parse-bars';
import {
  alignDown,
  findBarGaps,
  intervalToSec,
  validateBarCoverage,
  type BarGap,
  type CoverageReport,
} from './bars-gaps';

/** Venue trading calendar class — drives legitimate-gap detection. */
export type VenueClass = '24/7' | 'sessions';

export interface RepairStats {
  /** Bars dropped entirely (corrupt / unsalvageable). */
  removed: number;
  /** Duplicate open times collapsed (first occurrence kept). */
  deduped: number;
  /** Timestamps snapped back to the interval grid. */
  snapped: number;
  /** Bars reordered by the sort pass. */
  reordered: number;
}

export interface RepairResult {
  bars: Bar[];
  stats: RepairStats;
}

/**
 * Repair a raw bar series: sanitize → snap to grid → dedupe → sort.
 * Never throws; always returns a usable (possibly empty) series.
 */
export function repairBars(
  bars: readonly unknown[],
  interval: string,
  opts?: { snapToGrid?: boolean },
): RepairResult {
  const step = intervalToSec(interval);
  const snap = opts?.snapToGrid !== false;
  const stats: RepairStats = { removed: 0, deduped: 0, snapped: 0, reordered: 0 };

  if (!Array.isArray(bars)) return { bars: [], stats };

  // 1. Sanitize — drop corrupt rows (sanitizeBar repairs inverted OHLC itself)
  const clean: Bar[] = [];
  for (const raw of bars) {
    const bar = sanitizeBar(raw);
    if (bar) clean.push(bar);
    else stats.removed += 1;
  }
  if (!clean.length) return { bars: [], stats };

  // 2. Snap misaligned open times back to the interval grid
  if (snap && step > 1) {
    for (const bar of clean) {
      const aligned = alignDown(bar.time, step);
      if (aligned !== bar.time) {
        bar.time = aligned;
        stats.snapped += 1;
      }
    }
  }

  // 3. Sort (stable) + count reorders
  const withIndex = clean.map((bar, i) => ({ bar, i }));
  withIndex.sort((a, b) => a.bar.time - b.bar.time || a.i - b.i);
  const sorted = withIndex.map((x) => x.bar);
  for (let i = 0; i < sorted.length; i++) {
    if (withIndex[i]!.i !== i) {
      stats.reordered += 1;
      break; // one detection is enough for the stat
    }
  }

  // 4. Dedupe by open time — first occurrence wins (newest merges pass later)
  const out: Bar[] = [];
  const seen = new Set<number>();
  for (const bar of sorted) {
    if (seen.has(bar.time)) {
      stats.deduped += 1;
      continue;
    }
    seen.add(bar.time);
    out.push(bar);
  }

  return { bars: out, stats };
}

export interface GapClassification {
  /** Gaps the venue should be able to fill — chase these. */
  fillable: BarGap[];
  /** Closures / maintenance — never chase these. */
  legitimate: BarGap[];
}

export interface ClassifyOpts {
  /** Venue calendar class. Default `'24/7'` (crypto — weekends are fillable). */
  venueClass?: VenueClass;
  /** Declared maintenance / closure windows (inclusive, unix sec). */
  maintenanceWindows?: Array<{ fromSec: number; toSec: number }>;
}

/**
 * True when every missing open time in the gap falls on a Saturday or Sunday
 * (UTC) — a legitimate closure for session venues at daily+ intervals.
 */
function isWeekendGap(gap: BarGap, stepSec: number): boolean {
  if (stepSec < 86_400) return false; // intraday sessions have weekday hours
  for (let t = gap.fromSec; t <= gap.toSec; t += stepSec) {
    const day = new Date(t * 1000).getUTCDay(); // 0=Sun, 6=Sat
    if (day !== 0 && day !== 6) return false;
  }
  return true;
}

/** True when the gap lies fully inside one declared maintenance window. */
function isMaintenanceGap(
  gap: BarGap,
  windows: Array<{ fromSec: number; toSec: number }>,
): boolean {
  return windows.some((w) => gap.fromSec >= w.fromSec && gap.toSec <= w.toSec);
}

/**
 * Split gaps into fillable vs legitimate (weekend / maintenance closures).
 * `24/7` venues (default) treat everything as fillable except declared
 * maintenance windows; `sessions` venues also excuse weekend holes.
 */
export function classifyGaps(
  gaps: readonly BarGap[],
  interval: string,
  opts?: ClassifyOpts,
): GapClassification {
  const step = intervalToSec(interval);
  const venueClass: VenueClass = opts?.venueClass ?? '24/7';
  const windows = opts?.maintenanceWindows ?? [];
  const fillable: BarGap[] = [];
  const legitimate: BarGap[] = [];

  for (const gap of gaps) {
    if (isMaintenanceGap(gap, windows)) {
      legitimate.push(gap);
    } else if (venueClass === 'sessions' && isWeekendGap(gap, step)) {
      legitimate.push(gap);
    } else {
      fillable.push(gap);
    }
  }
  return { fillable, legitimate };
}

/** Full validation report for one dataset (key + series + window). */
export interface DatasetReport {
  /** Bars in window after validation. */
  barCount: number;
  oldestSec: number | null;
  newestSec: number | null;
  expectedBars: number;
  /** Raw gaps found (before classification). */
  gaps: BarGap[];
  fillableGaps: BarGap[];
  legitimateGaps: BarGap[];
  /** Repair stats from the last repair pass over this series. */
  repair?: RepairStats;
  /** True when no fillable gaps remain and density holds. */
  complete: boolean;
  /** Underlying coverage report (density / endpoints). */
  coverage: CoverageReport;
}

export interface ValidateOpts extends ClassifyOpts {
  /** Gap factor forwarded to {@link findBarGaps}. */
  gapFactor?: number;
}

/**
 * Validate a dataset: coverage + gap classification in one report.
 * Pure — no I/O. `complete` is false while any **fillable** gap remains.
 */
export function validateDataset(
  bars: readonly Bar[],
  fromSec: number,
  toSec: number,
  interval: string,
  opts?: ValidateOpts,
): DatasetReport {
  const coverage = validateBarCoverage(bars, fromSec, toSec, interval, {
    gapFactor: opts?.gapFactor,
  });
  const { fillable, legitimate } = classifyGaps(coverage.gaps, interval, opts);
  // Density floor mirrors validateBarCoverage, but legitimate closures
  // (weekends / maintenance) do not count toward expected bars — only
  // fillable gaps do.
  const legitMissing = legitimate.reduce((a, g) => a + g.missingBars, 0);
  const effectiveExpected = Math.max(0, coverage.expectedBars - legitMissing);
  const denseEnough =
    effectiveExpected <= 0 ||
    coverage.barCount >= Math.max(1, Math.floor(effectiveExpected * 0.85));
  return {
    barCount: coverage.barCount,
    oldestSec: coverage.oldestSec,
    newestSec: coverage.newestSec,
    expectedBars: coverage.expectedBars,
    gaps: coverage.gaps,
    fillableGaps: fillable,
    legitimateGaps: legitimate,
    complete: fillable.length === 0 && coverage.barCount > 0 && denseEnough,
    coverage,
  };
}

/** Convenience: find + classify gaps only (no coverage math). */
export function findClassifiedGaps(
  bars: readonly Bar[],
  fromSec: number,
  toSec: number,
  interval: string,
  opts?: ValidateOpts,
): GapClassification {
  const gaps = findBarGaps(bars, fromSec, toSec, interval, { gapFactor: opts?.gapFactor });
  return classifyGaps(gaps, interval, opts);
}
