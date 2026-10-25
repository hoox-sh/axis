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
 * Synchronous live-tick chart apply (concept §6.1).
 *
 * Stream deltas already carry `precomputedResult`. This path paints plots,
 * markers, and drawings without `runAndApply` so the live wire never
 * `await`s between price and plots. Snapshots stay on the async runner.
 *
 * Does not import `runner` (that module imports the apply stages).
 *
 * @module indicators/apply-live
 */

import { notifyPineAlertsFromRun } from '../alerts/pine-bridge';
import { applyDebugPinsToChart, getManager } from '../chart/manager-access';
import { noteChartSeriesHole, noteEngineAxisBehindChart } from '../engines/series-repair';
import { appendLog, EDITOR_RUN_KEY, setLastRun, setStatus, store } from '../store';
import type { Bar } from '../store/types';
import { reportUiError } from '../ui/boot-errors';
import { alignApplySeries } from './apply-context';
import { appliedScriptStillOnChart, applyDrawings } from './apply-drawings';
import { applyPlotsAndMarkers } from './apply-mutations';
import { buildOverlayPayloads, type OverlayLine, type OverlayOhlc } from './apply-overlays';
import { ensureApplyPane } from './apply-pane';
import { updateIndicatorStore } from './apply-store';
import { beginRunEpoch, formatRunError, isRunEpochCurrent } from './run-helpers';
import type { RunOptions, RunResult } from './runner';

export type ApplyLiveOpts = {
  silent?: boolean;
  liveTick?: boolean;
};

function withAxisSource(result: RunResult, script: string): RunResult {
  return {
    ...result,
    meta: { ...result.meta, axisSource: script },
  };
}

/**
 * Paint a precomputed live result onto the chart. Synchronous.
 * Hidden scripts skip overlay teardown on this path (no `await`).
 */
export function applyPrecomputedChart(
  script: string,
  indicatorId: string | undefined,
  raw: RunResult,
  bars: Bar[],
  opts: ApplyLiveOpts = {},
): RunResult {
  const silent = opts.silent !== false;
  const liveTick = opts.liveTick !== false;
  const epoch = beginRunEpoch();
  const runOpts: RunOptions = {
    silent,
    liveTick,
    bars,
    precomputedResult: raw,
    openResults: false,
  };
  const result = raw;

  if (!isRunEpochCurrent(epoch)) {
    return { ...result, meta: { ...result.meta, superseded: true } };
  }

  setLastRun(withAxisSource(result, script), {
    scriptId: indicatorId ?? EDITOR_RUN_KEY,
    focus: !silent,
    persistence: silent || liveTick ? 'skip' : 'auto',
  });
  if (result.status === 'error') return result;

  if (indicatorId && !appliedScriptStillOnChart(indicatorId)) {
    return { ...result, meta: { ...result.meta, skipped: 'hidden' } };
  }

  try {
    const last = bars.length ? bars[bars.length - 1] : undefined;
    const lastClose = last && Number.isFinite(Number(last.close)) ? Number(last.close) : undefined;
    notifyPineAlertsFromRun(result, {
      indicatorId: indicatorId ?? EDITOR_RUN_KEY,
      lastBarIndex: bars.length ? bars.length - 1 : undefined,
      price: lastClose,
      symbol: store.symbol,
    });
  } catch {
    /* Pine alerts must not break chart apply */
  }

  const manager = getManager();
  if (!manager) return result;

  if (!isRunEpochCurrent(epoch)) {
    return { ...result, meta: { ...result.meta, superseded: true } };
  }

  const existing = indicatorId ? store.scripts.find((s) => s.id === indicatorId) : undefined;
  const {
    ohlcvTimes,
    plotMeta,
    seriesMap,
    split,
    scriptName,
    scriptType,
    overlay,
    needsAlign,
    resultTimes,
    chartWindowBars,
    staleNoAxis,
  } = alignApplySeries(script, result, bars, {
    silent,
    existingName: existing?.name,
    livePush: liveTick,
  });
  if (staleNoAxis) {
    return { ...result, meta: { ...result.meta, skipped: 'stale-no-axis' } };
  }
  if (resultTimes && resultTimes.length > 1) {
    noteChartSeriesHole(resultTimes, bars);
    const engineLast = resultTimes[resultTimes.length - 1];
    const chartLast = ohlcvTimes.length ? ohlcvTimes[ohlcvTimes.length - 1] : null;
    if (
      liveTick &&
      typeof engineLast === 'number' &&
      typeof chartLast === 'number' &&
      chartLast > engineLast
    ) {
      noteEngineAxisBehindChart(engineLast, chartLast);
    }
  }
  const seriesEntries = split.lines.map((e) => [e.key, e.values] as const);

  const paneId = ensureApplyPane({
    overlay,
    existing,
    indicatorId,
    scriptName,
    manager,
    storePanes: store.panes,
    storeScripts: store.scripts,
  });

  const userPlotColors = existing?.plots || {};
  const overlayBuilt = buildOverlayPayloads({
    epoch,
    silent,
    result,
    seriesEntries,
    split,
    plotMeta,
    ohlcvTimes,
    needsAlign,
    resultTimes,
    chartWindowBars,
    seriesMap,
    userPlotColors,
    scriptName,
  });
  if ('superseded' in overlayBuilt && overlayBuilt.superseded) {
    return { ...result, meta: { ...result.meta, superseded: true } };
  }
  if (!isRunEpochCurrent(epoch)) {
    return { ...result, meta: { ...result.meta, superseded: true } };
  }
  const { overlayLines, overlayOhlc } = overlayBuilt as {
    overlayLines: OverlayLine[];
    overlayOhlc: OverlayOhlc[];
  };

  if (indicatorId && !appliedScriptStillOnChart(indicatorId)) {
    return { ...result, meta: { ...result.meta, skipped: 'hidden' } };
  }

  try {
    if (!isRunEpochCurrent(epoch)) {
      return { ...result, meta: { ...result.meta, superseded: true } };
    }
    if (!manager.getPane(paneId)) {
      if (!silent) {
        appendLog(
          'warn',
          `Chart pane "${paneId}" missing — skipped plot apply (chart disposed?)`,
          'plot',
        );
      }
    } else {
      const painted = applyPlotsAndMarkers({
        mutation: {
          manager,
          paneId,
          overlay,
          overlayLines,
          overlayOhlc,
          split,
          plotMeta,
          seriesMap,
          ohlcvTimes,
          silent,
          indicatorId,
          forceFull: !liveTick,
        },
        strategy: { manager, result, scriptType, silent, indicatorId, bars },
      });
      if (!painted.ok) {
        throw new Error(`Chart apply aborted (${painted.reason})`);
      }
      applyDebugPinsToChart();
    }
  } catch (e: unknown) {
    const msg = formatRunError(e);
    reportUiError(e, {
      source: 'run',
      context: 'Chart apply failed',
      status: !silent,
    });
    if (silent) appendLog('error', `Chart apply failed: ${msg}`, 'live');
    else if (store.status !== 'error') setStatus('error', `Chart apply failed: ${msg}`);
  }

  applyDrawings({ epoch, indicatorId, result, script, bars, overlay, paneId, silent });
  if (
    !updateIndicatorStore({
      epoch,
      result,
      silent,
      indicatorId,
      opts: runOpts,
      script,
      paneId,
      overlay,
      existing,
      overlayLines,
      overlayOhlc,
      split,
      ohlcvTimes,
      seriesMap,
      plotMeta,
      seriesEntries,
      scriptName,
      bars,
    })
  ) {
    return { ...result, meta: { ...result.meta, superseded: true } };
  }

  return result;
}
