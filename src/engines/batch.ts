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
 * PYNE `POST /run/batch` — evaluate several scripts over one OHLCV window.
 *
 * Reapplying a chart with several applied indicators costs one round-trip per
 * script today; the backend can take up to {@link RUN_BATCH_MAX_SCRIPTS} at once
 * on shared bars. The request deliberately mirrors the single-run REST body
 * (`src/engines/catalog.ts` maps the same envelope) with `scripts: [{id, script}]`
 * instead of `script`, and returns one result object per script.
 *
 * The endpoint has no per-script `inputs`, so callers must keep scripts with
 * resolved `input.*` overrides on the single-run path. Route availability is
 * discovered the same way as the rest of AXIS: `runBatch` returns `null` on a
 * missing route so callers fall back without treating it as a failure.
 *
 * @module engines/batch
 */

import type { PlotSample, RunResult as EngineRunResult } from '../plugins/types';
import type { Bar } from '../store/types';
import { barsForPine } from '../data/parse-bars';
import { parseEngineJson } from './json-sanitize';

/**
 * Engine result with the `series` / `plots` the chart-apply path requires
 * (structurally the runner's `RunResult`, without importing the runner from the
 * engines layer).
 */
export type BatchRunResult = EngineRunResult & {
  series: Record<string, PlotSample[]>;
  plots: (number | null)[];
};

/** Backend hard cap per batch (`RUN_BATCH_MAX_SCRIPTS`). */
export const RUN_BATCH_MAX_SCRIPTS = 8;

/** Generous budget: N scripts share one compile/interpret pass over the window. */
const DEFAULT_TIMEOUT_MS = 180_000;

export interface BatchScript {
  /** Caller-stable id echoed back per result (an applied indicator id). */
  id: string;
  script: string;
}

export interface BatchRunOptions {
  endpoint: string;
  apiKey?: string;
  scripts: readonly BatchScript[];
  bars: readonly Bar[];
  symbol?: string;
  /** Mode sent for every script (`auto` lets the backend choose). */
  mode?: string;
  libraries?: unknown[];
  profiler?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface BatchEntry {
  id: string;
  ok: boolean;
  /** Present when `ok` — normalized exactly like a single REST run. */
  result?: BatchRunResult;
  /** Per-script failure reason (`EXECUTION_ERROR`, timeout, …). */
  error?: string;
}

export interface BatchRunOutcome {
  entries: BatchEntry[];
  /** Every requested script produced a usable result. */
  allOk: boolean;
  /** Backend-reported data source (`chart` unless it resolved something else). */
  dataSource: string | null;
  /** Envelope-level failure (bad request, transport, error body). */
  error: string | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Same envelope mapping as the single-run REST path (`catalog.mapRestPayload`). */
function mapEntryResult(payload: Record<string, unknown>, ms: number): BatchRunResult {
  const overlayRaw = payload.overlay ?? (payload.meta as Record<string, unknown> | undefined)?.overlay;
  const name =
    payload.script_name ||
    (payload.meta as Record<string, unknown> | undefined)?.script_name ||
    'plot';
  return {
    status: 'success',
    plots: (payload.plots as (number | null)[]) || [],
    series: (payload.series as BatchRunResult["series"]) || {},
    events: (payload.events as BatchRunResult['events']) || [],
    drawings: (payload.drawings as BatchRunResult['drawings']) || [],
    inputs: payload.inputs,
    ...(isRecord(payload.profile) ? { profile: payload.profile } : {}),
    ...(Array.isArray(payload.logs) ? { logs: payload.logs as BatchRunResult["logs"] } : {}),
    meta: {
      ...(isRecord(payload.meta) ? payload.meta : {}),
      ms,
      transport: 'rest',
      mode: payload.mode as string | undefined,
      script_id: payload.script_id as string | undefined,
      run_id: payload.run_id as string | undefined,
      ...(typeof overlayRaw === 'boolean' ? { overlay: overlayRaw } : {}),
      script_name: String(name),
      plot_meta:
        (payload.plot_meta as Record<string, unknown>) ||
        ((payload.meta as Record<string, unknown> | undefined)?.plot_meta as
          | Record<string, unknown>
          | undefined) ||
        {},
      inputs: payload.inputs,
      ...(Array.isArray(payload.alerts) ? { alerts: payload.alerts } : {}),
      ...(Array.isArray(payload.alert_conditions)
        ? { alert_conditions: payload.alert_conditions }
        : {}),
      ...(isRecord(payload.profile) ? { profile: payload.profile } : {}),
      ...(Array.isArray(payload.logs) ? { logs: payload.logs } : {}),
      batch: true,
    },
  };
}

function requestSignal(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return parent && typeof AbortSignal.any === 'function'
    ? AbortSignal.any([timeout, parent])
    : timeout;
}

/**
 * Evaluate `scripts` over `bars` in one request.
 *
 * @returns `null` when the endpoint has no batch route (404/405/501) or the
 *   input is unusable — callers then run each script through the normal path.
 *   A transport or envelope failure returns an outcome with `error` set so the
 *   caller can decide (AXIS falls back rather than surfacing it).
 */
export async function runBatch(opts: BatchRunOptions): Promise<BatchRunOutcome | null> {
  const endpoint = String(opts.endpoint || '')
    .trim()
    .replace(/\/$/, '');
  const scripts = (opts.scripts || []).filter(
    (s) => s && typeof s.id === 'string' && s.id && typeof s.script === 'string' && s.script.trim(),
  );
  if (!endpoint || !scripts.length || !opts.bars?.length) return null;
  if (scripts.length > RUN_BATCH_MAX_SCRIPTS) return null;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = String(opts.apiKey || '').trim();
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const body = {
    scripts: scripts.map((s) => ({ id: s.id, script: s.script })),
    data: barsForPine(opts.bars as Bar[]),
    symbol: opts.symbol || 'CHART',
    mode: opts.mode || 'auto',
    ...(opts.libraries?.length ? { libraries: opts.libraries } : {}),
    ...(opts.profiler ? { profiler: true } : {}),
  };

  let res: Response;
  const t0 = performance.now();
  try {
    res = await fetch(`${endpoint}/run/batch`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: requestSignal(opts.signal, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    if (opts.signal?.aborted) throw err;
    return { entries: [], allOk: false, dataSource: null, error: 'batch request failed' };
  }

  // No batch route on this backend — the caller keeps the per-script path.
  if (res.status === 404 || res.status === 405 || res.status === 501) return null;

  const text = await res.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    const j: unknown = text.trim() ? parseEngineJson(text) : null;
    if (isRecord(j)) parsed = j;
  } catch {
    parsed = null;
  }
  if (!parsed) {
    return { entries: [], allOk: false, dataSource: null, error: `HTTP ${res.status}` };
  }
  if (!res.ok || parsed.status === 'error') {
    const message =
      typeof parsed.message === 'string' && parsed.message ? parsed.message : `HTTP ${res.status}`;
    return { entries: [], allOk: false, dataSource: null, error: message };
  }

  const rawResults = Array.isArray(parsed.results) ? parsed.results : [];
  const byId = new Map<string, BatchEntry>();
  // One wall time for the whole batch — every script shared the same pass.
  const ms = performance.now() - t0;
  for (const raw of rawResults) {
    if (!isRecord(raw)) continue;
    const id = typeof raw.id === 'string' && raw.id ? raw.id : '';
    if (!id) continue;
    if (raw.status === 'error') {
      byId.set(id, {
        id,
        ok: false,
        error:
          typeof raw.message === 'string' && raw.message
            ? raw.message
            : 'script execution failed',
      });
      continue;
    }
    byId.set(id, { id, ok: true, result: mapEntryResult(raw, ms) });
  }

  const entries: BatchEntry[] = scripts.map(
    (s) => byId.get(s.id) ?? { id: s.id, ok: false, error: 'no result returned' },
  );
  return {
    entries,
    allOk: entries.every((e) => e.ok),
    dataSource: typeof parsed.data_source === 'string' ? parsed.data_source : null,
    error: null,
  };
}
