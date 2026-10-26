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
 * Forming tips (`meta.executionContext === 'tip'`) reuse the last aligned
 * overlay payloads and skip store / drawings sync when the window tip is
 * unchanged — avoids O(n) time-join + plot-array rebuild on every tick.
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
import type { PlotMetaEntry } from '../results/plot-visuals';
import type { splitSeriesByKind } from '../results/plot-visuals';
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

/** Test seams — production callers omit this. */
export type ApplyLiveDeps = {
  getManager?: typeof getManager;
  noteChartSeriesHole?: typeof noteChartSeriesHole;
  applyDebugPins?: typeof applyDebugPinsToChart;
  setLastRun?: typeof setLastRun;
  applyDrawings?: typeof applyDrawings;
  updateIndicatorStore?: typeof updateIndicatorStore;
  buildOverlayPayloads?: typeof buildOverlayPayloads;
  alignApplySeries?: typeof alignApplySeries;
};

type LiveTipCache = {
  script: string;
  paneId: string;
  overlay: boolean;
  scriptName: string;
  scriptType: string;
  plotMeta: Record<string, PlotMetaEntry>;
  seriesMap: Record<string, unknown[] | (number | null)[]>;
  split: ReturnType<typeof splitSeriesByKind>;
  seriesEntries: ReadonlyArray<readonly [string, unknown[]]>;
  overlayLines: OverlayLine[];
  overlayOhlc: OverlayOhlc[];
  ohlcvTimes: number[];
  seriesLen: number;
  lastTime: number;
  seriesKeySig: string;
};

const tipCaches = new Map<string, LiveTipCache>();

/** @internal test helper — drop forming-tip overlay caches. */
export function _clearLiveTipCachesForTests(): void {
  tipCaches.clear();
}

function withAxisSource(result: RunResult, script: string): RunResult {
  return {
    ...result,
    meta: { ...result.meta, axisSource: script },
  };
}

function cacheKey(indicatorId: string | undefined): string {
  return indicatorId ?? EDITOR_RUN_KEY;
}

function seriesKeySig(series: Record<string, unknown> | undefined | null): string {
  if (!series) return '';
  return Object.keys(series).sort().join('\0');
}

function maxSeriesLen(series: Record<string, unknown> | undefined | null): number {
  let n = 0;
  if (!series) return 0;
  for (const v of Object.values(series)) {
    if (Array.isArray(v) && v.length > n) n = v.length;
  }
  return n;
}

function tipTime(bars: Bar[]): number {
  if (!bars.length) return Number.NaN;
  return Number(bars[bars.length - 1]?.time);
}

function asFinite(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Prefer `store.bars` when the live window matches so `getOhlcvTimesForApply`
 * can reuse its cached axis instead of reallocating 5k times every tip.
 */
function axisBarsForLive(bars: Bar[], liveTick: boolean): Bar[] {
  if (!liveTick) return bars;
  const sb = store.bars;
  if (!sb || bars === sb) return bars;
  const n = bars.length;
  if (
    n === sb.length &&
    n > 0 &&
    Number(bars[0]?.time) === Number(sb[0]?.time) &&
    Number(bars[n - 1]?.time) === Number(sb[n - 1]?.time)
  ) {
    return sb;
  }
  return bars;
}

/** Last-cell OHLC tip from a plotbar/plotcandle series sample. */
function asOhlcTip(
  cell: unknown,
): { open: number; high: number; low: number; close: number; color?: string } | null {
  if (cell == null || typeof cell !== 'object') return null;
  const o = cell as Record<string, unknown>;
  const open = asFinite(o.open);
  const high = asFinite(o.high);
  const low = asFinite(o.low);
  const close = asFinite(o.close);
  if (open == null || high == null || low == null || close == null) return null;
  const color = typeof o.color === 'string' ? o.color : undefined;
  return color !== undefined ? { open, high, low, close, color } : { open, high, low, close };
}

function patchTipCache(cache: LiveTipCache, raw: RunResult): boolean {
  const series = (raw.series || {}) as Record<string, unknown[]>;
  if (seriesKeySig(series) !== cache.seriesKeySig) return false;
  if (maxSeriesLen(series) !== cache.seriesLen) return false;

  for (const line of cache.overlayLines) {
    if (line.kind === 'hline' && line.price != null) continue;
    const arr = series[line.name];
    if (!Array.isArray(arr) || !line.data.length) continue;
    const pt = line.data[line.data.length - 1];
    if (!pt) continue;
    const v = asFinite(arr[arr.length - 1]);
    if (v == null) delete pt.value;
    else pt.value = v;
  }

  for (const ohlc of cache.overlayOhlc) {
    if (!ohlc.data.length) continue;
    const arr = series[ohlc.name];
    if (!Array.isArray(arr) || !arr.length) return false;
    const tip = asOhlcTip(arr[arr.length - 1]);
    if (!tip) return false;
    const pt = ohlc.data[ohlc.data.length - 1];
    if (!pt) return false;
    pt.open = tip.open;
    pt.high = tip.high;
    pt.low = tip.low;
    pt.close = tip.close;
    if (tip.color !== undefined) pt.color = tip.color;
    else delete pt.color;
  }

  for (const [k, arr] of Object.entries(cache.seriesMap)) {
    if (!Array.isArray(arr) || !arr.length) continue;
    const rawArr = series[k];
    if (!Array.isArray(rawArr) || !rawArr.length) continue;
    arr[arr.length - 1] = rawArr[rawArr.length - 1] as never;
  }
  return true;
}

/** True when tip paint can skip marker/bgcolor/fill rebuilds. */
function tipPaintIsLean(cache: LiveTipCache, raw: RunResult): boolean {
  if (cache.split.shapes.length || cache.split.bgcolors.length || cache.split.barcolors.length) {
    return false;
  }
  if (cache.split.fills.length) return false;
  if (Array.isArray(raw.events) && raw.events.length) return false;
  return true;
}

function resultDrawings(result: RunResult): unknown[] | undefined {
  const drawings = (result as RunResult & { drawings?: unknown }).drawings;
  return Array.isArray(drawings) ? drawings : undefined;
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
  deps?: ApplyLiveDeps,
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
  const resolveManager = deps?.getManager ?? getManager;
  const scanHole = deps?.noteChartSeriesHole ?? noteChartSeriesHole;
  const paintPins = deps?.applyDebugPins ?? applyDebugPinsToChart;
  const writeLastRun = deps?.setLastRun ?? setLastRun;
  const paintDrawings = deps?.applyDrawings ?? applyDrawings;
  const writeStore = deps?.updateIndicatorStore ?? updateIndicatorStore;
  const buildOverlays = deps?.buildOverlayPayloads ?? buildOverlayPayloads;
  const alignSeries = deps?.alignApplySeries ?? alignApplySeries;

  const execCtx = String(result.meta?.executionContext || '');
  const formingTip = liveTick && execCtx === 'tip';
  const id = cacheKey(indicatorId);

  if (!isRunEpochCurrent(epoch)) {
    return { ...result, meta: { ...result.meta, superseded: true } };
  }

  // Forming tips already have a run slot from the snapshot / last append —
  // rewriting runResults every tick is a Solid store write of the full series.
  const haveRun = (store.runResults as Record<string, unknown> | undefined)?.[id] != null;
  if (!formingTip || !haveRun) {
    writeLastRun(withAxisSource(result, script), {
      scriptId: id,
      focus: !silent,
      persistence: silent || liveTick ? 'skip' : 'auto',
    });
  }
  if (result.status === 'error') return result;

  if (indicatorId && !appliedScriptStillOnChart(indicatorId)) {
    tipCaches.delete(id);
    return { ...result, meta: { ...result.meta, skipped: 'hidden' } };
  }

  try {
    const last = bars.length ? bars[bars.length - 1] : undefined;
    const lastClose = last && Number.isFinite(Number(last.close)) ? Number(last.close) : undefined;
    notifyPineAlertsFromRun(result, {
      indicatorId: id,
      lastBarIndex: bars.length ? bars.length - 1 : undefined,
      price: lastClose,
      symbol: store.symbol,
    });
  } catch {
    /* Pine alerts must not break chart apply */
  }

  const manager = resolveManager();
  if (!manager) return result;

  if (!isRunEpochCurrent(epoch)) {
    return { ...result, meta: { ...result.meta, superseded: true } };
  }

  const t = tipTime(bars);
  if (formingTip) {
    const cache = tipCaches.get(id);
    if (
      cache &&
      cache.script === script &&
      cache.seriesLen === maxSeriesLen(result.series as Record<string, unknown>) &&
      cache.lastTime === t &&
      Number.isFinite(t) &&
      patchTipCache(cache, result)
    ) {
      try {
        if (!manager.getPane(cache.paneId)) {
          if (!silent) {
            appendLog(
              'warn',
              `Chart pane "${cache.paneId}" missing — skipped plot apply (chart disposed?)`,
              'plot',
            );
          }
        } else if (tipPaintIsLean(cache, result)) {
          // Lines/OHLC tip-update only — skip marker/bgcolor/fill rebuilds.
          const owner = { ownerId: id, forceFull: false };
          manager.syncOverlayLines(cache.paneId, cache.overlayLines, owner);
          if (cache.overlayOhlc.length && typeof manager.syncOverlayOhlc === 'function') {
            manager.syncOverlayOhlc(cache.paneId, cache.overlayOhlc, owner);
          }
          if (store.debugPinsEnabled) paintPins();
        } else {
          const painted = applyPlotsAndMarkers({
            mutation: {
              manager,
              paneId: cache.paneId,
              overlay: cache.overlay,
              overlayLines: cache.overlayLines,
              overlayOhlc: cache.overlayOhlc,
              split: cache.split,
              plotMeta: cache.plotMeta,
              seriesMap: cache.seriesMap,
              ohlcvTimes: cache.ohlcvTimes,
              silent,
              indicatorId,
              forceFull: false,
            },
            strategy: {
              manager,
              result,
              scriptType: cache.scriptType,
              silent,
              indicatorId,
              bars,
            },
          });
          if (!painted.ok) {
            throw new Error(`Chart apply aborted (${painted.reason})`);
          }
          if (store.debugPinsEnabled) paintPins();
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
      // Omit-the-field drawings stay put on silent tips; explicit [] still clears.
      if (resultDrawings(result) !== undefined) {
        paintDrawings({
          epoch,
          indicatorId,
          result,
          script,
          bars,
          overlay: cache.overlay,
          paneId: cache.paneId,
          silent,
        });
      }
      return result;
    }
  }

  const existing = indicatorId ? store.scripts.find((s) => s.id === indicatorId) : undefined;
  const barsAxis = axisBarsForLive(bars, liveTick);
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
  } = alignSeries(script, result, barsAxis, {
    silent,
    existingName: existing?.name,
    livePush: liveTick,
  });
  if (staleNoAxis) {
    tipCaches.delete(id);
    return { ...result, meta: { ...result.meta, skipped: 'stale-no-axis' } };
  }
  if (resultTimes && resultTimes.length > 1) {
    // Forming tips do not open new internal holes; the O(n) scan + alloc
    // belongs on snapshots / non-live applies (runner still covers those).
    if (!liveTick) scanHole(resultTimes, barsAxis);
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
  const overlayBuilt = buildOverlays({
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
    tipCaches.delete(id);
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
      // Pins off is the hot path; skip getManager + clearDebugPinMarkers.
      if (store.debugPinsEnabled) paintPins();
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

  // Forming tips omit drawings → leave the gallery alone (no layer lookup).
  if (!formingTip || resultDrawings(result) !== undefined) {
    paintDrawings({ epoch, indicatorId, result, script, bars, overlay, paneId, silent });
  }

  // Tip path: script card + series cache wait for append / snapshot. A new
  // editor-owned apply (no indicatorId) still needs addIndicator.
  const skipStore = formingTip && !!indicatorId;
  if (!skipStore) {
    if (
      !writeStore({
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
  }

  if (liveTick && Number.isFinite(t)) {
    tipCaches.set(id, {
      script,
      paneId,
      overlay,
      scriptName,
      scriptType,
      plotMeta,
      seriesMap,
      split,
      seriesEntries,
      overlayLines,
      overlayOhlc,
      ohlcvTimes,
      seriesLen: maxSeriesLen(result.series as Record<string, unknown>),
      lastTime: t,
      seriesKeySig: seriesKeySig(result.series as Record<string, unknown>),
    });
  } else if (!liveTick) {
    tipCaches.delete(id);
  }

  return result;
}
