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
 * **Indicator / strategy runner** — evaluate Pine via the active engine and
 * apply results to chart panes, markers, and script drawings.
 *
 * ## Flow
 *
 * 1. {@link runScript} — resolve {@link getActiveEngine}, call `engine.run`,
 *    update engine telemetry / latency (no chart mutation).
 * 2. {@link runAndApply} — then map result onto {@link PaneManager}:
 *    - line/hline series from `series` + `plot_meta`
 *    - plotbar/plotcandle OHLC overlays
 *    - bgcolor histograms, plotshape markers
 *    - strategy trade markers (equity curve stays in Results → Strategy panel)
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
  updateIndicator,
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
  newEntityId,
} from '../store';
import { resolveInputSourceValues } from '../results/plot-sources';
import { applyStrategyPropsToSource } from '../results/strategy-props';
import {
  getManager,
  getDrawingLayer,
  ensureScriptPaneLayer,
  applyDebugPinsToChart,
} from '../chart/manager-access';
import { PLOT_PALETTE } from '../chart/series-factory';
import { normalizeStrategyEvents, eventsToMarkers } from '../results/events';
import { buildStrategyReport } from '../results/strategy';
import {
  bgcolorSeriesToHistogramData,
  barcolorSeriesToMap,
  lineSeriesToOverlayData,
  ohlcSeriesToBarData,
  PLOT_DISPLAY,
  plotDisplayHas,
  resolvePlotFillBands,
  shapeSeriesToMarkers,
  splitSeriesByKind,
  type PlotMetaEntry,
} from '../results/plot-visuals';
import { resolvePineColor } from '../results/pine-color';
import { getActiveDrawingLayer } from '../chart/drawing-layer';
import {
  garbageCollectScriptDrawings,
  normalizeScriptDrawings,
  resolveDrawingLimits,
} from '../chart/pyne-drawings';
import { getActiveEngine, getActiveEngineConfig } from '../plugins/active';
import { isEngineOwnedLive } from '../engines/ownership';
import { exchangeForSource } from '../data/symbol-exchange';
import type { RunResult as EngineRunResult, PlotSample } from '../plugins/types';
import { classifyTransport } from '../ui/telemetry';
import { reportUiError } from '../ui/boot-errors';
import { isScriptRunBlocked } from '../editor/preevaluate';
import {
  beginRunEpoch,
  claimRunStatus,
  formatRunError,
  isInteractiveRunInFlight,
  isRunEpochCurrent,
  lineDataHasSample,
  normalizeEngineResult,
  ownsRunStatus,
  releaseRunStatus,
  type NormalizedRunResult,
} from './run-helpers';
import { resolveScriptDisplayName } from './run-target';
import { buildOverlayPayloads, type OverlayLine, type OverlayOhlc } from './apply-overlays';
import { applyChartMutations } from './apply-mutations';
import { applyStrategyMarkers } from './apply-strategy';
import { appliedScriptStillOnChart, applyDrawings } from './apply-drawings';
import { updateIndicatorStore } from './apply-store';
import { resolveRunContext, alignApplySeries } from './apply-context';
import { ensureApplyPane } from './apply-pane';import { detectScriptKind } from './script-meta';
import { notifyPineAlertsFromRun } from '../alerts/pine-bridge';

/** Engine result with `series` always present (empty object if missing). */
export type RunResult = EngineRunResult & {
  series: Record<string, PlotSample[]>;
  plots: (number | null)[];
};

/**
 * Cache OHLCV time axis for chart apply — live every-tick updates often keep
 * the same length + last time (open bar), so skip O(n) rebuild of times[].
 */
let ohlcvTimesCache: {
  gen: number;
  times: number[];
  barsRef?: unknown;
} | null = null;

/** @internal test helper */
export function _resetOhlcvTimesCacheForTests(): void {
  ohlcvTimesCache = null;
}

/**
 * Cap the bars handed to the engine to the most recent N
 * ({@link AppState.rollingWindowBars}).
 *
 * The dataset keeps the full Historical bars depth — this only bounds evaluate time, the
 * encode payload, and the size of the response envelope. Plot apply is safe:
 * overlay points are keyed by **time**, not by index into `store.bars`
 * (`lineSeriesToOverlayData`), so a windowed run lands on its own axis and
 * simply covers the recent range.
 *
 * Explicit `opts.bars` (HPO holdout / walk-forward) is windowed too — it is
 * already a deliberate slice, so the cap is redundant there and skipping it
 * would let a trial quietly exceed the user's budget.
 */
export function applyRollingWindow(
  bars: import('../store/types').Bar[],
): import('../store/types').Bar[] {
  const limit = store.rollingWindowBars;
  if (!Number.isFinite(limit) || limit <= 0) return bars;
  if (bars.length <= limit) return bars;
  return bars.slice(bars.length - limit);
}

/**
 * Tail-align one series array to the chart window length (`ohlcvTimes.length`).
 *
 * Session-backed runs (`meta.sessionVia` containing `session`: engine-owned
 * `data-session-*` series and live-evaluation `session-*` hits) evaluate a bar
 * window that slides independently of `store.bars`, so the response series can
 * be longer, shorter, or offset from the chart axis. Every apply-path zip is
 * index-based (`lineSeriesToOverlayData`, markers, barcolors, fills), so — when
 * no engine bar-time axis is available for {@link alignSeriesToTimes} — the
 * tail must be pinned to the newest bar; a longer series is trimmed, a shorter
 * one head-padded with `null` (Pine `na` whitespace).
 */
export function tailAlignSeriesToWindow(values: unknown, len: number): unknown[] {
  const arr = Array.isArray(values) ? values : [];
  if (len <= 0 || arr.length === 0 || arr.length === len) return arr;
  if (arr.length > len) return arr.slice(arr.length - len);
  return [...new Array(len - arr.length).fill(null), ...arr];
}

/** Tail-align every series in a `result.series` map (see {@link tailAlignSeriesToWindow}). */
export function tailAlignSeriesMap(
  series: Record<string, unknown[] | (number | null)[]>,
  len: number,
): Record<string, unknown[] | (number | null)[]> {
  const out: Record<string, unknown[] | (number | null)[]> = {};
  for (const [key, arr] of Object.entries(series)) {
    out[key] = tailAlignSeriesToWindow(arr, len);
  }
  return out;
}

/**
 * Coerce one bar/plot time to LWC unix seconds.
 * Pine-ms (>1e12) → floor(ms/1000); non-finite → null.
 */
function normalizeEngineTime(t: unknown): number | null {
  if (t == null) return null;
  if (typeof t === 'boolean') return null;
  const n = typeof t === 'number' ? t : Number(t);
  if (!Number.isFinite(n)) return null;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

/** Normalize a candidate time list to unix seconds, or null when unusable. */
function normalizeTimeList(v: unknown): number[] | null {
  if (!Array.isArray(v) || !v.length) return null;
  const out: number[] = [];
  for (const t of v) {
    const n = normalizeEngineTime(t);
    if (n != null) out.push(n);
  }
  return out.length ? out : null;
}

/** Bar times from a `bars`-shaped payload field (objects or `[t, …]` tuples). */
function timesFromBars(v: unknown): number[] | null {
  if (!Array.isArray(v) || !v.length) return null;
  const raw: unknown[] = [];
  for (const b of v) {
    if (Array.isArray(b)) {
      if (b.length) raw.push(b[0]);
      continue;
    }
    if (b && typeof b === 'object') {
      const rec = b as Record<string, unknown>;
      raw.push(rec.time ?? rec.t ?? rec.timestamp);
    }
  }
  return normalizeTimeList(raw);
}

/**
 * Engine bar-time axis for a run result, when the backend shipped one.
 *
 * Checks `meta.engineTimes` first (stamped by the engine client from the
 * payload's `times` / `bar_times` / `bars` fields or from the live-session's
 * evaluated window), then loose top-level / `meta` fields. Times may be unix
 * seconds or Pine-ms — both normalize to chart seconds. Null when the result
 * carries no usable axis (index tail-align remains the fallback).
 */
export function extractEngineResultTimes(result: unknown): number[] | null {
  if (!result || typeof result !== 'object') return null;
  const rec = result as Record<string, unknown>;
  const meta =
    rec.meta && typeof rec.meta === 'object' && !Array.isArray(rec.meta)
      ? (rec.meta as Record<string, unknown>)
      : null;
  const lists: unknown[] = [
    meta?.engineTimes,
    meta?.times,
    meta?.bar_times,
    meta?.barTimes,
    rec.times,
    rec.bar_times,
    rec.barTimes,
  ];
  for (const c of lists) {
    const norm = normalizeTimeList(c);
    if (norm) return norm;
  }
  for (const c of [meta?.bars, rec.bars]) {
    const fromBars = timesFromBars(c);
    if (fromBars) return fromBars;
  }
  return null;
}

/**
 * Join one series array onto the chart window by **bar time**.
 *
 * Builds a `resultTime → value` map (duplicate stamps: last wins) and emits
 * one entry per chart time; chart bars the engine never evaluated become
 * `null` (Pine `na` whitespace) and engine values for bars outside the chart
 * window are dropped. Unlike pure index tail-align this stays correct when the
 * engine series is longer AND newer than the chart (a newer engine tip must
 * not be pinned onto an older chart bar).
 *
 * Falls back to {@link tailAlignSeriesToWindow} when there is no usable engine
 * axis, or when the axis does not describe this series 1:1 (length mismatch) —
 * the index fallback is the only option left for time-less payloads.
 */
export function alignSeriesToTimes(
  values: unknown,
  resultTimes: readonly unknown[] | null | undefined,
  chartTimes: readonly number[],
): unknown[] {
  const len = chartTimes.length;
  const arr = Array.isArray(values) ? values : [];
  const rt = normalizeTimeList(resultTimes);
  if (!rt || rt.length !== arr.length) {
    return tailAlignSeriesToWindow(arr, len);
  }
  const byTime = new Map<number, unknown>();
  for (let i = 0; i < rt.length; i++) byTime.set(rt[i] as number, arr[i]);
  const out: unknown[] = new Array(len);
  for (let i = 0; i < len; i++) {
    const t = normalizeEngineTime(chartTimes[i]);
    out[i] = t != null && byTime.has(t) ? byTime.get(t) : null;
  }
  return out;
}

/** Join every series in a `result.series` map by bar time (see {@link alignSeriesToTimes}). */
export function alignSeriesMapToTimes(
  series: Record<string, unknown[] | (number | null)[]>,
  resultTimes: readonly unknown[],
  chartTimes: readonly number[],
): Record<string, unknown[] | (number | null)[]> {
  const out: Record<string, unknown[] | (number | null)[]> = {};
  for (const [key, arr] of Object.entries(series)) {
    out[key] = alignSeriesToTimes(arr, resultTimes, chartTimes);
  }
  return out;
}

/**
 * Bar times aligned with `store.bars` for plot apply.
 * Reuses the prior array when chartDataGen + length + last time are unchanged.
 *
 * Pass `barsInput` (the exact bars the engine evaluated) to keep a series
 * aligned to its own time axis — e.g. an HPO holdout / walk-forward slice that
 * is NOT `store.bars`. Only a genuinely different axis takes the override path;
 * when `barsInput` is `store.bars` itself (the common case) the cache is reused.
 */
export function getOhlcvTimesForApply(
  barsInput?: import('../store/types').Bar[],
): number[] {
  const isOverride = !!barsInput && barsInput !== store.bars;
  const bars = (isOverride ? barsInput : store.bars) || [];
  const gen = typeof store.chartDataGen === 'number' ? store.chartDataGen : 0;
  const n = bars.length;
  const lastT = n ? Number(bars[n - 1]?.time) : Number.NaN;

  // Override path: build directly, never cache (see doc above).
  if (isOverride) {
    const times = new Array<number>(n);
    for (let i = 0; i < n; i++) times[i] = bars[i]?.time as number;
    return times;
  }

  // Invalidate when the store.bars reference changed (a data refresh that
  // preserves length + last time would otherwise return a stale axis).
  if (
    ohlcvTimesCache &&
    ohlcvTimesCache.barsRef === store.bars &&
    ohlcvTimesCache.gen === gen &&
    ohlcvTimesCache.times.length === n &&
    (n === 0 || ohlcvTimesCache.times[n - 1] === lastT)
  ) {
    return ohlcvTimesCache.times;
  }

  // Append path: new closed bar on same history generation
  if (
    ohlcvTimesCache &&
    ohlcvTimesCache.barsRef === store.bars &&
    ohlcvTimesCache.gen === gen &&
    ohlcvTimesCache.times.length === n - 1 &&
    n > 0 &&
    Number.isFinite(lastT)
  ) {
    const next = ohlcvTimesCache.times.slice();
    next.push(lastT);
    ohlcvTimesCache = { gen, times: next, barsRef: store.bars };
    return next;
  }

  const times = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    times[i] = bars[i]?.time as number;
  }
  ohlcvTimesCache = { gen, times, barsRef: store.bars };
  return times;
}

export type { NormalizedRunResult };
export {
  beginRunEpoch,
  claimRunStatus,
  coercePlotSample,
  currentRunEpoch,
  formatRunError,
  isInteractiveRunInFlight,
  isRunEpochCurrent,
  lineDataHasSample,
  normalizeBarTime,
  normalizeEngineResult,
  normalizeSeriesMap,
  ownsRunStatus,
  releaseRunStatus,
  seriesValuesToLineData,
  _resetRunEpochForTests,
} from './run-helpers';

/**
 * End interactive Run status for this epoch: ready/error when still current,
 * or clear stuck `running` when superseded by a newer **interactive** Run.
 * Silent live re-runs defer instead of superseding (see {@link runAndApply}).
 */
function finishInteractiveStatus(
  epoch: number | undefined,
  silent: boolean,
  next: 'ready' | 'error',
  message: string,
): void {
  if (silent) return;
  if (epoch == null || isRunEpochCurrent(epoch)) {
    setStatus(next, message);
    releaseRunStatus(epoch ?? null);
    return;
  }
  // Superseded by a newer interactive Run: only clear if we still own Running…
  if (ownsRunStatus(epoch) && store.status === 'running') {
    setStatus('ready', 'Run superseded');
    releaseRunStatus(epoch);
  }
}

/** Soft-skip payload when a silent re-run defers to an interactive Run. */
function deferredSilentResult(): RunResult {
  return {
    status: 'success',
    plots: [],
    series: {},
    events: [],
    meta: { deferred: true, ms: 0 },
  };
}

/** After interactive Run ends, flush live re-runs that were deferred. */
function flushDeferredLiveRerun(): void {
  if (!store.live?.active || !store.live?.needsRerun) return;
  void import('../streams/multiplex')
    .then((m) => {
      m.scheduleLiveRerun?.();
    })
    .catch(() => {
      /* multiplex optional during tests */
    });
}

/** Non-empty plain bag, else undefined (empty `{}` is "not provided"). */
export function nonemptyBag(
  v?: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  return Object.keys(v).length ? v : undefined;
}

type InputBag = Record<string, unknown> | undefined | null;

/**
 * Single precedence resolver for Pine input bags.
 * Order: explicit opts → applied-script saved → editor draft. Empty `{}` is
 * "not provided" at every level. (Unifies `runScript` and `runAndApplyInner`.)
 */
export function resolveInputPrecedence(
  explicit: InputBag,
  saved: InputBag,
  editorDraft: InputBag,
  allowEditorDraft: boolean,
): Record<string, unknown> | undefined {
  return (
    nonemptyBag(explicit) ??
    nonemptyBag(saved) ??
    (allowEditorDraft ? nonemptyBag(editorDraft) : undefined)
  );
}

export interface StrategyPropsPrecedenceOpts {
  /** The editor draft may be used as the last resort. */
  allowEditorDraft?: boolean;
  /** An explicit bag (even `{}`) is authoritative and wins immediately. */
  emptyExplicitWins?: boolean;
}

/**
 * Single precedence resolver for `strategy()` property bags.
 * Explicit opts win (optionally even when empty); then the applied-script
 * saved bag; then the editor draft. Undefined when every source is empty.
 * (Unifies `runScript` and `runAndApplyInner`.)
 */
export function resolveStrategyPrecedence(
  explicit: InputBag,
  saved: InputBag,
  editorDraft: InputBag,
  opts?: StrategyPropsPrecedenceOpts,
): Record<string, unknown> | undefined {
  if (explicit !== undefined && (opts?.emptyExplicitWins || nonemptyBag(explicit))) {
    return explicit ?? undefined;
  }
  return (
    nonemptyBag(saved) ?? (opts?.allowEditorDraft ? nonemptyBag(editorDraft) : undefined)
  );
}

/** Options shared by {@link runScript} and {@link runAndApply}. */
export interface RunOptions {
  /** Quiet status bar / fewer log lines (live re-runs) */
  silent?: boolean;
  /** Open Results drawer after run (default true when not silent) */
  openResults?: boolean;
  /** Pine input.* overrides keyed by title (Script Settings) */
  inputs?: Record<string, unknown>;
  /**
   * Catalog / library apply: do not inherit the editor input or strategy draft.
   * Empty `inputs: {}` is still “not provided” for applied-script re-runs.
   */
  skipEditorDraft?: boolean;
  /** Applied indicator id — used to resolve saved inputValues / strategyProps. */
  indicatorId?: string;
  /**
   * Strategy Properties overrides keyed by `strategy()` kwarg
   * (`initial_capital`, `pyramiding`, …). Merged into a run-time source copy.
   * Explicit bag is authoritative, including `{}` (no rewrite). Omitted
   * (`undefined`) falls back to the applied script, then the editor draft
   * (editor fallback is skipped for isolate / applied-script studies).
   */
  strategyProps?: Record<string, unknown>;
  /**
   * When false, do not advance the concurrent-run epoch (nested calls).
   * Prefer {@link RunOptions.epoch} when nesting under {@link runAndApply}.
   */
  claimEpoch?: boolean;
  /**
   * Existing run epoch from {@link runAndApply}. When set, skip claiming a
   * new epoch and use this for supersession checks (status / telemetry).
   * `runAndApply` honors it too: pass one shared epoch for a concurrent
   * silent batch (reapply / live reruns) so members do not supersede each
   * other — each call would otherwise claim its own epoch and all but the
   * last would skip chart apply. An interactive Run that starts mid-batch
   * still claims a newer epoch and supersedes the whole batch, as before.
   */
  epoch?: number;
  /**
   * Headless evaluation (HPO trials). Skips epoch, status bar, and engine HUD.
   * Does not write `lastRun`. Implies `silent` + `claimEpoch: false`.
   */
  isolate?: boolean;
  /** Abort in-flight `engine.run` (Cancel on an optimisation study). */
  signal?: AbortSignal;
  /**
   * Bar window override. When set, used instead of `store.bars` so holdout /
   * walk-forward slices do not mutate the chart series.
   */
  bars?: import('../store/types').Bar[];
  /**
   * Marks a genuine live tick (only the newest bar's data changed). When true,
   * the chart apply may use the tip-only smart-apply optimization. When false /
   * omitted (interactive run, input/script recompute, manual reapply), the
   * chart forces a full `setData` so the whole series repaints — an input
   * override changes every bar, not just the tip.
   */
  liveTick?: boolean;
  /**
   * Live-session owner (indicator id / editor run key). `runAndApply` sets it
   * for chart-series ticks so remote engines keep one session per script
   * instance instead of one per symbol/interval.
   */
  liveSessionOwner?: string;
  /**
   * Result already produced by the engine for this script.
   *
   * Set by callers that evaluated several scripts in one `POST /run/batch`
   * round-trip (`src/engines/batch.ts`): the normal apply path (panes,
   * overlays, drawings, alerts, lastRun) runs unchanged, only the evaluation is
   * skipped. Never set for isolate / HPO / walk-forward runs.
   */
  precomputedResult?: RunResult;
}

type PyneLogLine = { level?: string; message?: string; [k: string]: unknown };

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
    logs = meta.logs as PyneLogLine[];
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

/** Stamp the Pine source so editor last-run marks drop after the buffer changes. */
export function withAxisSource(result: RunResult, script: string): RunResult {
  return {
    ...result,
    meta: { ...result.meta, axisSource: script },
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
  const isolate = !!opts.isolate;
  const silent = !!opts.silent || isolate;
  // Prefer caller epoch (runAndApply); else claim unless claimEpoch: false.
  const epoch = isolate
    ? undefined
    : opts.epoch != null
      ? opts.epoch
      : opts.claimEpoch === false
        ? undefined
        : beginRunEpoch();
  if (!silent) {
    setStatus('running', 'Executing Pine Script…');
    claimRunStatus(epoch);
  }
  const t0 = performance.now();

  // Pre-eval gate: refuse when this exact script still has static errors in the
  // editor buffer. Live re-runs of applied indicators use stored code and usually
  // won't match `preEval.source`; interactive Run always matches.
  if (!silent && !isolate) {
    const pe = store.preEval;
    if (
      pe &&
      !pe.pending &&
      pe.hasErrors &&
      pe.source === script &&
      isScriptRunBlocked()
    ) {
      const msg = 'Script has errors — fix them in the editor before running';
      setTelemetryState('engine', 'error', { error: msg });
      finishInteractiveStatus(epoch, silent, 'error', msg);
      return {
        status: 'error',
        plots: [],
        series: {},
        events: [],
        error: msg,
        meta: {
          ms: 0,
          blocked: 'preeval',
          diagnostics: pe.diagnostics,
        },
      };
    }
  }

  const bars = Array.isArray(opts.bars) && opts.bars.length ? opts.bars : store.bars;
  // Engine-owned live mode (PYNE Pro every-tick): the engine's store provides
  // the bars, so a local window is neither required nor sent. Isolate studies
  // always keep the explicit-bars path.
  const engineOwned = isEngineOwnedLive() && !isolate;
  if (!engineOwned && (!Array.isArray(bars) || bars.length === 0)) {
    const msg = 'No bars loaded — load a symbol before running';
    // Only touch status if this generation is still current
    if (!isolate && (epoch == null || isRunEpochCurrent(epoch))) {
      if (silent) appendLog('error', `Live re-run: ${msg}`, 'live');
      setTelemetryState('engine', 'error', { error: msg });
      finishInteractiveStatus(epoch, silent, 'error', msg);
    } else if (!isolate) {
      finishInteractiveStatus(epoch, silent, 'error', msg);
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
    const mode = String(config.mode || 'auto');
    if (!isolate) {
      setTelemetryPlane('engine', {
        id: engine.id,
        name: engine.name,
        transport,
        state: 'connecting',
        detail: mode,
        error: null,
      });
    }
    // Soft outer budget for status messaging only — engines manage their own
    // AbortSignal.timeout for HTTP (WS probe + REST fallback must not share a
    // short parent abort). We still surface timeout wording via formatRunError.
    void (silent
      ? 60_000
      : Math.min(180_000, Math.max(90_000, 45_000 + bars.length * 40)));
    // Prefer explicit opts → applied indicator saved values → editor draft
    const indicatorId = opts.indicatorId;
    const applied =
      typeof indicatorId === 'string' && indicatorId
        ? store.scripts.find((s) => s.id === indicatorId)
        : undefined;
    const rawInputs = resolveInputPrecedence(
      opts.inputs,
      applied?.inputValues,
      store.editorInputValues,
      !indicatorId && !opts.skipEditorDraft,
    );
    // Expand plot:<indicatorId>:<plotKey> refs → full series arrays for the engine
    const inputs = resolveInputSourceValues(rawInputs, store.indicatorSeries);
    // Strategy Properties: rewrite strategy() kwargs on a run-time copy only.
    // Explicit opts.strategyProps (including {}) wins — empty bag = no rewrite.
    // Isolate studies already bake props into source; never merge editor leftovers.
    const strategyProps = resolveStrategyPrecedence(
      opts.strategyProps,
      applied?.strategyProps,
      store.editorStrategyProps,
      {
        allowEditorDraft: !indicatorId && !isolate && !opts.skipEditorDraft,
        emptyExplicitWins: true,
      },
    );
    const scriptForEngine = applyStrategyPropsToSource(script, strategyProps);
    let engineLibraries: import('../plugins/types').EngineLibrarySource[] | undefined;
    try {
      const { resolveLibrariesForScript, publishLibrary } = await import(
        '../storage/library-publish-io'
      );
      const { detectScriptKind } = await import('../indicators/script-meta');
      if (detectScriptKind(scriptForEngine) === 'library') {
        void publishLibrary(scriptForEngine, { origin: 'auto' }).then((pub) => {
          if (pub.skipped) return;
          appendLog(
            'ok',
            `Published ${pub.library.namespace}/${pub.library.name}/${pub.library.version}` +
              (pub.remote ? ' → git' : ' (local cache)'),
            'library',
          );
        }).catch((e: unknown) => {
          appendLog(
            'warn',
            `Library auto-publish skipped: ${e instanceof Error ? e.message : String(e)}`,
            'library',
          );
        });
      }
      const resolved = await resolveLibrariesForScript(scriptForEngine);
      if (resolved.libraries.length) engineLibraries = resolved.libraries;
      if (resolved.missing.length && !silent) {
        const miss = resolved.missing.map((s) => `${s.namespace}/${s.name}/${s.version}`).join(', ');
        appendLog('warn', `Unresolved import ${miss} — publish the library or check git`, 'library');
      }
    } catch {
      /* publish / resolve optional */
    }
    const windowBars = applyRollingWindow(bars);
    const rawResult = await engine.run({
      script: scriptForEngine,
      bars: engineOwned ? [] : windowBars,
      config,
      inputs,
      ...(engineLibraries?.length ? { libraries: engineLibraries } : {}),
      // Engine-owned series: identity only, never bars. The engine's store and
      // feed own the OHLCV; a live tick re-ticks the per-script session.
      ...(engineOwned
        ? {
            dataSession: {
              exchange: exchangeForSource(store.source),
              symbol: store.symbol,
              interval: store.interval,
              historyBars: Math.max(1, windowBars.length || 5_000),
            },
          }
        : {}),
      // Honour caller abort (HPO cancel). Interactive runs still omit a parent
      // timer so WS→REST fallback is not killed mid-flight.
      signal: isolate ? opts.signal : undefined,
      // Genuine live tick over the chart series: remote engines with live
      // sessions (PYNE 0.6.9+) may answer O(delta). `runAndApply` strips this
      // flag for private bar windows, so by the time it arrives here it always
      // means the live chart series (never an HPO holdout / walk-forward).
      // Isolate studies keep the full path.
      ...(opts.liveTick === true && !isolate
        ? {
            liveTick: true,
            ...(opts.liveSessionOwner ? { liveSessionOwner: opts.liveSessionOwner } : {}),
          }
        : {}),
    });

    const ms =
      (typeof rawResult?.meta?.ms === 'number' && Number.isFinite(rawResult.meta.ms)
        ? rawResult.meta.ms
        : null) ?? performance.now() - t0;
    // Normalize first so callers always get stable series/plots shapes
    const result = normalizeEngineResult(rawResult, ms);
    // Superseded by a newer run — keep payload; clear stuck Running… if we own it
    if (epoch != null && !isRunEpochCurrent(epoch)) {
      finishInteractiveStatus(epoch, silent, 'ready', 'Run superseded');
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
        finishInteractiveStatus(epoch, silent, 'error', msg);
        return {
          ...result,
          series: result.series || {},
          plots: result.plots || [],
          events: result.events || [],
          meta: { ...result.meta, ms, superseded: true },
        };
      }
      if (!isolate) {
        setTelemetryState('engine', 'error', {
          error: msg,
          latencyMs: ms,
          detail: mode,
          transport: runTransport,
        });
        if (silent) appendLog('error', `Live re-run failed: ${msg}`, 'live');
      }
      finishInteractiveStatus(epoch, silent, 'error', msg);
      return {
        ...result,
        series: result.series || {},
        plots: result.plots || [],
        events: result.events || [],
        meta: { ...result.meta, ms },
      };
    }
    if (epoch != null && !isRunEpochCurrent(epoch)) {
      finishInteractiveStatus(epoch, silent, 'ready', 'Run superseded');
      return {
        ...result,
        series: result.series || {},
        plots: result.plots || [],
        events: result.events || [],
        meta: {
          ...result.meta,
          ms,
          overlay: result.meta?.overlay ?? true,
          script_name: resolveScriptDisplayName(
            script,
            result.meta?.script_name != null ? String(result.meta.script_name) : null,
          ),
          superseded: true,
        },
      };
    }
    if (!isolate) {
      setTelemetryState('engine', 'open', {
        latencyMs: ms,
        detail: `${mode} · ${runTransport} · ${ms.toFixed(0)}ms`,
        error: null,
        transport: runTransport,
      });
    }
    finishInteractiveStatus(epoch, silent, 'ready', `Completed in ${ms.toFixed(0)}ms`);
    return {
      ...result,
      series: result.series || {},
      plots: result.plots || [],
      events: result.events || [],
      meta: {
        ...result.meta,
        ms,
        overlay: result.meta?.overlay ?? true,
        script_name: resolveScriptDisplayName(
          script,
          result.meta?.script_name != null ? String(result.meta.script_name) : null,
        ),
      },
    };
  } catch (err: unknown) {
    const ms = performance.now() - t0;
    recordRunLatency(ms);
    // Superseded mid-flight: quiet return (winner owns status bar)
    if (epoch != null && !isRunEpochCurrent(epoch)) {
      finishInteractiveStatus(epoch, silent, 'ready', 'Run superseded');
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
    if (!isolate) {
      setTelemetryState('engine', 'error', { error: msg, latencyMs: ms });
      if (silent) appendLog('error', `Live re-run: ${msg}`, 'live');
    }
    finishInteractiveStatus(epoch, silent, 'error', msg);
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
 *
 * **Never rejects** — engine failures, disposed charts, and LWC throws become
 * `status: 'error'` or logged apply failures so `void runAndApply(...)` call
 * sites cannot produce unhandled rejections.
 */
export async function runAndApply(
  script: string,
  indicatorId?: string,
  opts: RunOptions = {},
): Promise<RunResult> {
  const silent = !!opts.silent;
  const openResults = opts.openResults ?? !silent;

  // Live/silent must not cancel an in-flight interactive Run (MTF RSI /
  // request.security can take seconds). Defer and re-schedule after it finishes.
  if (silent && isInteractiveRunInFlight()) {
    setStore('live', 'needsRerun', true);
    return deferredSilentResult();
  }

  // Hidden scripts are not executed (live loop + silent reapply). Interactive
  // Run while hidden turns the script back on first.
  if (indicatorId) {
    const applied = store.scripts.find((s) => s.id === indicatorId);
    if (applied && applied.visible === false) {
      if (silent) {
        return {
          status: 'success',
          plots: [],
          series: {},
          events: [],
          meta: { skipped: 'hidden', ms: 0 },
        };
      }
      try {
        const { setScriptChartVisible } = await import('./visibility');
        setScriptChartVisible(indicatorId, true);
      } catch {
        /* store-only fallback */
        try {
          const { updateIndicator } = await import('../store');
          updateIndicator(indicatorId, { visible: true });
        } catch {
          /* ignore */
        }
      }
    }
  }

  const epoch = opts.epoch ?? beginRunEpoch();

  try {
    const result = await runAndApplyInner(
      script,
      indicatorId,
      opts,
      epoch,
      silent,
      openResults,
    );
    return result;
  } catch (e: unknown) {
    // Last-resort fence: callers use void runAndApply / fire-and-forget.
    const msg = formatRunError(e);
    if (isRunEpochCurrent(epoch)) {
      reportUiError(e, {
        source: 'run',
        context: 'Run apply failed',
        status: !silent,
      });
      if (silent) appendLog('error', `Run apply failed: ${msg}`, 'live');
      else finishInteractiveStatus(epoch, silent, 'error', msg);
    } else {
      finishInteractiveStatus(epoch, silent, 'error', msg);
    }
    const superseded = !isRunEpochCurrent(epoch);
    return {
      status: 'error',
      plots: [],
      series: {},
      events: [],
      error: msg,
      meta: superseded ? { superseded: true } : {},
    };
  } finally {
    // Never leave interactive Run stuck on Running… after this generation ends
    if (!silent && ownsRunStatus(epoch) && store.status === 'running') {
      setStatus('ready', 'Run finished', { toast: true, source: 'run' });
      releaseRunStatus(epoch);
    }
    // Interactive done → allow deferred live re-runs (latest bars)
    if (!silent) flushDeferredLiveRerun();
  }
}

async function runAndApplyInner(
  script: string,
  indicatorId: string | undefined,
  opts: RunOptions,
  epoch: number,
  silent: boolean,
  openResults: boolean,
): Promise<RunResult> {
  const { inputs, strategyProps, bars, chartTick } = resolveRunContext(script, indicatorId, opts);
  // Pass epoch so nested runScript can skip status/telemetry if superseded mid-flight
  const raw = opts.precomputedResult
    ? opts.precomputedResult
    : await runScript(script, {
        ...opts,
        bars,
        inputs,
        strategyProps,
        claimEpoch: false,
        epoch,
        ...(chartTick
          ? { liveSessionOwner: opts.liveSessionOwner ?? indicatorId ?? EDITOR_RUN_KEY }
          : { liveTick: false }),
      });
  const result = normalizeRunExtras(raw);

  // Stale completion — never clobber newer lastRun / chart
  if (!isRunEpochCurrent(epoch)) {
    return {
      ...result,
      meta: { ...result.meta, superseded: true },
    };
  }

  // Per-script cache. Silent / live re-runs pass focus:false so they do
  // not rewrite Script logs or Results. Live ticks also skip durable
  // saveResult — otherwise Saved runs grows by one row per second.
  setLastRun(withAxisSource(result, script), {
    scriptId: indicatorId ?? EDITOR_RUN_KEY,
    focus: !silent,
    persistence: silent || opts.liveTick ? 'skip' : 'auto',
  });
  if (openResults && detectScriptKind(script) === 'strategy' && store.resultsAutoOpen) {
    setStore('resultsPanel', 'open', true);
  }
  // Do not auto-open Scriptlogs aggressively; panel is user-toggled.
  if (result.status === 'error') return result;

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

  // Hide / detach after the engine returned: do not resurrect plots.
  if (indicatorId && !appliedScriptStillOnChart(indicatorId)) {
    try {
      const { clearScriptChartOverlays } = await import('./visibility');
      clearScriptChartOverlays(indicatorId);
    } catch {
      /* chart optional */
    }
    return {
      ...result,
      meta: { ...result.meta, skipped: 'hidden' },
    };
  }

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
  // Always prefer Pine indicator()/strategy()/library() title over engine meta
  // (engine often sends "plot") or a stale file-based existing name.
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
  } = alignApplySeries(script, result, bars, { silent, existingName: existing?.name });
  // Line-like series only — bgcolor/plotshape handled below
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
  // User color overrides from Scripts panel (persisted on the script card)
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
    return {
      ...result,
      meta: { ...result.meta, superseded: true },
    };
  }
  // Stale after building large overlay payloads — skip LWC mutations
  if (!isRunEpochCurrent(epoch)) {
    return {
      ...result,
      meta: { ...result.meta, superseded: true },
    };
  }
  const { overlayLines, overlayOhlc } = overlayBuilt as {
    overlayLines: OverlayLine[];
    overlayOhlc: OverlayOhlc[];
  };

  // Hide / detach after the engine returned: do not resurrect plots.
  if (indicatorId && !appliedScriptStillOnChart(indicatorId)) {
    try {
      const { clearScriptChartOverlays } = await import('./visibility');
      clearScriptChartOverlays(indicatorId);
    } catch {
      /* chart optional */
    }
    return {
      ...result,
      meta: { ...result.meta, skipped: 'hidden' },
    };
  }

  // Chart series mutations isolated — LWC throws / disposed panes must not reject
  try {
    if (!isRunEpochCurrent(epoch)) {
      return {
        ...result,
        meta: { ...result.meta, superseded: true },
      };
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
      // Owner-scoped keys so multi-script live re-runs do not wipe each other.
      // Force a full redraw unless this is a genuine live tick: an input/script
      // recompute changes every bar, so the tip-only smart-apply must not skip
      // the history (see pane-manager applyOverlayLineDataSmart).
      applyChartMutations({
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
        forceFull: opts.liveTick !== true,
      });
      applyStrategyMarkers({ manager, result, scriptType, silent, indicatorId });

      // Debug pins from logs (bar_index/time) — independent of trade/shape lists
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
      opts,
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
    return {
      ...result,
      meta: { ...result.meta, superseded: true },
    };
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
 * Probe pyne Pro API health.
 * Prefer `GET {endpoint}/health` (same-origin SPA leaves `/` as the HTML shell),
 * then fall back to `GET {endpoint}/` for standalone Flask hosts.
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
    let lastStatus = 0;
    let detail = '';
    let gotApiJson = false;

    for (const path of ['/health', '/'] as const) {
      const res = await fetch(`${base}${path}`, {
        method: 'GET',
        signal: AbortSignal.timeout(8_000),
        mode: 'cors',
      });
      lastStatus = res.status;
      if (!res.ok) continue;
      const text = await res.text();
      detail = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text) as {
          endpoints?: unknown;
          status?: unknown;
          service?: string;
        };
        if (j.endpoints || j.status || j.service) {
          detail = j.service ? `Pro API reachable (${j.service})` : 'Pro API reachable';
          gotApiJson = true;
          break;
        }
      } catch {
        /* HTML SPA shell or plain text — try next path */
      }
    }

    if (!gotApiJson) {
      if (lastStatus && lastStatus !== 200) {
        return { ok: false, message: `HTTP ${lastStatus} from ${base}` };
      }
      return {
        ok: false,
        message:
          `No Pro API health JSON at ${base}/health (or /). ` +
          `If this is the AXIS host, nginx must proxy /run and /health to pyne.`,
      };
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
              'Start local pyne on :5002, or set Backend URL to https://pynescript.online ' +
              '(PYNE Pro API).'
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
