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
  extractEngineResultTimes,
  getOhlcvTimesForApply,
  resolveInputPrecedence,
  resolveOverlayFlag,
  resolveStrategyPrecedence,
  seriesWouldHideOnPrice,
  tailAlignSeriesMap,
} from './runner';
import type { PlotMetaEntry } from '../results/plot-visuals';
import { splitSeriesByKind } from '../results/plot-visuals';
import { resolveScriptDisplayName } from './run-target';
import { appendLog } from '../store';

export interface ResolvedRunContext {
  ind: { inputValues?: Record<string, unknown>; strategyProps?: Record<string, unknown> } | undefined;
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
  const bars = (Array.isArray(opts.bars) && opts.bars.length ? opts.bars : store.bars || []) as Bar[];
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
}

/**
 * Join the engine's series onto the chart axis. Session-backed runs
 * (`meta.sessionVia` containing `session`) and stream-backed runs
 * (`stream-full` / `stream-delta`) evaluate a window that slides independently
 * of the local chart window, so join by bar time when the engine shipped its
 * axis; otherwise pin the tail (index fallback). Equal-length series pass
 * through untouched. A length mismatch (fresh `/run` vs a chart that grew
 * DSM/forming bars) always aligns so fills/lines/markers zip on the window.
 */
export function alignApplySeries(
  script: string,
  result: RunResult,
  bars: Bar[],
  opts: { silent: boolean; existingName?: string },
): AlignedApplySeries {
  const ohlcvTimes = getOhlcvTimesForApply(bars);
  const plotMeta = {
    ...(((result as { plot_meta?: Record<string, PlotMetaEntry> }).plot_meta) || {}),
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
  for (const arr of Object.values(rawSeries)) {
    if (Array.isArray(arr) && arr.length > 0 && arr.length !== chartWindowBars) {
      lengthMismatch = true;
      break;
    }
  }
  const needsAlignBase = sessionAligned || engineClampedTail || lengthMismatch;
  // A same-length series can still cover a **different** window: a session or
  // stream that slides independently of the chart. The index zip would then
  // mis-plot every value, so the engine's own axis decides when the windows
  // disagree. Only checked when the engine actually shipped an axis — the
  // common bars-in run does not, and stays on the cheap index path.
  const engineTimes = needsAlignBase ? null : extractEngineResultTimes(result);
  const engineLast = engineTimes?.length ? engineTimes[engineTimes.length - 1]! : null;
  const chartLast = ohlcvTimes.length ? ohlcvTimes[ohlcvTimes.length - 1]! : null;
  const windowMismatch =
    engineLast != null && chartLast != null && engineLast !== chartLast;
  const needsAlign = needsAlignBase || windowMismatch;
  const resultTimes = needsAlign ? (engineTimes ?? extractEngineResultTimes(result)) : null;
  const seriesMap = !needsAlign
    ? rawSeries
    : resultTimes
      ? alignSeriesMapToTimes(rawSeries, resultTimes, ohlcvTimes)
      : tailAlignSeriesMap(rawSeries, chartWindowBars);
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
  const overlayExplicitTrue =
    overlayFlag === true || overlayFlag === 1 || overlayFlag === 'true';
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
  return { ohlcvTimes, plotMeta, seriesMap, split, scriptName, scriptType: scriptTypeOf(result), overlay, needsAlign, resultTimes, chartWindowBars };
}

function scriptTypeOf(result: RunResult): string {
  return String(
    (result.meta as { script_type?: string } | undefined)?.script_type ||
      (result.meta as { kind?: string } | undefined)?.kind ||
      '',
  ).toLowerCase();
}
