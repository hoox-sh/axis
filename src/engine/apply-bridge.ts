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

import type { ExecutionContext } from '../hp/calc/execution-context';
import { v1Gauge, v1Mark } from './v1/metrics';
import type { RunResult } from '../plugins/types';
import type { Bar } from '../store/types';
import { store } from '../store';

export type StreamVia = 'stream-full' | 'stream-delta';

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
}

export interface ApplyStreamInput {
  script: string;
  indicatorId?: string;
  full: StreamFullPayload;
  via: StreamVia;
  /** Exact bar window the payload was evaluated over (chart axis). */
  bars: Bar[];
  silent?: boolean;
}

type RunAndApplyFn = (
  script: string,
  indicatorId: string | undefined,
  opts: Record<string, unknown>,
) => Promise<RunResult>;

/**
 * Convert a merged stream `full` payload into a runner-ready `RunResult`.
 * Pure — safe to unit test without a chart.
 */
export function streamFullToPrecomputed(full: StreamFullPayload, via: StreamVia): RunResult {
  const plots = Array.isArray(full.plots) ? (full.plots as (number | null)[]) : [];
  return {
    status: 'success',
    plots,
    series: full.series ?? {},
    events: full.events ?? [],
    ...(full.drawings ? { drawings: full.drawings } : {}),
    ...(full.bar_times ? { bar_times: full.bar_times } : {}),
    meta: {
      ...(full.meta ?? {}),
      sessionVia: via,
      count: full.count,
      executionContext:
        full.executionContext ?? (via === 'stream-full' ? 'snapshot' : 'append'),
      ...(full.plot_meta ? { plot_meta: full.plot_meta } : {}),
    },
  } as RunResult;
}

/**
 * Apply a stream payload through the existing pipeline without re-running.
 * The runner import is dynamic so this module never creates a static
 * engine↔indicators cycle; pass `deps.runAndApply` in tests.
 */
export async function applyStreamPayload(
  input: ApplyStreamInput,
  deps?: { runAndApply?: RunAndApplyFn },
): Promise<RunResult> {
  const precomputedResult = streamFullToPrecomputed(input.full, input.via);
  // The socket payload carries the values, not the run's metadata. Keep the
  // input descriptors of the script's last full run: the Results panel and
  // the Script Settings modal read them from the run (the socket payload has
  // none, so a live apply would empty the script's input list).
  const prevInputs = previousRunInputs(input.indicatorId);
  if (prevInputs && !precomputedResult.meta?.inputs) {
    precomputedResult.meta = { ...(precomputedResult.meta ?? {}), inputs: prevInputs };
  }
  const run =
    deps?.runAndApply ??
    (await import('../indicators/runner')).runAndApply as unknown as RunAndApplyFn;
  v1Mark('apply:start');
  try {
    return await run(input.script, input.indicatorId, {
      precomputedResult,
      bars: input.bars,
      silent: input.silent ?? true,
      openResults: false,
      liveTick: input.via === 'stream-delta',
    });
  } finally {
    v1Gauge('visibleBars', input.bars.length);
    v1Mark('apply:end');
  }
}

/** Input descriptors of a script's last stored run (empty when unknown). */
function previousRunInputs(indicatorId: string | undefined): unknown[] | undefined {
  if (!indicatorId) return undefined;
  try {
    const results = (store.runResults ?? {}) as Record<
      string,
      { meta?: { inputs?: unknown[] } } | undefined
    >;
    const inputs = results[indicatorId]?.meta?.inputs;
    return Array.isArray(inputs) ? inputs : undefined;
  } catch {
    return undefined;
  }
}
