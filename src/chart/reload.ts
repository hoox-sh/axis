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
 * Chart reload policy — one entry point for "the chart must be rebuilt".
 *
 * ## Rule
 *
 * The chart is **reloaded**, not patched, when its identity or its window
 * changes:
 *
 * | Trigger | Reason |
 * | --- | --- |
 * | tab comes back from the background | `wake` |
 * | venue / market / symbol / interval / engine | `topbar:data` |
 * | Settings or StatusBar rolling-window edit | `rolling-window` |
 * | Reload button / palette command | `manual` |
 *
 * A **view-only** change (chart type, compare symbol, theme) repaints from the
 * bars already committed through the existing ChartHost effect. It never
 * refetches and never enters this module.
 *
 * ## Coalescing
 *
 * `visibilitychange` and `focus` fire together when a tab is re-entered, and a
 * user can change two topbar fields in one turn. Requests while a reload is in
 * flight collapse into the latest reason and run once more when it settles.
 * `loadSymbolData` keeps its own generation + abort, so the last request still
 * wins even if two slip through.
 *
 * @module chart/reload
 */

import { chartDebug } from '../debug';

/** Why the chart is being rebuilt. */
export type ChartReloadReason =
  'wake' | 'topbar:data' | 'topbar:view' | 'rolling-window' | 'manual' | 'reconnect';

let inFlight: Promise<boolean> | null = null;
let queued: ChartReloadReason | null = null;
let lastReason: ChartReloadReason | null = null;
let reloads = 0;

type ReloadRunner = (reason: ChartReloadReason) => Promise<boolean>;

async function defaultRunner(_reason: ChartReloadReason): Promise<boolean> {
  const { reloadChart } = await import('../data/load-symbol');
  return reloadChart();
}

let runner: ReloadRunner = defaultRunner;

/** @internal test hook — replace the network reload with a fake runner. */
export function _setChartReloadRunnerForTests(fn: ReloadRunner | null): void {
  runner = fn ?? defaultRunner;
}

/** @internal test hook — reload counter for assertions. */
export function _chartReloadCountForTests(): number {
  return reloads;
}

/** @internal test hook — last reason passed to {@link requestChartReload}. */
export function _lastChartReloadReasonForTests(): ChartReloadReason | null {
  return lastReason;
}

/** @internal test hook — clear coalescing state between tests. */
export function _resetChartReloadForTests(): void {
  inFlight = null;
  queued = null;
  lastReason = null;
  reloads = 0;
}

/**
 * Refetch and rebuild the chart. The only caller-facing reload API.
 *
 * Returns `true` when the rebuild painted, `false` when it was skipped or
 * failed. Never throws: a failed reload leaves the previous chart on screen
 * and the readiness banner carries the error.
 */
export function requestChartReload(reason: ChartReloadReason): Promise<boolean> {
  lastReason = reason;
  if (inFlight) {
    // A newer reason supersedes the queued one; the running reload still
    // finishes (load-symbol aborts it only for a newer generation).
    queued = reason;
    return inFlight;
  }
  inFlight = runReload(reason).finally(() => {
    inFlight = null;
    const next = queued;
    queued = null;
    if (next) void requestChartReload(next);
  });
  return inFlight;
}

async function runReload(reason: ChartReloadReason): Promise<boolean> {
  reloads += 1;
  chartDebug('chart.reload', { reason, n: reloads });
  try {
    return await runner(reason);
  } catch {
    return false;
  }
}
