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

import { createSignal } from 'solid-js';
import { notifyPineAlertsFromRun } from '../alerts/pine-bridge';
import { applyDebugPinsToChart, getManager } from '../chart/manager-access';
import { noteChartSeriesHole, noteEngineAxisBehindChart } from '../engines/series-repair';
import { appendLog, EDITOR_RUN_KEY, setLastRun, setStatus, store } from '../store';
import type { Bar } from '../store/types';
import { reportUiError } from '../ui/boot-errors';
import {
  collectDataViewSeries,
  type CollectedDataViewSeries,
  type DataViewPlotMeta,
  type DataViewScriptRef,
} from '../results/dataview';
import type { PlotMetaEntry } from '../results/plot-visuals';
import type { splitSeriesByKind } from '../results/plot-visuals';
import type { IndicatorSeriesCache } from '../results/plot-sources';
import { alignApplySeries } from './apply-context';
import { holdForEngineHole } from './engine-hole-guard';
import { appliedScriptStillOnChart, applyDrawings } from './apply-drawings';
import { applyPlotsAndMarkers } from './apply-mutations';
import { buildOverlayPayloads, type OverlayLine, type OverlayOhlc } from './apply-overlays';
import { ensureApplyPane } from './apply-pane';
import { updateIndicatorStore } from './apply-store';
import { currentRunEpoch, formatRunError, isRunEpochCurrent } from './run-helpers';
import type { RunOptions, RunResult } from './runner';

/** Live-apply flags. Both default to `true` in {@link applyPrecomputedChart}. */
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

/**
 * Bumped whenever a forming-tip cache is written, patched, slid, or cleared.
 * Data Window reads this so Solid refreshes without writing full series into
 * `lastRun` on every tick.
 */
const [liveTipCacheGen, setLiveTipCacheGen] = createSignal(0);

function bumpLiveTipCacheGen(): void {
  setLiveTipCacheGen((n) => (n >= Number.MAX_SAFE_INTEGER ? 1 : n + 1));
}

function dropTipCache(id: string): void {
  if (tipCaches.delete(id)) bumpLiveTipCacheGen();
}

/** Reactive generation for Data Window / UI subscribers. */
export function getLiveTipCacheGeneration(): number {
  return liveTipCacheGen();
}

/** @internal test helper — drop forming-tip overlay caches. */
export function _clearLiveTipCachesForTests(): void {
  if (!tipCaches.size) return;
  tipCaches.clear();
  bumpLiveTipCacheGen();
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
  const open = asFinite(o['open']);
  const high = asFinite(o['high']);
  const low = asFinite(o['low']);
  const close = asFinite(o['close']);
  if (open == null || high == null || low == null || close == null) return null;
  const color = typeof o['color'] === 'string' ? o['color'] : undefined;
  return color !== undefined ? { open, high, low, close, color } : { open, high, low, close };
}

/**
 * New candle(s) arrived. Keep overlay points attached to their bar times and
 * drop the rolled-off head. A real tip value from this result may land on the
 * new bar; never copy the previous last value onto a newer time (that lag is
 * the "few-bar leg" users reject). Index-zipping a same-length stale window
 * would still shift Donchian/SMA.
 */
function slideTipCache(cache: LiveTipCache, bars: Bar[], raw: RunResult, t: number): boolean {
  const series = (raw.series || {}) as Record<string, unknown[]>;
  if (seriesKeySig(series) !== cache.seriesKeySig) return false;
  const first = Number(bars[0]?.time);
  if (!Number.isFinite(first) || !Number.isFinite(t) || t <= cache.lastTime) return false;

  const times: number[] = [];
  for (const b of bars) {
    const bt = Number(b.time);
    if (Number.isFinite(bt)) times.push(bt);
  }
  if (!times.length) return false;

  for (const line of cache.overlayLines) {
    if (line.kind === 'hline' && line.price != null) continue;
    if (!line.data.length) continue;
    let i = 0;
    while (i < line.data.length && Number(line.data[i]?.time) < first) i++;
    if (i > 0) line.data = line.data.slice(i);
    const lastPt = line.data[line.data.length - 1];
    const lastT = lastPt ? Number(lastPt.time) : Number.NaN;
    const arr = series[line.name];
    const v = Array.isArray(arr) ? asFinite(arr[arr.length - 1]) : undefined;
    if (Number.isFinite(lastT) && t === lastT && lastPt) {
      if (v == null) delete lastPt.value;
      else lastPt.value = v;
    } else if ((!Number.isFinite(lastT) || t > lastT) && v != null) {
      // Only extend when this result actually evaluated the new tip.
      line.data.push({ time: t, value: v });
    }
  }

  for (const [k, arr] of Object.entries(cache.seriesMap)) {
    if (!Array.isArray(arr)) continue;
    const rawArr = series[k];
    const tip = Array.isArray(rawArr) ? rawArr[rawArr.length - 1] : undefined;
    const missing = times.length - arr.length;
    if (missing > 0) {
      for (let n = 0; n < missing; n++) {
        // Prefer a real tip from this result; otherwise null (no hold-forward).
        arr.push((n === missing - 1 && tip !== undefined ? tip : null) as never);
      }
    } else if (arr.length && tip !== undefined) {
      arr[arr.length - 1] = tip as never;
    }
    while (arr.length > times.length) arr.shift();
  }

  cache.lastTime = t;
  cache.ohlcvTimes = times;
  const nextLen = maxSeriesLen(series);
  if (nextLen > 0) cache.seriesLen = nextLen;
  return true;
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

/** Tip-cache shape accepted by {@link mergeLivePlotSeriesForDataView} (tests). */
export type LiveDataViewTipCache = {
  seriesMap: Record<string, unknown[] | (number | null)[]>;
  plotMeta?: Record<string, DataViewPlotMeta | PlotMetaEntry>;
  scriptName?: string;
  ohlcvTimes?: number[];
};

export type MergeLivePlotSeriesInput = {
  scripts?: readonly DataViewScriptRef[];
  runResults?: Record<string, unknown> | null;
  indicatorSeries?: IndicatorSeriesCache | null;
  /** Chart bar times for time-join. Defaults to `store.bars`. */
  chartTimes?: readonly number[] | null;
  /**
   * Forming-tip caches. Omit to read the live private map; pass a Map/Record
   * in unit tests.
   */
  tipCaches?:
    | ReadonlyMap<string, LiveDataViewTipCache>
    | Record<string, LiveDataViewTipCache>
    | null;
  fallbackRun?: {
    series?: Record<string, unknown> | null;
    plotMeta?: Record<string, DataViewPlotMeta> | null;
    times?: readonly number[] | null;
    plots?: Record<string, { display?: number | null } | undefined> | null;
    label?: string;
  } | null;
};

function resolveTipCacheMap(
  tipInput: MergeLivePlotSeriesInput['tipCaches'],
): Map<string, LiveDataViewTipCache> {
  if (tipInput === undefined) return tipCachesFromLive();
  if (tipInput == null) return new Map();
  if (tipInput instanceof Map) return new Map(tipInput);
  return new Map(Object.entries(tipInput));
}

function tipCachesFromLive(): Map<string, LiveDataViewTipCache> {
  const out = new Map<string, LiveDataViewTipCache>();
  for (const [id, cache] of tipCaches) {
    out.set(id, {
      seriesMap: cache.seriesMap,
      plotMeta: cache.plotMeta,
      scriptName: cache.scriptName,
      ohlcvTimes: cache.ohlcvTimes,
    });
  }
  return out;
}

function copySeriesMap(
  series: Record<string, unknown[] | (number | null)[]> | null | undefined,
): Record<string, (number | null | string | boolean)[]> {
  const out: Record<string, (number | null | string | boolean)[]> = {};
  if (!series) return out;
  for (const [k, arr] of Object.entries(series)) {
    if (!Array.isArray(arr)) continue;
    out[k] = arr.slice() as (number | null | string | boolean)[];
  }
  return out;
}

/**
 * Overlay forming-tip last cells onto a base window. When the tip map is already
 * a full window (live tipCaches), prefer those columns when lengths match or
 * exceed the base.
 */
function overlayTipSeries(
  base: Record<string, (number | null | string | boolean)[]>,
  tipSeries: Record<string, unknown[] | (number | null)[]>,
): Record<string, (number | null | string | boolean)[]> {
  const out = copySeriesMap(base);
  for (const [k, tipArr] of Object.entries(tipSeries)) {
    if (!Array.isArray(tipArr) || !tipArr.length) continue;
    const tipLen = tipArr.length;
    const baseArr = out[k];
    const baseLen = baseArr?.length ?? 0;
    if (!baseArr || tipLen >= baseLen) {
      out[k] = tipArr.slice() as (number | null | string | boolean)[];
      continue;
    }
    const next = baseArr.slice();
    next[next.length - 1] = tipArr[tipLen - 1] as (number | null | string | boolean);
    out[k] = next;
  }
  return out;
}

function titlesFromPlotMeta(
  plotMeta: Record<string, DataViewPlotMeta | PlotMetaEntry> | null | undefined,
): Record<string, string> {
  const titles: Record<string, string> = {};
  if (!plotMeta) return titles;
  for (const [k, meta] of Object.entries(plotMeta)) {
    if (meta?.title != null) titles[k] = String(meta.title);
  }
  return titles;
}

function chartTimesFromStore(): number[] {
  const bars = store.bars;
  if (!Array.isArray(bars) || !bars.length) return [];
  const out: number[] = [];
  for (const b of bars) {
    const t = Number(b?.time);
    if (Number.isFinite(t)) out.push(t);
  }
  return out;
}

function runSeriesBag(run: unknown): Record<string, (number | null | string | boolean)[]> {
  if (!run || typeof run !== 'object') return {};
  const series = (run as { series?: unknown }).series;
  return copySeriesMap(series as Record<string, unknown[]> | null | undefined);
}

function runPlotMetaBag(run: unknown): Record<string, DataViewPlotMeta> {
  if (!run || typeof run !== 'object') return {};
  const meta = (run as { meta?: { plot_meta?: unknown }; plot_meta?: unknown }).meta?.plot_meta
    ?? (run as { plot_meta?: unknown }).plot_meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  const out: Record<string, DataViewPlotMeta> = {};
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    out[k] = v as DataViewPlotMeta;
  }
  return out;
}

/**
 * Merge plot series for the Data Window across **all visible chart scripts**.
 *
 * Base window comes from `runResults` / `indicatorSeries`; forming-tip cells
 * from `tipCaches` overlay the tip index (read-time only — tips still skip
 * writing full series into `lastRun`).
 */
export function mergeLivePlotSeriesForDataView(
  input: MergeLivePlotSeriesInput = {},
): CollectedDataViewSeries {
  const scripts = input.scripts ?? store.scripts;
  const runResults = input.runResults ?? store.runResults ?? {};
  const indicatorSeries = { ...(input.indicatorSeries ?? store.indicatorSeries ?? {}) };
  const tipMap = resolveTipCacheMap(input.tipCaches);
  const chartTimes = input.chartTimes ?? chartTimesFromStore();

  // Ensure tip-only scripts (stream live, not yet in indicatorSeries) appear.
  const scriptList: DataViewScriptRef[] = scripts.map((s) => ({
    id: s.id,
    name: s.name,
    visible: s.visible,
    plots: s.plots,
  }));
  const seen = new Set(scriptList.map((s) => s.id));
  for (const [id, tip] of tipMap) {
    if (seen.has(id)) continue;
    if (id === EDITOR_RUN_KEY) continue;
    scriptList.push({
      id,
      name: tip.scriptName || id,
      visible: true,
    });
    seen.add(id);
  }

  for (const [id, tip] of tipMap) {
    const run = runResults[id];
    const cached = indicatorSeries[id];
    const base = cached?.series
      ? copySeriesMap(cached.series as Record<string, unknown[]>)
      : runSeriesBag(run);
    const mergedSeries = overlayTipSeries(base, tip.seriesMap);
    if (!Object.keys(mergedSeries).length) continue;

    const runMeta = runPlotMetaBag(run);
    const tipMeta = tip.plotMeta || {};
    const titles = {
      ...(cached?.titles || {}),
      ...titlesFromPlotMeta(runMeta),
      ...titlesFromPlotMeta(tipMeta),
    };
    const plotMeta: Record<string, DataViewPlotMeta> = { ...runMeta };
    for (const [k, meta] of Object.entries(tipMeta)) {
      plotMeta[k] = { ...(plotMeta[k] ?? {}), ...(meta as DataViewPlotMeta) };
    }
    // scripts[].plots colors when plot_meta omitted them (Donchian cards).
    const script = scriptList.find((s) => s.id === id);
    for (const [k, plot] of Object.entries(script?.plots || {})) {
      if (!plot || typeof plot !== 'object') continue;
      const color = (plot as { color?: string }).color;
      if (color == null) continue;
      plotMeta[k] = { ...(plotMeta[k] ?? {}), color: plotMeta[k]?.color ?? color };
      if (!titles[k] && plotMeta[k]?.title == null) titles[k] = k;
    }

    indicatorSeries[id] = {
      name: tip.scriptName || cached?.name || script?.name || id,
      series: mergedSeries as IndicatorSeriesCache[string]['series'],
      titles,
      times: tip.ohlcvTimes?.length
        ? tip.ohlcvTimes.slice()
        : cached?.times?.slice() || undefined,
    };
  }

  return collectDataViewSeries({
    scripts: scriptList,
    runResults,
    indicatorSeries,
    chartTimes,
    fallbackRun: input.fallbackRun,
  });
}

/** Live tipCaches + store snapshot for the Data Window. */
export function getLiveTipSeriesSnapshot(
  input: Omit<MergeLivePlotSeriesInput, 'tipCaches'> = {},
): CollectedDataViewSeries {
  return mergeLivePlotSeriesForDataView(input);
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
  // Live ticks must not bump the global run epoch — that cancelled in-flight
  // catalog adds with "Run superseded" and skipped their first paint.
  const epoch = currentRunEpoch();
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

  const execCtx = String(result.meta?.['executionContext'] || '');
  const formingTip = liveTick && execCtx === 'tip';
  const id = cacheKey(indicatorId);

  if (!liveTick && !isRunEpochCurrent(epoch)) {
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
    dropTipCache(id);
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

  if (!liveTick && !isRunEpochCurrent(epoch)) {
    return { ...result, meta: { ...result.meta, superseded: true } };
  }

  const t = tipTime(bars);
  if (formingTip) {
    const cache = tipCaches.get(id);
    const seriesLen = maxSeriesLen(result.series as Record<string, unknown>);
    const sameTip =
      !!cache &&
      cache.script === script &&
      cache.seriesLen === seriesLen &&
      cache.lastTime === t &&
      Number.isFinite(t) &&
      patchTipCache(cache, result);
    const slid =
      !sameTip &&
      !!cache &&
      cache.script === script &&
      Number.isFinite(t) &&
      t > cache.lastTime &&
      slideTipCache(cache, bars, result, t);
    if ((sameTip || slid) && cache) {
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
      // Tip path skips setLastRun / updateIndicatorStore — bump gen so Data
      // Window re-reads tipCaches at the crosshair without a full series write.
      bumpLiveTipCacheGen();
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
    gapTimes,
    holeTimes,
    staleNoAxis,
  } = alignSeries(script, result, barsAxis, {
    silent,
    existingName: existing?.name,
    livePush: liveTick,
  });
  if (staleNoAxis) {
    dropTipCache(id);
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
  // Chart guard: a run evaluated over an internally holed engine window is not
  // delivered — hold the last good plots while it repairs (bounded).
  if (holdForEngineHole(indicatorId, holeTimes)) {
    dropTipCache(id);
    return { ...result, meta: { ...result.meta, skipped: 'engine-hole' } };
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
  if (!liveTick && !isRunEpochCurrent(epoch)) {
    return { ...result, meta: { ...result.meta, superseded: true } };
  }
  const { overlayLines, overlayOhlc } = overlayBuilt as {
    overlayLines: OverlayLine[];
    overlayOhlc: OverlayOhlc[];
  };

  if (indicatorId && !appliedScriptStillOnChart(indicatorId)) {
    dropTipCache(id);
    return { ...result, meta: { ...result.meta, skipped: 'hidden' } };
  }

  try {
    if (!liveTick && !isRunEpochCurrent(epoch)) {
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
          gapTimes,
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
    const tipCache: LiveTipCache = {
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
    };
    tipCaches.set(id, tipCache);
    bumpLiveTipCacheGen();
  } else if (!liveTick) {
    dropTipCache(id);
  }

  return result;
}
