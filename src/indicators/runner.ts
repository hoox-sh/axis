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
 * **Indicator / strategy runner** — evaluate Pine via the active engine and
 * apply results to chart panes, markers, equity, and script drawings.
 *
 * ## Flow
 *
 * 1. {@link runScript} — resolve {@link getActiveEngine}, call `engine.run`,
 *    update engine telemetry / latency (no chart mutation).
 * 2. {@link runAndApply} — then map result onto {@link PaneManager}:
 *    - line/hline series from `series` + `plot_meta`
 *    - bgcolor histograms, plotshape markers
 *    - strategy trade markers + equity curve
 *    - Pine line/box/label drawings via drawing layer
 *    - optional new {@link addIndicator} entry when no `indicatorId`
 *
 * Overlay vs sub-pane follows `meta.overlay` (indicator default false,
 * strategy default true; explicit `false` is never coerced true).
 *
 * Live path uses `silent: true` / `openResults: false` from stream multiplex.
 *
 * ## Public API
 *
 * - {@link runScript}, {@link runAndApply}, {@link probeEndpoint}
 * - Types: {@link RunResult}, {@link RunOptions}
 * - Hardening helpers re-exported from {@link indicators/run-helpers}:
 *   {@link formatRunError}, {@link normalizeEngineResult}, run epochs
 *
 * Concurrent runs use a monotonic epoch so stale completions never clobber
 * `lastRun` / chart apply / status bar of a newer run.
 *
 * @module indicators/runner
 */

import {
  store,
  setStore,
  addIndicator,
  addPane,
  removePane,
  setStatus,
  setLastRun,
  EDITOR_RUN_KEY,
  setIndicatorSeries,
  appendLog,
  recordRunLatency,
  setTelemetryPlane,
  setTelemetryState,
} from '../store';
import { resolveInputSourceValues } from '../results/plot-sources';
import { getManager, applyDebugPinsToChart } from '../chart/manager-access';
import { PLOT_PALETTE } from '../chart/series-factory';
import { normalizeStrategyEvents, eventsToMarkers, buildEquityCurve } from '../results/events';
import { buildStrategyReport } from '../results/strategy';
import {
  bgcolorSeriesToHistogramData,
  lineSeriesToOverlayData,
  resolvePlotFillBands,
  shapeSeriesToMarkers,
  splitSeriesByKind,
  type PlotMetaEntry,
} from '../results/plot-visuals';
import { getActiveDrawingLayer } from '../chart/drawing-layer';
import {
  garbageCollectScriptDrawings,
  normalizeScriptDrawings,
  resolveDrawingLimits,
} from '../chart/pine-drawings';
import { getActiveEngine, getActiveEngineConfig } from '../plugins/active';
import type { RunResult as EngineRunResult } from '../plugins/types';
import { classifyTransport } from '../ui/telemetry';
import { reportUiError } from '../ui/boot-errors';
import {
  beginRunEpoch,
  formatRunError,
  isRunEpochCurrent,
  lineDataHasSample,
  normalizeEngineResult,
  type NormalizedRunResult,
} from './run-helpers';

/** Engine result with `series` always present (empty object if missing). */
export type RunResult = EngineRunResult & {
  series: Record<string, (number | null)[]>;
  plots: (number | null)[];
};

export type { NormalizedRunResult };
export {
  beginRunEpoch,
  coercePlotSample,
  currentRunEpoch,
  formatRunError,
  isRunEpochCurrent,
  lineDataHasSample,
  normalizeBarTime,
  normalizeEngineResult,
  normalizeSeriesMap,
  seriesValuesToLineData,
  _resetRunEpochForTests,
} from './run-helpers';

/** Options shared by {@link runScript} and {@link runAndApply}. */
export interface RunOptions {
  /** Quiet status bar / fewer log lines (live re-runs) */
  silent?: boolean;
  /** Open Results drawer after run (default true when not silent) */
  openResults?: boolean;
  /** Pine input.* overrides keyed by title (Script Settings) */
  inputs?: Record<string, unknown>;
  /**
   * When false, do not advance the concurrent-run epoch (nested calls).
   * Prefer {@link RunOptions.epoch} when nesting under {@link runAndApply}.
   */
  claimEpoch?: boolean;
  /**
   * Existing run epoch from {@link runAndApply}. When set, skip claiming a
   * new epoch and use this for supersession checks (status / telemetry).
   */
  epoch?: number;
}

type PineLogLine = { level?: string; message?: string; [k: string]: unknown };

/**
 * Resolve Pine `overlay` for pane routing.
 * - explicit false / 0 / "false" → sub-pane
 * - explicit true → price pane
 * - missing: indicator → sub-pane, strategy (or unknown) → price (Pine default)
 */
export function resolveOverlayFlag(
  overlayFlag: unknown,
  scriptType?: string,
): boolean {
  if (overlayFlag === false || overlayFlag === 0 || overlayFlag === 'false') {
    return false;
  }
  if (overlayFlag === true || overlayFlag === 1 || overlayFlag === 'true') {
    return true;
  }
  const t = (scriptType || '').toLowerCase();
  if (t === 'indicator' || t === 'library') return false;
  // strategy / blank → overlay on price (Pine strategy default)
  return true;
}

/**
 * True when finite plot samples sit on a scale that would vanish against
 * typical price (e.g. RSI 0–100 or rsi*0.01 vs BTC).
 */
export function seriesWouldHideOnPrice(
  seriesEntries: ReadonlyArray<readonly [string, unknown[]]>,
  bars: ReadonlyArray<{ close?: number }>,
): boolean {
  let min = Infinity;
  let max = -Infinity;
  let n = 0;
  for (const [, arr] of seriesEntries) {
    if (!Array.isArray(arr)) continue;
    for (const v of arr) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
      n += 1;
    }
  }
  if (n < 2 || !Number.isFinite(min) || !Number.isFinite(max)) return false;
  const plotSpan = Math.max(Math.abs(max), Math.abs(min), max - min);
  if (plotSpan <= 0) return false;

  let priceRef = 0;
  let pc = 0;
  for (const b of bars) {
    const c = b?.close;
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) {
      priceRef += c;
      pc += 1;
    }
  }
  if (pc < 1) return false;
  priceRef /= pc;

  // Oscillator / normalized band: values stay within ~[-500, 5000] and are
  // tiny vs average price (e.g. RSI*0.01 ≈ 0.5 on a 50k instrument).
  const looksBounded = max <= 5000 && min >= -5000;
  const tinyVsPrice = plotSpan < priceRef * 0.02 && Math.abs(max) < priceRef * 0.05;
  return looksBounded && tinyVsPrice;
}

/**
 * Lift `meta.logs` / `meta.profile` onto top-level when engines only put them in meta.
 * Does not auto-open Scriptlogs (callers may still open Results).
 */
function normalizeRunExtras(result: RunResult): RunResult {
  const meta = result.meta;
  let logs = result.logs;
  if (!logs && meta && Array.isArray(meta.logs)) {
    logs = meta.logs as PineLogLine[];
  }
  let profile = result.profile;
  if (!profile && meta && meta.profile && typeof meta.profile === 'object') {
    profile = meta.profile as Record<string, unknown>;
  }
  if (logs === result.logs && profile === result.profile) return result;
  return {
    ...result,
    ...(logs ? { logs } : {}),
    ...(profile ? { profile } : {}),
  };
}

/**
 * Execute Pine against `store.bars` via the active engine.
 * Does not mutate chart series; use {@link runAndApply} for full apply.
 *
 * Always returns a normalized {@link RunResult} (never throws). Empty bars,
 * network/timeout/abort, and malformed engine payloads become `status: 'error'`
 * with user-readable {@link formatRunError} messages.
 */
export async function runScript(script: string, opts: RunOptions = {}): Promise<RunResult> {
  const silent = !!opts.silent;
  // Prefer caller epoch (runAndApply); else claim unless claimEpoch: false.
  const epoch =
    opts.epoch != null
      ? opts.epoch
      : opts.claimEpoch === false
        ? undefined
        : beginRunEpoch();
  if (!silent) setStatus('running', 'Executing Pine Script…');
  const t0 = performance.now();

  const bars = store.bars;
  if (!Array.isArray(bars) || bars.length === 0) {
    const msg = 'No bars loaded — load a symbol before running';
    // Only touch status if this generation is still current
    if (epoch == null || isRunEpochCurrent(epoch)) {
      if (!silent) setStatus('error', msg);
      else appendLog('error', `Live re-run: ${msg}`, 'live');
      setTelemetryState('engine', 'error', { error: msg });
    }
    return {
      status: 'error',
      plots: [],
      series: {},
      events: [],
      error: msg,
      meta: { ms: 0 },
    };
  }

  try {
    const engine = getActiveEngine();
    const baseConfig = getActiveEngineConfig() || {};
    // Hint engines to collect line timing when profiler mode is on (ignored if unsupported).
    const config: Record<string, unknown> = {
      ...baseConfig,
      profiler: !!store.profilerEnabled,
    };
    const transport = classifyTransport('engine', engine.id, engine.capabilities);
    const mode = String(config.mode || 'interpret');
    setTelemetryPlane('engine', {
      id: engine.id,
      name: engine.name,
      transport,
      state: 'connecting',
      detail: mode,
      error: null,
    });
    // Soft outer budget for status messaging only — engines manage their own
    // AbortSignal.timeout for HTTP (WS probe + REST fallback must not share a
    // short parent abort). We still surface timeout wording via formatRunError.
    void (silent
      ? 60_000
      : Math.min(180_000, Math.max(90_000, 45_000 + bars.length * 40)));
    const rawInputs =
      opts.inputs && Object.keys(opts.inputs).length
        ? opts.inputs
        : store.editorInputValues && Object.keys(store.editorInputValues).length
          ? store.editorInputValues
          : undefined;
    // Expand plot:<indicatorId>:<plotKey> refs → full series arrays for the engine
    const inputs = resolveInputSourceValues(rawInputs, store.indicatorSeries);
    const rawResult = await engine.run({
      script,
      bars,
      config,
      inputs,
      // Do not abort the whole run on a short timer while engine may still REST-fallback.
      // Engine uses its own AbortSignal.timeout for HTTP; pass undefined for max reliability.
      signal: undefined,
    });

    const ms =
      (typeof rawResult?.meta?.ms === 'number' && Number.isFinite(rawResult.meta.ms)
        ? rawResult.meta.ms
        : null) ?? performance.now() - t0;
    // Normalize first so callers always get stable series/plots shapes
    const result = normalizeEngineResult(rawResult, ms);
    // Superseded by a newer run — keep payload, skip status/telemetry of the winner
    if (epoch != null && !isRunEpochCurrent(epoch)) {
      return {
        ...result,
        series: result.series || {},
        plots: result.plots || [],
        events: result.events || [],
        meta: { ...result.meta, ms, superseded: true },
      };
    }
    const runTransport =
      result.meta?.transport === 'ws'
        ? 'ws'
        : result.meta?.transport === 'local'
          ? 'local'
          : transport;
    recordRunLatency(ms);
    if (result.status === 'error') {
      const msg = formatRunError(result.error || 'Engine error');
      result.error = msg;
      // Superseded: still return payload but do not clobber winner status bar
      if (epoch != null && !isRunEpochCurrent(epoch)) {
        return {
          ...result,
          series: result.series || {},
          plots: result.plots || [],
          events: result.events || [],
          meta: { ...result.meta, ms, superseded: true },
        };
      }
      setTelemetryState('engine', 'error', {
        error: msg,
        latencyMs: ms,
        detail: mode,
        transport: runTransport,
      });
      if (!silent) setStatus('error', msg);
      else appendLog('error', `Live re-run failed: ${msg}`, 'live');
      return {
        ...result,
        series: result.series || {},
        plots: result.plots || [],
        events: result.events || [],
        meta: { ...result.meta, ms },
      };
    }
    if (epoch != null && !isRunEpochCurrent(epoch)) {
      return {
        ...result,
        series: result.series || {},
        plots: result.plots || [],
        events: result.events || [],
        meta: {
          ...result.meta,
          ms,
          overlay: result.meta?.overlay ?? true,
          script_name: result.meta?.script_name || 'plot',
          superseded: true,
        },
      };
    }
    setTelemetryState('engine', 'open', {
      latencyMs: ms,
      detail: `${mode} · ${runTransport} · ${ms.toFixed(0)}ms`,
      error: null,
      transport: runTransport,
    });
    if (!silent) setStatus('ready', `Completed in ${ms.toFixed(0)}ms`);
    return {
      ...result,
      series: result.series || {},
      plots: result.plots || [],
      events: result.events || [],
      meta: {
        ...result.meta,
        ms,
        overlay: result.meta?.overlay ?? true,
        script_name: result.meta?.script_name || 'plot',
      },
    };
  } catch (err: unknown) {
    const ms = performance.now() - t0;
    recordRunLatency(ms);
    // Superseded mid-flight: quiet return (winner owns status bar)
    if (epoch != null && !isRunEpochCurrent(epoch)) {
      return {
        status: 'error',
        plots: [],
        series: {},
        events: [],
        error: 'Superseded by a newer run',
        meta: { ms },
      };
    }
    const msg = formatRunError(err);
    setTelemetryState('engine', 'error', { error: msg, latencyMs: ms });
    if (!silent) setStatus('error', msg);
    else appendLog('error', `Live re-run: ${msg}`, 'live');
    return {
      status: 'error',
      plots: [],
      series: {},
      events: [],
      error: msg,
      meta: { ms },
    };
  }
}

/**
 * Run a Pine Script and apply results to the chart.
 * @param script - Pine Script source code
 * @param indicatorId - If provided, an existing indicator ID to update.
 * @param opts - silent / openResults for live path
 *
 * Concurrent runs: each call advances a run epoch; only the latest epoch
 * may update `lastRun`, open Results, or mutate chart series — stale
 * completions return their result with `meta.superseded: true` and no chart apply.
 */
export async function runAndApply(
  script: string,
  indicatorId?: string,
  opts: RunOptions = {},
): Promise<RunResult> {
  const silent = !!opts.silent;
  const openResults = opts.openResults ?? !silent;
  const epoch = beginRunEpoch();

  // Prefer explicit opts.inputs; else per-indicator saved values; else editor
  let inputs = opts.inputs;
  if (!inputs && indicatorId) {
    const ind = store.scripts.find((s) => s.id === indicatorId);
    if (ind?.inputValues && Object.keys(ind.inputValues).length) {
      inputs = ind.inputValues;
    }
  }
  // Pass epoch so nested runScript can skip status/telemetry if superseded mid-flight
  const raw = await runScript(script, { ...opts, inputs, claimEpoch: false, epoch });
  const result = normalizeRunExtras(raw);

  // Stale completion — never clobber newer lastRun / chart
  if (!isRunEpochCurrent(epoch)) {
    return {
      ...result,
      meta: { ...result.meta, superseded: true },
    };
  }

  // Per-script cache: silent multi-indicator live re-runs must not thrash
  // Scriptlogs/Results (only the focused id updates store.lastRun).
  setLastRun(result, {
    scriptId: indicatorId ?? EDITOR_RUN_KEY,
    focus: !silent,
  });
  if (openResults) {
    setStore('resultsPanel', 'open', true);
  }
  // Do not auto-open Scriptlogs aggressively; panel is user-toggled.
  if (result.status === 'error') return result;

  const manager = getManager();
  if (!manager) return result;

  // Re-check before chart mutation (manager work can be slow)
  if (!isRunEpochCurrent(epoch)) {
    return {
      ...result,
      meta: { ...result.meta, superseded: true },
    };
  }

  const existing = indicatorId
    ? store.scripts.find((s) => s.id === indicatorId)
    : undefined;
  const scriptName = String(result.meta?.script_name || existing?.name || 'Indicator');
  const scriptType = String(
    (result.meta as { script_type?: string } | undefined)?.script_type ||
      (result.meta as { kind?: string } | undefined)?.kind ||
      '',
  ).toLowerCase();

  const ohlcvTimes = (store.bars || []).map((b) => b?.time);
  const plotMeta = (result.meta?.plot_meta || {}) as Record<string, PlotMetaEntry>;
  const seriesMap = result.series || {};
  const split = splitSeriesByKind(seriesMap, plotMeta);

  // Line-like series only — bgcolor/plotshape handled below
  const seriesEntries = split.lines.map((e) => [e.key, e.values] as const);

  // Pine: indicator defaults overlay=false; strategy defaults overlay=true.
  // Explicit false must never be coerced to true.
  let overlay = resolveOverlayFlag(result.meta?.overlay, scriptType);

  // Oscillator-scale plots (RSI, MACD, …) on the price pane are effectively
  // invisible (values ~0–100 vs BTC price). Force a sub-pane so scripts show.
  if (overlay && seriesWouldHideOnPrice(seriesEntries, store.bars || [])) {
    overlay = false;
    if (!silent) {
      appendLog(
        'info',
        'Plot scale ≪ price — showing in sub-pane (declare overlay=false for oscillators)',
        'plot',
      );
    }
  }

  let paneId = 'price';
  if (!overlay) {
    // Always use the stable shared sub-pane id so store.panes, manager, and
    // script.paneId stay aligned (random addPane ids left empty orphan panes).
    paneId = 'indicator';
    if (!manager.getPane(paneId)) {
      addPane('indicator', scriptName, { id: 'indicator', height: 140 });
      manager.createPane(paneId, 'indicator', scriptName, 140);
      manager.syncTimeScales();
    } else {
      try {
        manager.setLabel(paneId, scriptName);
      } catch {
        /* ignore */
      }
    }
    // Drop orphan store panes (legacy random ids) left empty without a manager pane
    for (const p of [...store.panes]) {
      if (
        p.type === 'indicator' &&
        p.id !== 'indicator' &&
        !manager.getPane(p.id) &&
        !store.scripts.some((s) => s.paneId === p.id)
      ) {
        try {
          removePane(p.id);
        } catch {
          /* ignore */
        }
      }
    }
    // Also destroy orphan manager panes that have no scripts
    for (const mp of manager.getAllPanes()) {
      if (
        mp.type === 'indicator' &&
        mp.id !== 'indicator' &&
        !store.scripts.some((s) => s.paneId === mp.id)
      ) {
        try {
          manager.destroyPane(mp.id);
          if (store.panes.some((p) => p.id === mp.id)) removePane(mp.id);
        } catch {
          /* ignore */
        }
      }
    }
  } else if (existing?.paneId && existing.paneId !== 'price' && existing.paneId !== 'volume') {
    // Was a sub-pane script, now true overlay — clear stale series on old pane
    try {
      manager.removeOverlays(existing.paneId);
    } catch {
      /* ignore */
    }
  }

  /**
   * Map engine series → LWC points. Keep **one point per OHLCV bar**.
   * Leading/trailing Pine `na` become whitespace `{ time }` (no value) so the
   * indicator pane has the same logical bar count as price — otherwise
   * multi-pane time sync leaves a permanent gap at the indicator start.
   * Null/NaN/undefined/string "na"/non-finite never produce a numeric value.
   */
  const toLineData = (arr: (number | null)[] | unknown[]) =>
    lineSeriesToOverlayData(ohlcvTimes, arr);

  // Stable overlay sync: update-in-place when keys match (no remove→blank→add flash)
  // value is optional — omit for LWC whitespace (Pine `na` / warmup)
  const overlayLines: Array<{
    name: string;
    data: { time: number; value?: number }[];
    color?: string;
    linewidth?: number;
    kind?: 'plot' | 'hline';
    price?: number;
    linestyle?: string;
  }> = [];
  // Prefer named `series` + `meta.plot_meta` (PYNE modern). Top-level `plots[]`
  // is often an all-null pad of bar length — never let that block named lines.
  // User color overrides from Indicators panel (persisted on the script card)
  const userPlotColors = existing?.plots || {};

  if (seriesEntries.length > 0) {
    let colorIdx = 0;
    for (const [k, arr] of seriesEntries) {
      const meta = plotMeta[k] || {};
      const kindRaw = String(meta?.kind || 'plot');
      const isHline = kindRaw === 'hline';
      const data = toLineData(arr);
      // hline may still apply with price-only meta even if series is sparse
      let price: number | undefined =
        meta?.price != null && Number.isFinite(Number(meta.price))
          ? Number(meta.price)
          : undefined;
      if (price == null && isHline && data.length) {
        const first = data.find((d) => d.value != null && Number.isFinite(d.value));
        if (first?.value != null) price = first.value;
      }
      // Need at least one real sample (or hline price); pure-whitespace series skip
      if (!lineDataHasSample(data) && !(isHline && price != null)) continue;
      // Prefer panel color override → Pine plot color → palette
      const userColor = userPlotColors[k]?.color;
      const color =
        (userColor && String(userColor)) ||
        (meta?.color && String(meta.color)) ||
        PLOT_PALETTE[colorIdx % PLOT_PALETTE.length];
      colorIdx += 1;
      overlayLines.push({
        name: k,
        data,
        color,
        linewidth: meta?.linewidth != null ? Number(meta.linewidth) : undefined,
        kind: isHline ? 'hline' : 'plot',
        price,
        linestyle: meta?.linestyle ? String(meta.linestyle) : undefined,
      });
    }
  } else if (Array.isArray(result.plots) && result.plots.length) {
    // Legacy single-array plots only when no named line series and no specialized kinds.
    // Skip all-null pads (modern engines still send plots: [null, …]).
    if (!split.bgcolors.length && !split.shapes.length) {
      const data = toLineData(result.plots);
      if (lineDataHasSample(data)) {
        const userColor =
          userPlotColors[scriptName]?.color ||
          Object.values(userPlotColors)[0]?.color;
        overlayLines.push({
          name: scriptName,
          data,
          color: (userColor && String(userColor)) || PLOT_PALETTE[0],
        });
      }
    }
  }

  // Empty bars / zero-length plots: still sync empty overlays so stale lines clear
  if (!ohlcvTimes.length && !silent) {
    appendLog('warn', 'Run finished with no bars — chart overlays cleared', 'plot');
  }

  // Chart series mutations isolated — LWC throws must not reject runAndApply
  try {
    manager.syncOverlayLines(paneId, overlayLines);
    // Refresh corner badges (name + settings / eye / re-run / remove)
    try {
      manager.refreshBadges?.(paneId);
      if (paneId !== 'price') manager.refreshBadges?.('price');
    } catch {
      /* badges optional */
    }

    // bgcolor → histogram underlay on price pane (always price; not indicator sub-pane)
    const bgBands = split.bgcolors
      .map(({ key, values, meta }) => ({
        name: key,
        data: bgcolorSeriesToHistogramData(ohlcvTimes, values, meta.color),
      }))
      .filter((b) => b.data.length > 0);
    manager.syncBgcolorBands(bgBands);
    if (bgBands.length && !silent) {
      appendLog('ok', `bgcolor: ${bgBands.length} band series`, 'plot');
    }

    // fill(plot1, plot2, color=…) → SVG band between plot edges on price pane
    const fillBands = resolvePlotFillBands(result.series || {}, plotMeta);
    try {
      const layer = getActiveDrawingLayer();
      if (layer?.setPlotFills) {
        if (fillBands.length) {
          const times = ohlcvTimes.map((t) =>
            Number(t) > 1e12 ? Math.floor(Number(t) / 1000) : Math.floor(Number(t)),
          );
          layer.setPlotFills(
            fillBands.map((f) => ({
              name: f.name,
              times,
              upper: f.upper,
              lower: f.lower,
              colors: f.colors,
              color: f.color,
            })),
          );
          if (!silent) {
            appendLog(
              'ok',
              `fill: ${fillBands.map((f) => `${f.name}(${f.plot1}↔${f.plot2})`).join(', ')}`,
              'plot',
            );
          }
        } else {
          layer.clearPlotFills?.();
        }
      }
    } catch {
      /* drawing layer optional in tests */
    }

    // plotshape / plotchar → markers (merged with strategy markers; never wipe trades)
    const shapeMarkers = split.shapes.flatMap(({ key, values, meta }) =>
      shapeSeriesToMarkers(ohlcvTimes, values, meta, { idPrefix: key }),
    );
    manager.setShapeMarkers(shapeMarkers);
    if (shapeMarkers.length && !silent) {
      appendLog('ok', `plotshape: ${shapeMarkers.length} marker(s)`, 'plot');
    }

    // Non-overlay scripts must not leave series on the price pane
    if (!overlay && paneId !== 'price') {
      const pricePane = manager.getPane('price');
      if (pricePane) {
        for (const line of overlayLines) {
          const key = `overlay_${line.name}`;
          if (pricePane.series[key]) {
            try {
              pricePane.chart.removeSeries(pricePane.series[key]);
            } catch {
              /* ignore */
            }
            delete pricePane.series[key];
          }
        }
      }
    }

    // Strategy: markers on price pane + equity curve + tester stats
    const events = result.events || [];
    const isStrategy =
      scriptType === 'strategy' ||
      events.some((e) => {
        const k = String(
          (e as { kind?: string; type?: string }).kind ||
            (e as { type?: string }).type ||
            '',
        ).toLowerCase();
        return (
          k.includes('entry') ||
          k.includes('exit') ||
          k.includes('close') ||
          k === 'order'
        );
      });
    if (events.length) {
      const normalized = normalizeStrategyEvents(events, {
        bars: store.bars || [],
        includeOrders: false,
      });
      const markers = eventsToMarkers(normalized);
      manager.setTradeMarkers(markers);

      const report = buildStrategyReport(events, store.bars || []);
      if (report.trades.length) {
        const equity = buildEquityCurve(report.trades, 10_000);
        manager.setEquityCurve(equity);
        if (!silent) {
          appendLog(
            'ok',
            `Strategy: ${report.stats.trades} trades · net ${report.stats.totalPnl >= 0 ? '+' : ''}${report.stats.totalPnl.toFixed(2)} · win ${report.stats.winRate.toFixed(0)}% · ${markers.length} markers`,
            'strategy',
          );
          // Surface the Strategy tester tab when this run produced closed trades
          try {
            setStore('resultsPanel', 'open', true);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent('axis-results-tab', { detail: { tab: 'strategy' } }),
              );
            }
          } catch {
            /* optional UI hook */
          }
        }
      } else {
        // Live silent re-runs: skip hide to avoid equity pane thrash
        if (!silent) {
          manager.hideEquityPane();
          if (markers.length || isStrategy) {
            appendLog(
              'ok',
              `Strategy events: ${events.length} raw · ${normalized.length} fills · ${markers.length} markers` +
                (report.trades.length === 0
                  ? ' · no closed trades yet (need entry+exit pair)'
                  : ''),
              'strategy',
            );
          }
        }
      }
    } else if (!silent) {
      // Interactive run with no strategy events — clear trade markers / equity.
      // Silent live re-runs of pure indicators must NOT wipe another script's
      // strategy markers (multi-indicator live thrash).
      if (isStrategy) {
        appendLog(
          'warn',
          'Strategy run returned 0 events — broker never filled (check entry conditions / bars)',
          'strategy',
        );
      }
      manager.setTradeMarkers([]);
      manager.hideEquityPane();
    }

    // Debug pins from logs (bar_index/time) — independent of trade/shape lists
    applyDebugPinsToChart();
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

  // Pine drawings: atomic replace (no clear→empty→set flash).
  // GC trims each type to indicator()/strategy() max_*_count (default 50).
  try {
    const drawings = Array.isArray((result as RunResult & { drawings?: unknown[] }).drawings)
      ? (result as RunResult & { drawings?: unknown[] }).drawings
      : undefined;
    const layer = getActiveDrawingLayer();
    if (drawings?.length) {
      const limits = resolveDrawingLimits(
        script,
        (result.meta as Record<string, unknown> | undefined) ?? null,
      );
      layer?.setScriptDrawings(drawings, limits);
      if (!silent) {
        const normalized = normalizeScriptDrawings(drawings);
        const kept = garbageCollectScriptDrawings(normalized, limits);
        const dropped = normalized.length - kept.length;
        appendLog(
          'ok',
          dropped > 0
            ? `Pine drawings: ${kept.length} object(s) (${dropped} GC'd by max_*_count)`
            : `Pine drawings: ${kept.length} object(s)`,
          'drawings',
        );
      }
    } else if (!silent) {
      // Only clear on interactive full runs when engine returned none
      layer?.clearScriptDrawings();
    }
  } catch {
    /* drawing layer optional in tests */
  }

  // Final epoch gate before store mutations (indicator list / series cache)
  if (!isRunEpochCurrent(epoch)) {
    return {
      ...result,
      meta: { ...result.meta, superseded: true },
    };
  }

  // Capture engine-exported inputs into lastRun meta for Script Settings
  const engineInputs =
    (result as { inputs?: unknown }).inputs ??
    result.meta?.inputs;
  if (engineInputs && result.meta) {
    result.meta = { ...result.meta, inputs: engineInputs };
  }

  // Cache line plots for cross-indicator input.source (exclude hline-only noise)
  const seriesForCache: Record<string, (number | null)[]> = {};
  const titlesForCache: Record<string, string> = {};
  for (const [k, arr] of seriesEntries) {
    seriesForCache[k] = (Array.isArray(arr) ? arr : []) as (number | null)[];
    const meta = plotMeta[k];
    const title = meta?.title != null ? String(meta.title) : k;
    titlesForCache[k] = title;
  }

  if (indicatorId === undefined) {
    const plots: Record<string, { color: string }> = {};
    let colorIdx = 0;
    if (seriesEntries.length) {
      for (const [k] of seriesEntries) {
        const meta = plotMeta[k];
        plots[k] = {
          color:
            (meta?.color && String(meta.color)) ||
            PLOT_PALETTE[colorIdx % PLOT_PALETTE.length],
        };
        colorIdx += 1;
      }
    } else {
      plots[scriptName] = { color: PLOT_PALETTE[0] };
    }
    // Prefer original opts/editor overrides (plot refs), not engine-expanded arrays
    const savedInputs =
      opts.inputs && Object.keys(opts.inputs).length
        ? opts.inputs
        : store.editorInputValues;
    const newId = addIndicator(
      scriptName,
      script,
      paneId,
      plots,
      savedInputs && Object.keys(savedInputs).length ? savedInputs : undefined,
    );
    if (Object.keys(seriesForCache).length) {
      setIndicatorSeries(newId, {
        name: scriptName,
        series: seriesForCache,
        titles: titlesForCache,
      });
    }
  } else if (Object.keys(seriesForCache).length) {
    setIndicatorSeries(indicatorId, {
      name: scriptName,
      series: seriesForCache,
      titles: titlesForCache,
    });
  }

  return result;
}

/** True if endpoint host is loopback (browser = this machine, not the VPS). */
function endpointIsLoopback(endpoint: string): boolean {
  try {
    const u = new URL(endpoint.includes('://') ? endpoint : `http://${endpoint}`);
    const h = u.hostname.toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
  } catch {
    return /localhost|127\.0\.0\.1/.test(endpoint);
  }
}

/** Page is served from a non-loopback host (e.g. VPS demo). */
function pageIsRemote(): boolean {
  if (typeof location === 'undefined') return false;
  const h = location.hostname.toLowerCase();
  return h !== 'localhost' && h !== '127.0.0.1' && h !== '' && h !== '[::1]';
}

/**
 * Probe pyne Pro API health (`GET {endpoint}/`).
 * Surfaces CORS/loopback/remote-host hints for Settings UI.
 */
export async function probeEndpoint(endpoint?: string): Promise<{ ok: boolean; message: string }> {
  const base = (endpoint || store.endpoint || '').replace(/\/$/, '');
  if (!base) {
    return { ok: false, message: 'No Backend URL set' };
  }

  const loopback = endpointIsLoopback(base);
  const remotePage = pageIsRemote();

  try {
    const res = await fetch(`${base}/`, {
      method: 'GET',
      signal: AbortSignal.timeout(8_000),
      mode: 'cors',
    });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status} from ${base}` };
    const text = await res.text();
    let detail = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as { endpoints?: unknown; status?: unknown; service?: string };
      if (j.endpoints || j.status) {
        detail = j.service ? `Pro API reachable (${j.service})` : 'Pro API reachable';
      }
    } catch {
      /* plain text ok */
    }
    if (loopback && remotePage) {
      detail += ' · note: loopback API is on *this* PC, not the VPS';
    }
    return { ok: true, message: detail };
  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : String(e);
    const isNet =
      /networkerror|failed to fetch|load failed|network request failed/i.test(raw) ||
      (e instanceof TypeError && /fetch/i.test(raw));

    if (isNet && loopback) {
      return {
        ok: false,
        message:
          `Cannot reach ${base} (browser → this machine). ` +
          (remotePage
            ? 'AXIS is on a remote host: localhost is *your PC*, not the VPS. ' +
              'Start local pyne on :5002, or set Backend URL to the VPS API ' +
              '(e.g. http://162.254.38.194:5002).'
            : 'Is pyne Pro API running? (cd pyne && make run)'),
      };
    }
    if (isNet) {
      return {
        ok: false,
        message:
          `Cannot reach ${base}. Check: API process up, port open, firewall, ` +
          `CORS ALLOWED_ORIGINS includes this page origin (${typeof location !== 'undefined' ? location.origin : '?'}).`,
      };
    }
    if (/abort|timeout/i.test(raw)) {
      return { ok: false, message: `Timeout probing ${base} (8s)` };
    }
    return { ok: false, message: raw };
  }
}
