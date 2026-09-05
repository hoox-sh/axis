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
 * DSM-first orchestrator — cache-first paint + background completion.
 *
 * Load flow (default path for {@link ./load-symbol.loadSymbolData}):
 * 1. **Paint** — read the DatasetStore, repair, paint the chart immediately.
 * 2. **Complete** — validate the dataset, classify gaps, and auto-start a
 *    sliced backfill job (walk-back pagination) for everything fillable.
 * 3. **Progressive paint** — dataset-store change events repaint the chart
 *    (throttled, no viewport reset) as slices land.
 *
 * When the cache is empty the caller falls back to the direct venue fetch and
 * seeds the store. Reload (force) skips the cache paint entirely.
 *
 * @module data/dsm-orchestrator
 */

import type { Bar } from '../store/types';
import { clampHistoryBars, loadBars, setStatus, store } from '../store';
import { getManager, setDataToChart } from '../chart/manager-access';
import {
  getDataset,
  keyFor,
  putDatasetBars,
  subscribeDatasets,
} from './dataset-store';
import { repairBars, validateDataset } from './dataset-validate';
import { intervalToSec } from './bars-gaps';
import { startBackfill } from './data-source-manager';
import { exchangeForSource } from './load-symbol';
import { announce } from '../ui/sr-announce';

/** Throttle window for progressive repaints (ms). */
const REPAINT_THROTTLE_MS = 750;

export interface DatasetFirstResult {
  /** Bars painted from the dataset (0 = nothing cached). */
  painted: number;
  /** True when the initial paint came from the dataset store. */
  fromCache: boolean;
  /** Background backfill job id when completion work was queued. */
  jobId: string | null;
  /** Validation summary for status / DSM panel. */
  gapsFillable: number;
  gapsLegitimate: number;
}

/** Currently streamed dataset key (progressive paint subscription). */
let activeKey: string | null = null;
let unsubscribe: (() => void) | null = null;
let repaintTimer: ReturnType<typeof setTimeout> | null = null;
let repaintPending = false;

function stopStreaming(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (repaintTimer) {
    clearTimeout(repaintTimer);
    repaintTimer = null;
  }
  activeKey = null;
  repaintPending = false;
}

/** Paint bars onto chart + store (full refresh semantics). */
function paintFull(bars: Bar[], sym: string, iv: string, srcId: string): void {
  const exchange = exchangeForSource(srcId);
  loadBars(bars, sym, iv, exchange);
  const manager = getManager();
  if (manager) {
    try {
      setDataToChart(bars, { fit: true });
    } catch (err) {
      console.error('[dsm-orchestrator] setDataToChart failed:', err);
    }
  }
}

/** Throttled progressive repaint — extends the chart without viewport reset. */
function scheduleRepaint(sym: string, iv: string, srcId: string): void {
  if (repaintTimer) {
    repaintPending = true;
    return;
  }
  repaintTimer = setTimeout(() => {
    repaintTimer = null;
    const run = async () => {
      if (!activeKey) return;
      const [srcIdFromKey, symFromKey, ivFromKey] = activeKey.split('|');
      const bars = await getDataset(srcIdFromKey ?? srcId, symFromKey ?? sym, ivFromKey ?? iv);
      if (!bars.length || activeKey !== keyFor(srcId, sym, iv)) return;
      const exchange = exchangeForSource(srcId);
      loadBars(bars, sym, iv, exchange);
      const manager = getManager();
      if (manager) {
        try {
          setDataToChart(bars, {
            fit: false,
            clearScriptState: false,
            clearMarkers: false,
          });
        } catch {
          /* progressive paint is best-effort */
        }
      }
      if (repaintPending) {
        repaintPending = false;
        scheduleRepaint(sym, iv, srcId);
      }
    };
    void run();
  }, REPAINT_THROTTLE_MS);
}

/**
 * Paint the chart from the dataset store (repair pass included) and start
 * streaming progressive updates for this key. Returns the painted bars, or
 * `null` when nothing is cached (caller falls back to the venue fetch).
 */
export async function paintDataset(
  symbol: string,
  interval: string,
  sourceId: string,
): Promise<Bar[] | null> {
  const sym = String(symbol || '').trim();
  const iv = String(interval || store.interval || '1d');
  const srcId = String(sourceId || store.source || '');
  const key = keyFor(srcId, sym, iv);

  stopStreaming();
  const raw = await getDataset(srcId, sym, iv);
  if (!raw.length) return null;

  const { bars } = repairBars(raw, iv);
  if (!bars.length) return null;

  activeKey = key;
  unsubscribe = subscribeDatasets((changedKey) => {
    if (changedKey === activeKey) scheduleRepaint(sym, iv, srcId);
  });

  paintFull(bars, sym, iv, srcId);
  return bars;
}

/**
 * Validate the dataset for [now − historyBars, now] and auto-complete it in
 * the background: sliced backfill job for fillable gaps (existing DSM job
 * engine). Legitimate closures (weekends / maintenance) are never chased.
 *
 * Fire-and-forget; safe to call after every cache-first paint.
 */
export function ensureDatasetComplete(
  symbol: string,
  interval: string,
  sourceId: string,
): DatasetFirstResult {
  const sym = String(symbol || '').trim();
  const iv = String(interval || store.interval || '1d');
  const srcId = String(sourceId || store.source || '');
  const step = intervalToSec(iv);
  const nowSec = Math.floor(Date.now() / 1000);
  const historyBars = Math.max(1, clampHistoryBars(store.historyBars));
  const targetToSec = nowSec;
  const targetFromSec = nowSec - historyBars * step;

  const result: DatasetFirstResult = {
    painted: 0,
    fromCache: true,
    jobId: null,
    gapsFillable: 0,
    gapsLegitimate: 0,
  };

  void (async () => {
    try {
      const raw = await getDataset(srcId, sym, iv);
      if (!raw.length) return;
      const { bars } = repairBars(raw, iv);
      const report = validateDataset(bars, targetFromSec, targetToSec, iv, {
        venueClass: '24/7',
      });
      result.gapsFillable = report.fillableGaps.length;
      result.gapsLegitimate = report.legitimateGaps.length;

      const newestStale =
        report.newestSec == null || targetToSec - report.newestSec > step * 1.5;
      const sparse =
        report.expectedBars > 0 && report.barCount < report.expectedBars * 0.85;

      if (report.fillableGaps.length || newestStale || sparse) {
        // Sliced backfill: the job engine walks back page-by-page (auto-slices)
        // and merges through the DatasetStore → progressive repaints.
        result.jobId = startBackfill({
          sourceId: srcId,
          symbol: sym,
          interval: iv,
          targetFromSec,
          targetToSec,
          applyWhenComplete: false,
        });
        const missing = report.expectedBars - report.barCount;
        // Chart is already painted — background completion must not claim "loading"
        setStatus(
          'ready',
          `DSM completing ${sym} ${iv} — ${missing > 0 ? `${missing} bars` : 'recent bars'} in background`,
        );
      } else {
        setStatus('ready', `Dataset complete · ${report.barCount} bars · ${sym} ${iv}`);
      }
    } catch (err) {
      console.warn('[dsm-orchestrator] ensureDatasetComplete failed', err);
    }
  })();

  return result;
}

/**
 * Seed the dataset store from a successful direct venue fetch (fallback path
 * / Reload). Fire-and-forget merge with conflict resolution.
 */
export function seedDatasetFromBars(
  sourceId: string,
  symbol: string,
  interval: string,
  bars: readonly Bar[],
): void {
  if (!bars?.length) return;
  void putDatasetBars(sourceId, symbol, interval, bars).catch((err) => {
    console.warn('[dsm-orchestrator] seedDatasetFromBars failed', err);
  });
}

/** Announce a cache-first paint for screen readers / status. */
export function announceDatasetPaint(bars: Bar[], sym: string, iv: string): void {
  setStatus('ready', `Loaded ${bars.length} cached bars · ${sym} ${iv} (DSM)`);
  announce(`Loaded ${bars.length} cached bars ${sym} ${iv}`);
}

/** @internal test helper — stop streaming + clear timers. */
export function _resetDsmOrchestratorForTests(): void {
  stopStreaming();
}
