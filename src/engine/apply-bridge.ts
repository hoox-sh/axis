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
 * Stream → apply bridge (F-16).
 *
 * Converts a merged engine-owned `full` payload (first snapshot or a delta
 * merged by `Redesign2DeltaApplier`) into a `precomputedResult` the existing
 * apply pipeline consumes — no engine re-run. `runAndApply` is invoked with
 * the caller's bar window so series align to the chart axis. A stream
 * snapshot paints the whole series. A stream delta keeps `liveTick` so the
 * chart updates the tip only.
 *
 * `sessionVia` is tagged `stream-full` / `stream-delta` so the runner's
 * session time-join treats stream series like any session-backed window.
 *
 * @module engine/apply-bridge
 */

import {
  executionContextFromDelta,
  isExecutionContext,
  type ExecutionContext,
} from '../hp/calc/execution-context';
import { applyPrecomputedChart } from '../indicators/apply-live';
import { engineDebug } from '../debug';
import type { RunResult } from '../plugins/types';
import type { RunOptions } from '../indicators/runner';
import type { Bar } from '../store/types';
import { axisStamp, windowAxisFromBars } from '../results/window-axis';
import { store } from '../store';

/**
 * Which stream frame produced a payload: a full snapshot or a tail delta. Decides the apply
 * execution context and whether the run counts as a live tick.
 */
export type StreamVia = 'stream-full' | 'stream-delta';

/**
 * A merged `/ws/live` payload (full snapshot or delta already spliced onto the cache):
 * plots/series/events plus the engine's bar-time axis and the count that identifies the
 * session version. Crosses the wire → apply boundary.
 */
export interface StreamFullPayload {
  plots?: unknown;
  series?: Record<string, unknown[]>;
  bar_times?: number[];
  count: number;
  events?: RunResult['events'];
  drawings?: Array<Record<string, unknown>>;
  plot_meta?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  /** Stamped by the delta applier: snapshot vs tip scratch vs append commit. */
  executionContext?: ExecutionContext;
  /** Forming tip flag from the wire / applier when `executionContext` is absent. */
  forming?: boolean;
}

/**
 * Resolve the apply execution context for a stream payload.
 *
 * Stream deltas must not keep a leftover `snapshot` stamp — the series→script
 * kick reuses `applier.cached` after `applyFull`, and that stamp would skip the
 * tip cache and re-align ~5k bars every tick. Missing context falls back to
 * `forming` / count via {@link executionContextFromDelta} (same-length → tip).
 */
export function resolveStreamExecutionContext(
  full: StreamFullPayload,
  via: StreamVia,
): ExecutionContext {
  if (via === 'stream-full') return 'snapshot';
  const raw = full.executionContext;
  if (raw === 'snapshot') return 'tip';
  if (isExecutionContext(raw)) return raw;
  return executionContextFromDelta({ forming: full.forming, count: full.count });
}

/**
 * One apply request: the script/indicator to attribute the run to, the payload, the path it
 * arrived by, and the exact chart window it was evaluated over.
 */
export interface ApplyStreamInput {
  script: string;
  indicatorId?: string;
  full: StreamFullPayload;
  via: StreamVia;
  /** Exact bar window the payload was evaluated over (chart axis). */
  bars: Bar[];
  silent?: boolean;
}

/**
 * Injected runner entry point — the real `runAndApply` signature, so the
 * dynamic import below needs no assertion.
 */
type RunAndApplyFn = (
  script: string,
  indicatorId: string | undefined,
  opts: RunOptions,
) => Promise<RunResult>;

/**
 * Convert a merged stream `full` payload into a runner-ready `RunResult`.
 * Pure — safe to unit test without a chart.
 *
 * @param bars - Exact bar window the payload was evaluated over. Used to stamp
 *   the run's window axis (`results/window-axis`) so an index-only event or a
 *   `xloc.bar_index` drawing from the stream can be anchored to absolute time.
 */
export function streamFullToPrecomputed(
  full: StreamFullPayload,
  via: StreamVia,
  bars?: Bar[] | null,
): RunResult {
  const plots = Array.isArray(full.plots) ? (full.plots as (number | null)[]) : [];
  // Prefer the engine's own axis when it shipped one (`bar_times`), else the
  // chart window the caller evaluated over.
  const engineTimes = Array.isArray(full.bar_times) ? (full.bar_times as number[]) : null;
  const fallbackTimes =
    !engineTimes?.length && Array.isArray(bars) && bars.length
      ? bars
          .map((b) => b.time)
          .filter((t): t is number => typeof t === 'number' && Number.isFinite(t))
      : null;
  const axisTimes = engineTimes?.length ? engineTimes : fallbackTimes;
  const axis = axisTimes?.length
    ? windowAxisFromBars(axisTimes.map((time) => ({ time })))
    : windowAxisFromBars(bars ?? null);
  const incomingMeta =
    full.plot_meta ??
    (full.meta && typeof full.meta === 'object'
      ? (full.meta as { plot_meta?: Record<string, unknown> }).plot_meta
      : undefined);
  return {
    status: 'success',
    plots,
    series: full.series ?? {},
    events: full.events ?? [],
    ...(full.drawings ? { drawings: full.drawings } : {}),
    ...(full.bar_times ? { bar_times: full.bar_times } : {}),
    meta: {
      ...(full.meta ?? {}),
      ...axisStamp(axis),
      sessionVia: via,
      count: full.count,
      executionContext: resolveStreamExecutionContext(full, via),
      ...(incomingMeta ? { plot_meta: incomingMeta } : {}),
      ...(axisTimes?.length && !engineTimes?.length ? { engineTimes: axisTimes } : {}),
    },
  } as RunResult;
}

/**
 * Apply a stream **delta** without yielding. Plot paint is synchronous
 * (`applyPrecomputedChart`); snapshots stay on {@link applyStreamPayload}.
 */
export function applyStreamDelta(
  input: ApplyStreamInput,
  deps?: { applyChart?: typeof applyPrecomputedChart },
): RunResult {
  const precomputedResult = streamFullToPrecomputed(input.full, input.via, input.bars);
  // Tip deltas reuse the cached descriptors; avoid a store walk every tick.
  const ctx = precomputedResult.meta?.['executionContext'];
  enrichPrecomputedFromPreviousRun(precomputedResult, input.indicatorId, ctx !== 'tip');
  const applyChart = deps?.applyChart ?? applyPrecomputedChart;
  return applyChart(input.script, input.indicatorId, precomputedResult as never, input.bars, {
    silent: input.silent ?? true,
    liveTick: true,
  });
}

/**
 * Apply a stream payload through the existing pipeline without re-running.
 * Snapshots stay async (`runAndApply`). Live deltas use {@link applyStreamDelta}.
 * Pass `deps.runAndApply` in tests.
 */
export async function applyStreamPayload(
  input: ApplyStreamInput,
  deps?: { runAndApply?: RunAndApplyFn },
): Promise<RunResult> {
  engineDebug('apply.payload', {
    via: input.via,
    indicatorId: input.indicatorId ?? null,
    count: input.full.count,
    bars: input.bars.length,
    liveTick: input.via === 'stream-delta',
    context: input.full.executionContext ?? null,
  });
  const precomputedResult = streamFullToPrecomputed(input.full, input.via, input.bars);
  // The socket payload carries the values, not the run's metadata. Keep the
  // input descriptors / fill plot_meta of the script's last full run so a live
  // tip cannot empty Results inputs or wipe Donchian SVG bands.
  enrichPrecomputedFromPreviousRun(
    precomputedResult,
    input.indicatorId,
    input.via === 'stream-full',
  );
  const run: RunAndApplyFn =
    deps?.runAndApply ?? (await import('../indicators/runner')).runAndApply;
  return await run(input.script, input.indicatorId, {
    // The runner types `series`/`plots` as always present; `streamFullToPrecomputed`
    // sets both, so the stream result already matches its precomputed shape.
    precomputedResult: precomputedResult as RunOptions['precomputedResult'],
    bars: input.bars,
    silent: input.silent ?? true,
    openResults: false,
    liveTick: input.via === 'stream-delta',
  });
}

/** Per-script input descriptors — refreshed on snapshot / non-tip deltas. */
const runInputsCache = new Map<string, unknown[]>();
/** Per-script plot_meta — keep fill() entries across tip frames that omit them. */
const runPlotMetaCache = new Map<string, Record<string, unknown>>();

/** @internal test helper — drop cached input / plot_meta descriptors. */
export function _clearApplyBridgeCachesForTests(): void {
  runInputsCache.clear();
  runPlotMetaCache.clear();
}

/**
 * Union stream plot_meta with the last known run. Live tip/full frames often
 * drop `kind: fill` entries while Upper/Lower series remain — without this
 * merge, apply clears the SVG band and Donchian fills vanish after the tip.
 */
export function mergeStreamPlotMeta(
  incoming: Record<string, unknown> | undefined,
  previous: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!previous || !Object.keys(previous).length) return incoming;
  if (!incoming || !Object.keys(incoming).length) return { ...previous };
  const out: Record<string, unknown> = { ...previous, ...incoming };
  for (const [key, value] of Object.entries(previous)) {
    if (key in incoming || !value || typeof value !== 'object') continue;
    const kind = String((value as { kind?: unknown }).kind || '').toLowerCase();
    if (kind === 'fill') out[key] = value;
  }
  return out;
}

/** Preserve last-run inputs and fill plot_meta across stream applies. */
function enrichPrecomputedFromPreviousRun(
  precomputedResult: RunResult,
  indicatorId: string | undefined,
  refresh: boolean,
): void {
  const prevInputs = previousRunInputs(indicatorId, { refresh });
  if (prevInputs && !precomputedResult.meta?.inputs) {
    precomputedResult.meta = { ...(precomputedResult.meta ?? {}), inputs: prevInputs };
  }
  const mergedPlotMeta = mergeStreamPlotMeta(
    precomputedResult.meta?.['plot_meta'] as Record<string, unknown> | undefined,
    previousRunPlotMeta(indicatorId, { refresh }),
  );
  if (mergedPlotMeta) {
    precomputedResult.meta = { ...(precomputedResult.meta ?? {}), plot_meta: mergedPlotMeta };
  }
}

/** Input descriptors of a script's last stored run (empty when unknown). */
function previousRunInputs(
  indicatorId: string | undefined,
  opts?: { refresh?: boolean },
): unknown[] | undefined {
  if (!indicatorId) return undefined;
  if (!opts?.refresh) {
    const cached = runInputsCache.get(indicatorId);
    if (cached) return cached;
  }
  try {
    const results = (store.runResults ?? {}) as Record<
      string,
      { meta?: { inputs?: unknown[] } } | undefined
    >;
    const inputs = results[indicatorId]?.meta?.inputs;
    if (Array.isArray(inputs)) {
      runInputsCache.set(indicatorId, inputs);
      return inputs;
    }
    runInputsCache.delete(indicatorId);
    return undefined;
  } catch {
    return undefined;
  }
}

/** plot_meta of a script's last stored run (fill edges survive tip frames). */
function previousRunPlotMeta(
  indicatorId: string | undefined,
  opts?: { refresh?: boolean },
): Record<string, unknown> | undefined {
  if (!indicatorId) return undefined;
  if (!opts?.refresh) {
    const cached = runPlotMetaCache.get(indicatorId);
    if (cached) return cached;
  }
  try {
    const results = (store.runResults ?? {}) as Record<
      string,
      {
        meta?: { plot_meta?: Record<string, unknown> };
        plot_meta?: Record<string, unknown>;
      } | undefined
    >;
    const entry = results[indicatorId];
    const meta = entry?.meta?.plot_meta ?? entry?.plot_meta;
    if (meta && typeof meta === 'object' && Object.keys(meta).length) {
      runPlotMetaCache.set(indicatorId, meta);
      return meta;
    }
    runPlotMetaCache.delete(indicatorId);
    return undefined;
  } catch {
    return undefined;
  }
}
