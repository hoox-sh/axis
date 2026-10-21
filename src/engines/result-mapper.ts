// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The shared run-result envelope mapper.
 *
 * The engine result arrived over the REST path, the WebSocket path and the
 * batch path, and each built the same envelope with its own copy of the
 * body — plus a byte-identical copy of the bar-time-axis extractor.
 *
 * One mapper now builds the envelope. The differences between the paths are
 * stated per call site rather than hidden inside three copies:
 *
 * - the WS path resolves the run mode server-side, so the caller passes the
 *   resolved value;
 * - the REST path infers `script_type` from the payload kind; the WS and
 *   batch paths do not;
 * - the batch path only accepts a real boolean `overlay`, while the REST and
 *   WS paths also accept `0` / `1` / `'0'` / `'false'`.
 *
 * @module engines/result-mapper
 */

import type { PlotSample, RunResult } from '../plugins/types';

/** How `meta.script_type` is derived from the payload. */
export type ScriptTypePolicy =
  /** Payload, then meta, then a `strategy` inference from `meta.kind`. */
  | 'payload+meta+kind'
  /** Only an explicit `meta.script_type`. */
  | 'meta'
  /** Never set. */
  | 'none';

/** How `meta.overlay` is derived from the payload. */
export type OverlayPolicy =
  /** bool, `0`/`1`, `'0'`/`'false'` — `undefined` means "not specified". */
  | 'normalized'
  /** Only a real boolean; anything else is treated as "not specified". */
  | 'boolean-only';

/** Options for {@link mapEnginePayload}. */
export interface MapEnginePayloadOptions {
  /** Transport the result arrived over — stamped into `meta.transport`. */
  transport: 'rest' | 'ws' | 'local';
  /** Wall-clock duration of the run, in ms. */
  ms: number;
  /** Mode stamped into `meta.mode`. The WS path resolves it server-side. */
  mode?: string | undefined;
  /** The run is part of a batch — stamps `meta.batch`. */
  batch?: boolean;
  /** Include the engine bar-time axis in `meta.engineTimes`. */
  engineTimes?: boolean;
  /** How `meta.script_type` is derived. Defaults to `none`. */
  scriptType?: ScriptTypePolicy;
  /** How `meta.overlay` is derived. Defaults to `normalized`. */
  overlay?: OverlayPolicy;
}

/** True for a plain object (not an array, not null). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Normalize engine `overlay` flags. Runtimes may send bool or 0/1.
 * `undefined` means "not specified" (the runner applies defaults).
 */
export function normalizeOverlayFlag(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  return v !== false && v !== 0 && v !== '0' && v !== 'false';
}

/**
 * Raw engine bar-time axis when the backend ships one alongside `series`
 * (top-level `times` / `bar_times` / `barTimes`, or a `bars` time column).
 *
 * Returned un-normalized (unix seconds or Pine-ms); the indicator runner
 * normalizes to chart seconds when it joins session series by time
 * (`extractEngineResultTimes`). Undefined when the payload carries no axis —
 * session hits then fall back to the evaluated window's own times.
 */
export function payloadEngineTimes(payload: unknown): unknown[] | undefined {
  if (!isRecord(payload)) return undefined;
  for (const key of ['times', 'bar_times', 'barTimes'] as const) {
    const v = payload[key];
    if (Array.isArray(v) && v.length) return v as unknown[];
  }
  const bars = payload.bars;
  if (Array.isArray(bars) && bars.length) {
    const times: unknown[] = [];
    for (const b of bars) {
      if (Array.isArray(b)) {
        if (b.length) times.push(b[0]);
        continue;
      }
      if (isRecord(b)) {
        times.push(b.time ?? b.t ?? b.timestamp);
      }
    }
    if (times.length) return times;
  }
  return undefined;
}

/**
 * Build the run-result envelope from a raw engine payload.
 *
 * The shape is the one the apply path and the indicator runner expect:
 * `plots` / `series` / `events` / `drawings` at the top level, and the run
 * metadata under `meta`.
 */
export function mapEnginePayload(payload: unknown, opts: MapEnginePayloadOptions): RunResult {
  const p = isRecord(payload) ? payload : {};
  const meta = isRecord(p.meta) ? p.meta : {};

  const overlayRaw = p.overlay ?? meta.overlay;
  const overlay =
    opts.overlay === 'boolean-only'
      ? typeof overlayRaw === 'boolean'
        ? overlayRaw
        : undefined
      : normalizeOverlayFlag(overlayRaw);

  const scriptName = (p.script_name || meta.script_name || 'plot') as string;

  const profile = (p.profile ?? meta.profile) as RunResult['profile'] | undefined;
  const logs = (p.logs ?? meta.logs) as RunResult['logs'] | undefined;

  let scriptType: string | undefined;
  if (opts.scriptType === 'payload+meta+kind') {
    scriptType =
      (p.script_type as string | undefined) ||
      (meta.script_type as string | undefined) ||
      (/strategy/i.test(String(meta.kind || '')) ? 'strategy' : undefined);
  } else if (opts.scriptType === 'meta') {
    scriptType = meta.script_type as string | undefined;
  }

  const times = opts.engineTimes ? payloadEngineTimes(p) : undefined;

  return {
    status: 'success',
    plots: (p.plots as (number | null)[]) || [],
    series: (p.series as Record<string, PlotSample[]>) || {},
    events: (p.events as RunResult['events']) || [],
    drawings: (p.drawings as RunResult['drawings']) || [],
    inputs: p.inputs,
    ...(profile ? { profile } : {}),
    ...(Array.isArray(logs) ? { logs } : {}),
    meta: {
      ...meta,
      ms: opts.ms,
      transport: opts.transport,
      mode: opts.mode,
      script_id: p.script_id as string | undefined,
      run_id: p.run_id as string | undefined,
      ...(overlay !== undefined ? { overlay } : {}),
      script_name: scriptName,
      ...(times ? { engineTimes: times } : {}),
      ...(scriptType ? { script_type: scriptType } : {}),
      plot_meta:
        (p.plot_meta as Record<string, unknown>) ||
        (meta.plot_meta as Record<string, unknown> | undefined) ||
        {},
      inputs: p.inputs,
      ...(Array.isArray(p.alerts) ? { alerts: p.alerts } : {}),
      ...(Array.isArray(p.alert_conditions) ? { alert_conditions: p.alert_conditions } : {}),
      ...(profile ? { profile } : {}),
      ...(Array.isArray(logs) ? { logs } : {}),
      ...(opts.batch ? { batch: true } : {}),
    },
  } satisfies RunResult;
}
