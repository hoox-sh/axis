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
 * Apply stage 1 — run context + series alignment (F-25).
 *
 * Pure input shaping extracted from `runAndApplyInner`: which bars the engine
 * evaluates, which inputs/strategy overrides apply, and how the resulting
 * series map onto the chart axis (time-join for session/stream windows,
 * index tail-align fallback). No chart or store mutations here.
 *
 * @module indicators/apply-context
 */

import type { Bar } from '../store/types';
import type { RunOptions, RunResult } from './runner';
import { store, EDITOR_RUN_KEY } from '../store';
// NOTE: single documented cycle — runner.ts owns these helpers and imports
// this stage module for orchestration. All cross-uses happen inside function
// bodies at call time (never during module evaluation), so ESM live bindings
// resolve safely under bun/vite/tsc.
import {
  alignSeriesMapToTimes,
  alignSeriesToTimes,
  extractEngineResultTimes,
  getOhlcvTimesForApply,
  resolveInputPrecedence,
  resolveOverlayFlag,
  resolveStrategyPrecedence,
  seriesWouldHideOnPrice,
  tailAlignSeriesMap,
  tailAlignSeriesToWindow,
} from './runner';
import type { PlotMetaEntry } from '../results/plot-visuals';
import { splitSeriesByKind } from '../results/plot-visuals';
import { resolveScriptDisplayName } from './run-target';
import { appendLog } from '../store';

export interface ResolvedRunContext {
  ind:
    { inputValues?: Record<string, unknown>; strategyProps?: Record<string, unknown> } | undefined;
  inputs: Record<string, unknown> | undefined;
  strategyProps: Record<string, unknown>;
  bars: Bar[];
  chartTick: boolean;
}

/**
 * Resolve which bars/inputs/strategy overrides an evaluation uses.
 * Captured up front because `store.bars` can be replaced between capture and
 * evaluation (progressive slices, live appends).
 */
export function resolveRunContext(
  script: string,
  indicatorId: string | undefined,
  opts: RunOptions,
): ResolvedRunContext {
  void script;
  // Prefer explicit opts.inputs / strategyProps; else per-indicator saved; else editor.
  // Empty `{}` is "not provided" — never wipe saved Script Settings.
  const ind = indicatorId ? store.scripts.find((s) => s.id === indicatorId) : undefined;
  const inputs = resolveInputPrecedence(opts.inputs, ind?.inputValues, undefined, false);
  // Explicit bag for this script only — never fall through to editorStrategyProps
  const strategyProps =
    resolveStrategyPrecedence(
      opts.strategyProps,
      ind?.strategyProps,
      !opts.skipEditorDraft ? store.editorStrategyProps : undefined,
      { allowEditorDraft: !indicatorId },
    ) ?? {};
  // Capture the exact bars the engine will evaluate so the resulting series
  // align 1:1 with the time axis we build below. A live tick or an HPO
  // holdout slice must not desync series from bars (see getOhlcvTimesForApply).
  const bars = (
    Array.isArray(opts.bars) && opts.bars.length ? opts.bars : store.bars || []
  ) as Bar[];
  // A live tick is only a chart-series tick when the caller did NOT override
  // the window. Record that here: by the time `runScript` runs, `store.bars`
  // may already be a different array (DSM progressive slices, live appends),
  // so comparing references down there misfires on every turbulent tick.
  const chartTick = opts.liveTick === true && !(Array.isArray(opts.bars) && opts.bars.length);
  return { ind, inputs, strategyProps, bars, chartTick };
}

export interface AlignedApplySeries {
  ohlcvTimes: number[];
  plotMeta: Record<string, PlotMetaEntry>;
  seriesMap: Record<string, unknown[] | (number | null)[]>;
  split: ReturnType<typeof splitSeriesByKind>;
  scriptName: string;
  scriptType: string;
  overlay: boolean;
  needsAlign: boolean;
  resultTimes: number[] | null;
  chartWindowBars: number;
  /**
   * A session/stream run whose engine shipped no bar axis while its series
   * length disagrees with the chart window: a live push over a moved window
   * (gap fill, backfill, slide while the tab was idle), or any run whose
   * length misses the window by more than a few appended bars (a different
   * window, not a race). Index tail-pinning would shift stale values onto
   * new bars and LWC would span the `na` gap as a long diagonal — the apply
   * must be skipped instead so the last good plots stay on screen until a
   * full run with an axis arrives.
   */
  staleNoAxis: boolean;
}

/**
 * Join the engine's series onto the chart axis. Session-backed runs
 * (`meta.sessionVia` containing `session`) and stream-backed runs
 * (`stream-full` / `stream-delta`) evaluate a window that slides independently
 * of the local chart window, so join by bar time when the engine shipped its
 * axis. Equal-length series without an axis keep the index zip; a length
 * mismatch without an axis on a live push (`staleNoAxis`) must NOT tail-pin —
 * the caller skips the apply and keeps the last good plots. A length mismatch
 * with an axis (fresh `/run` vs a chart that grew DSM/forming bars) always
 * aligns so fills/lines/markers zip on the window.
 */
/**
 * Scripts already warned about a session run without an engine bar axis.
 *
 * A session/stream run whose engine ships no axis is tail-pinned onto the
 * chart; the warning must not repeat on every live tick.
 */
const noEngineAxisWarned = new Set<string>();
const staleSkipWarned = new Set<string>();

function warnOnceNoEngineAxis(scriptName: string): void {
  const key = String(scriptName || 'script');
  if (noEngineAxisWarned.has(key)) return;
  noEngineAxisWarned.add(key);
  appendLog(
    'warn',
    'Engine returned no bar axis for a session run — the series is pinned to the chart tail',
    'run',
  );
}

function warnOnceStaleSkip(scriptName: string): void {
  const key = String(scriptName || 'script');
  if (staleSkipWarned.has(key)) return;
  staleSkipWarned.add(key);
  appendLog(
    'warn',
    'Skipped a stale session apply (no bar axis over a moved window) — keeping last good plots',
    'run',
  );
}

/** @internal test helper — clear the warn-once registry. */
export function _resetNoEngineAxisWarnForTests(): void {
  noEngineAxisWarned.clear();
  staleSkipWarned.clear();
}

export function alignApplySeries(
  script: string,
  result: RunResult,
  bars: Bar[],
  opts: { silent: boolean; existingName?: string; livePush?: boolean },
): AlignedApplySeries {
  const ohlcvTimes = getOhlcvTimesForApply(bars);
  const plotMeta = {
    ...((result as { plot_meta?: Record<string, PlotMetaEntry> }).plot_meta || {}),
    ...((result.meta?.plot_meta || {}) as Record<string, PlotMetaEntry>),
  };
  const sessionVia = String(result.meta?.sessionVia || '');
  // Stream-backed runs (`stream-full` / `stream-delta`) evaluate a window the
  // engine owns, exactly like session-backed runs — join by bar time.
  const sessionAligned = sessionVia.includes('session') || sessionVia.startsWith('stream-');
  const chartWindowBars = ohlcvTimes.length;
  const engineWindowBars = Number(result.meta?.windowBars);
  const engineClampedTail =
    Number.isFinite(engineWindowBars) &&
    engineWindowBars > 0 &&
    engineWindowBars !== chartWindowBars;
  const rawSeries = (result.series || {}) as Record<string, unknown[] | (number | null)[]>;
  let lengthMismatch = false;
  let seriesLen = 0;
  for (const arr of Object.values(rawSeries)) {
    if (Array.isArray(arr)) {
      if (arr.length > 0 && arr.length !== chartWindowBars) lengthMismatch = true;
      if (arr.length > seriesLen) seriesLen = arr.length;
    }
  }
  // The legacy `plots[]` fallback is zipped against the chart axis by index,
  // so a length mismatch there mis-plots **every** value (no error, no cue).
  if (!lengthMismatch && Array.isArray(result.plots) && result.plots.length) {
    if (result.plots.length !== chartWindowBars) lengthMismatch = true;
  }
  if (Array.isArray(result.plots) && result.plots.length > seriesLen) {
    seriesLen = result.plots.length;
  }
  /**
   * Tolerance for the fresh-run tail-pin: bars appended (or a forming bar
   * sliding in) while the engine evaluated shift lengths by a handful, and
   * pinning bridges those. Anything beyond it is a *different window*, not a
   * race — pinning would displace every value (a 9577-bar engine window
   * tail-pinned onto a 5000-bar chart shifts the whole overlay by 4577).
   */
  const PIN_TOLERANCE_BARS = 8;
  const grossMismatch =
    lengthMismatch && seriesLen > 0 && Math.abs(seriesLen - chartWindowBars) > PIN_TOLERANCE_BARS;
  const needsAlignBase = sessionAligned || engineClampedTail || lengthMismatch;
  // A same-length series can still cover a **different** window: a session or
  // stream that slides independently of the chart. The index zip would then
  // mis-plot every value, so the engine's own axis decides when the windows
  // disagree. Only checked when the engine actually shipped an axis — the
  // common bars-in run does not, and stays on the cheap index path.
  const engineTimes = needsAlignBase ? null : extractEngineResultTimes(result);
  const engineLast = engineTimes?.length ? engineTimes[engineTimes.length - 1]! : null;
  const chartLast = ohlcvTimes.length ? ohlcvTimes[ohlcvTimes.length - 1]! : null;
  const windowMismatch = engineLast != null && chartLast != null && engineLast !== chartLast;
  const needsAlign = needsAlignBase || windowMismatch;
  const resultTimes = needsAlign ? (engineTimes ?? extractEngineResultTimes(result)) : null;
  // A session/stream run whose engine shipped **no** bar axis cannot be
  // time-joined. On a **live push** over a *shorter* series than the chart,
  // tail-pin would misplace values (gap/slide diagonals) — skip and keep
  // last good plots until a full with an axis arrives.
  // When the engine series is **longer** than the chart (common: replica /
  // DSM holds 20k while the rolling window is 5k), tail-clamp is safe: take
  // the newest `chartWindowBars` values onto the painted tip. When it is
  // **shorter** (a 500-bar script snapshot on a 5000-bar rolling window), head
  // pad with `null` so the newest values land on the newest bars instead of
  // skipping the whole apply — that used to leave indicators frozen on every
  // live push (`skipped: 'stale-no-axis'`) until the snapshot outgrew the
  // window. `tailAlignSeriesMap` handles both directions.
  // Fresh full evaluations keep the small-mismatch tail-pin; gross shorter
  // or unknown windows still skip. Free-tier `windowBars` still clamps.
  const canTailClampLive = opts.livePush === true && lengthMismatch && chartWindowBars > 0;
  const staleNoAxis =
    sessionAligned &&
    !resultTimes &&
    lengthMismatch &&
    !engineClampedTail &&
    !canTailClampLive &&
    (opts.livePush === true || grossMismatch);
  const seriesMap = staleNoAxis
    ? rawSeries
    : !needsAlign
      ? rawSeries
      : resultTimes
        ? alignSeriesMapToTimes(rawSeries, resultTimes, ohlcvTimes)
        : tailAlignSeriesMap(rawSeries, chartWindowBars);
  // When a named series ends in `na` (the backend evaluated history but not
  // the forming candle), fill that trailing run from the legacy `plots[]`
  // array, which the backend always ships complete. Series are head-padded
  // by `tailAlignSeriesMap` (`tailAlignSeriesToWindow`), so a short series
  // already keeps its newest value on the newest bar; this only fills an
  // explicit trailing `na`, never a positional shift.
  if (result.plots && Array.isArray(result.plots) && result.plots.length > 0 && seriesMap) {
    const plotsAligned = !needsAlign
      ? result.plots
      : resultTimes
        ? alignSeriesToTimes(result.plots, resultTimes, ohlcvTimes)
        : tailAlignSeriesToWindow(result.plots, chartWindowBars);
    for (const arr of Object.values(seriesMap)) {
      if (!Array.isArray(arr)) continue;
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] == null || arr[i] === undefined) {
          const plotVal = plotsAligned[i];
          if (plotVal != null && Number.isFinite(plotVal)) {
            arr[i] = plotVal;
          } else {
            break;
          }
        }
      }
    }
  }
  // A session/stream run whose engine shipped **no** bar axis is tail-pinned
  // onto the chart only when the window is unchanged (see `staleNoAxis`).
  if (sessionAligned && !resultTimes && !staleNoAxis) {
    warnOnceNoEngineAxis(resolveScriptDisplayName(script, undefined));
  } else if (staleNoAxis) {
    warnOnceStaleSkip(resolveScriptDisplayName(script, undefined));
  }
  const split = splitSeriesByKind(seriesMap, plotMeta);
  if (engineClampedTail && !sessionAligned && !opts.silent) {
    appendLog(
      'info',
      `Engine bar cap: evaluated newest ${Math.round(engineWindowBars)} bars (free tier)`,
      'run',
    );
  }

  // Line-like series only — bgcolor/plotshape handled below
  const seriesEntries = split.lines.map((e) => [e.key, e.values] as const);

  // Pine: indicator defaults overlay=false; strategy defaults overlay=true.
  // Explicit false must never be coerced to true.
  const overlayFlag = result.meta?.overlay as unknown;
  const overlayExplicitTrue = overlayFlag === true || overlayFlag === 1 || overlayFlag === 'true';
  let overlay = resolveOverlayFlag(overlayFlag, scriptTypeOf(result));

  // Oscillator-scale plots (RSI, MACD, …) on the price pane are effectively
  // invisible (values ~0–100 vs BTC price). Auto-demote to a sub-pane UNLESS
  // the script explicitly asked for overlay=true (respect the author's intent).
  if (overlay && !overlayExplicitTrue && seriesWouldHideOnPrice(seriesEntries, bars)) {
    overlay = false;
    if (!opts.silent) {
      appendLog(
        'info',
        'Plot scale ≪ price — showing in sub-pane (declare overlay=false for oscillators)',
        'plot',
      );
    }
  }

  const existingName = opts.existingName;
  const scriptName = resolveScriptDisplayName(
    script,
    result.meta?.script_name != null ? String(result.meta.script_name) : null,
    existingName,
  );
  return {
    ohlcvTimes,
    plotMeta,
    seriesMap,
    split,
    scriptName,
    scriptType: scriptTypeOf(result),
    overlay,
    needsAlign,
    resultTimes,
    chartWindowBars,
    staleNoAxis,
  };
}

function scriptTypeOf(result: RunResult): string {
  return String(
    (result.meta as { script_type?: string } | undefined)?.script_type ||
      (result.meta as { kind?: string } | undefined)?.kind ||
      '',
  ).toLowerCase();
}
