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
 * Built-in **calculation engines** for the Solid AXIS path.
 *
 * Engines evaluate Pine Script against OHLCV bars and return a unified
 * {@link RunResult} (plots, series, events, drawings, meta). Registration
 * goes through {@link registry}; look up via {@link getEngine} / {@link listEngines}.
 *
 * ## Built-ins
 *
 * | id | Transport | Backend |
 * |----|-----------|---------|
 * | `server` | WebSocket `/ws/run` preferred, then `POST /run` | pyne Pro API (default `http://localhost:5002`) or AXIS Worker |
 * | `pyne-worker` | `POST /run` (+ optional WS) | HOOX **pyne-worker** edge evaluator (`https://pyne-worker…workers.dev`) |
 * | `pyodide` | In-browser | Self-hosted Pyodide + vendored `pynescript` wheel |
 *
 * ## `server` protocol
 *
 * - **WS**: `ws(s)://host/ws/run` frames `{ type: 'run', id, script, data, mode, symbol? }`.
 * - **REST**: `POST {endpoint}/run?mode=…` with body `{ script, data, mode, inputs? }`.
 * - Modes: `interpret` | `compile` | `auto` (body-validated; query is legacy).
 * - NaN/Infinity in JSON are normalized client-side before parse.
 *
 * ## Public API
 *
 * - {@link serverEngine} / {@link pyneWorkerEngine} / {@link pyodideEngine} — plugin instances
 * - {@link ensureEnginesRegistered}, {@link getEngine}, {@link listEngines}
 * - {@link registerDynamicEngine} / {@link unregisterDynamicEngine} — runtime plugins
 * - {@link preloadPyodide}, {@link prefetchPyodideAssets} — cold-load helpers
 * - {@link DEFAULT_PYNE_WORKER_ENDPOINT} — production pyne-worker origin
 *
 * @module engines/catalog
 * @see {@link EnginePlugin} in `plugins/types`
 * @see {@link engine-ws} for the persistent WS client
 */

/** Production HOOX pyne-worker (edge Pine evaluate). */
export const DEFAULT_PYNE_WORKER_ENDPOINT =
  'https://pyne-worker.cryptolinx.workers.dev';

import type { EnginePlugin, PlotSample, RunResult, EngineCapabilities, EngineLiveMode } from '../plugins/types';
import type { LiveSessionModeFields } from './live-sessions';
import { barsForPine } from '../data/parse-bars';
import { store, setTelemetryPlane, setTelemetryState, setStatus, appendLog } from '../store';
import { registry } from '../plugins/registry';
import { scriptHasPineAlertCalls } from '../alerts/pine';
import { parseEngineJson } from './json-sanitize';
import { healthFromBody, type EngineHealth } from './health';
import {
  callPyodideRunScript,
  formatPyodideBridgeError,
  installPynescriptRuntime,
  pyodideRuntimeAcceptsInputs,
  type PyodideLike,
} from '../workers/pyodide-runtime';
import {
  ABORTED,
  PyodideAbortedError,
  PyodideWorkerError,
  isPyodideWorkerLoaded,
  loadPyodideWorker,
  pyodideWorkerAvailable,
  raceAbort,
  runPyodideWorker,
  terminatePyodideWorker,
  type PyodideWorkerRuntime,
} from '../workers/pyodide-client';

// Bridge helpers now live in workers/pyodide-runtime (the worker bundles them);
// re-exported so existing importers keep working.
export {
  callPyodideRunScript,
  formatPyodideBridgeError,
  pyodideRuntimeAcceptsInputs,
} from '../workers/pyodide-runtime';

/**
 * PYNE compile currently emits `alert()` / `alertcondition()` as empty
 * statements (Numba nopython cannot collect Python AlertEvent dicts) and
 * returns `alerts: []`. Interpret still records them. Remote Flask / worker
 * compile therefore falls back to interpret when the script calls those
 * builtins so AXIS `pine_alert` rows can fire. In-browser Pyodide compile
 * records alerts itself (see `pynescript_runtime._patch_compiler_alerts`).
 */
export function resolveServerRunMode(mode: string, script: string, profilerOn: boolean): string {
  if (profilerOn) return 'interpret';
  if ((mode === 'compile' || mode === 'auto') && scriptHasPineAlertCalls(script)) {
    return 'interpret';
  }
  return mode;
}

function resolveConfig(
  schema: EnginePlugin['configSchema'],
  config?: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(schema || {})) {
    out[k] = def && 'default' in def ? def.default : undefined;
  }
  for (const [k, v] of Object.entries(config || {})) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Remember the mode the backend reported for a full run.
 *
 * The live-session fast path only engages when the series on the chart came
 * from `interpret` (sessions always evaluate in interpret), so `auto` runs need
 * the backend's own answer — `/session` must not silently reinterpret a series
 * that was compiled. Best-effort: a missing memo only costs a full run.
 */
async function rememberResolvedRunMode(
  fields: LiveSessionModeFields,
  reported: unknown,
): Promise<void> {
  try {
    const { noteRunMode } = await import('./live-sessions');
    noteRunMode(fields, reported);
  } catch {
    /* memo is best-effort */
  }
}

/** localStorage key for engine origins the user already approved for API-key use. */
const TRUSTED_ENGINE_ORIGINS_KEY = 'axis.engine.trustedOrigins.v1';

/** Origins that never need a confirmation prompt (loopback dev backends). */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

function readTrustedEngineOrigins(): string[] {
  try {
    const raw = localStorage.getItem(TRUSTED_ENGINE_ORIGINS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === 'string')
      : [];
  } catch {
    return [];
  }
}

/**
 * Confirm before sending an engine API key to a new origin.
 *
 * Same-origin, loopback, and previously-confirmed origins proceed silently.
 * A fresh cross-origin endpoint prompts once via `window.confirm`; the answer
 * is remembered in localStorage. Returns true when the key may be sent.
 * Headless environments (no `location` / `confirm`, e.g. unit tests) allow —
 * the backend still enforces auth.
 */
export function confirmEngineApiKeyTarget(endpoint: string, apiKey: string): boolean {
  if (!apiKey) return true;
  let origin = '';
  try {
    origin = new URL(endpoint).origin;
  } catch {
    return true;
  }
  if (typeof location === 'undefined') return true;
  try {
    if (origin === location.origin || isLoopbackOrigin(origin)) return true;
  } catch {
    return true;
  }
  const trusted = readTrustedEngineOrigins();
  if (trusted.includes(origin)) return true;
  const w =
    typeof window !== 'undefined'
      ? (window as Window & { confirm?: (msg: string) => boolean })
      : undefined;
  if (typeof w?.confirm !== 'function') return true;
  let ok = false;
  try {
    ok =
      w.confirm(
        `Send your engine API key to ${origin}?\n\nThe backend runs your Pine Script and sees your key. Only confirm origins you trust.`,
      ) === true;
  } catch {
    return true;
  }
  if (!ok) {
    appendLog('warn', `API key withheld for unconfirmed engine origin ${origin}`, 'engine', {
      toast: false,
    });
    return false;
  }
  try {
    localStorage.setItem(TRUSTED_ENGINE_ORIGINS_KEY, JSON.stringify([...trusted, origin]));
  } catch {
    /* quota */
  }
  return true;
}

/** Safe capabilities when an endpoint cannot be read (bar-close only, no data ownership). */
export const DEFAULT_ENGINE_CAPABILITIES: EngineCapabilities = {
  liveModes: ['bar-close'],
  ownsData: false,
  dataSession: false,
};

/**
 * Raw engine bar-time axis when the backend ships one alongside `series`
 * (top-level `times` / `bar_times` / `barTimes`, or a `bars` time column).
 * Returned un-normalized (unix seconds or Pine-ms); the indicator runner
 * normalizes to chart seconds when it joins session series by time
 * (`extractEngineResultTimes`). Undefined when the payload carries no axis —
 * session hits then fall back to the evaluated window's own times.
 */
function payloadEngineTimes(payload: unknown): unknown[] | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  const rec = payload as Record<string, unknown>;
  for (const key of ['times', 'bar_times', 'barTimes'] as const) {
    const v = rec[key];
    if (Array.isArray(v) && v.length) return v as unknown[];
  }
  const bars = rec.bars;
  if (Array.isArray(bars) && bars.length) {
    const times: unknown[] = [];
    for (const b of bars) {
      if (Array.isArray(b)) {
        if (b.length) times.push(b[0]);
        continue;
      }
      if (b && typeof b === 'object') {
        const row = b as Record<string, unknown>;
        times.push(row.time ?? row.t ?? row.timestamp);
      }
    }
    if (times.length) return times;
  }
  return undefined;
}

const LIVE_MODES: readonly EngineLiveMode[] = ['every-tick', 'bar-close'];

/**
 * Map a `GET /health` body to engine capabilities (contract: `features.live_modes`,
 * `features.data_session`, `features.data_exchanges`). Unknown or absent keys
 * fall back to {@link DEFAULT_ENGINE_CAPABILITIES}; never infers from the service name.
 */
export function capabilitiesFromHealth(body: unknown): EngineCapabilities {
  const features =
    body && typeof body === 'object' && (body as { features?: unknown }).features &&
    typeof (body as { features?: unknown }).features === 'object'
      ? ((body as { features: Record<string, unknown> }).features)
      : {};
  const rawModes = Array.isArray(features.live_modes) ? features.live_modes : [];
  const dataSession = features.data_session === true;
  // every-tick is only meaningful when the engine owns the feed (data_session).
  const liveModes = LIVE_MODES.filter(
    (m) => rawModes.includes(m) && (m !== 'every-tick' || dataSession),
  );
  const exchanges = Array.isArray(features.data_exchanges)
    ? features.data_exchanges.filter((e): e is string => typeof e === 'string')
    : undefined;
  return {
    liveModes: liveModes.length ? [...liveModes] : [...DEFAULT_ENGINE_CAPABILITIES.liveModes],
    ownsData: dataSession,
    dataSession,
    ...(exchanges?.length ? { dataExchanges: exchanges } : {}),
  };
}

export const serverEngine: EnginePlugin = {
  id: 'server',
  name: 'Server-Side',
  kind: 'engine',
  builtIn: true,
  description:
    'Sends the script + bars to the configured backend (Flask or Cloudflare Worker). Prefers WebSocket /ws/run when available, falls back to POST /run.',
  // transport is dual (WS preferred, REST fallback) — classified via preferWs in telemetry
  capabilities: { needsNetwork: true },
  configSchema: {
    endpoint: { type: 'string', default: 'http://localhost:5002', label: 'Backend URL' },
    mode: {
      type: 'select',
      options: ['interpret', 'compile', 'auto'],
      default: 'auto',
      label: 'Execution mode',
      description:
        'auto = try compile, fall back to interpret; compile = Numba/numpy path; interpret = AST interpreter',
    },
    preferWs: {
      type: 'boolean',
      default: true,
      label: 'Prefer WebSocket (/ws/run)',
    },
    apiKey: {
      type: 'string',
      default: '',
      label: 'API key (optional)',
      description: 'Sent as X-API-Key / Authorization Bearer when the backend requires auth',
    },
  },
  async getCapabilities() {
    const endpoint = String(store.endpoint || this.configSchema?.endpoint.default || '').replace(/\/$/, '');
    const probe = await probeEngineHealth(endpoint);
    if (!probe) {
      // Readiness must not outlive the endpoint that reported it.
      cachedEngineHealth = null;
      return { ...DEFAULT_ENGINE_CAPABILITIES, liveModes: [...DEFAULT_ENGINE_CAPABILITIES.liveModes] };
    }
    // Same fetch, two views: live-mode caps for the runner, readiness/route
    // metadata for the UI (prewarm, runner, preview gating).
    cachedEngineHealth = probe.health;
    return probe.capabilities;
  },
  async isReady() {
    const endpoint = (store.endpoint || this.configSchema!.endpoint.default as string).replace(/\/$/, '');
    try {
      // Prefer /health: same-origin AXIS hosts serve the SPA on `/`.
      let health: { websocket?: boolean } | null = null;
      for (const path of ['/health', '/'] as const) {
        const res = await fetch(`${endpoint}${path}`, {
          method: 'GET',
          signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) continue;
        try {
          const j = (await res.json()) as {
            websocket?: boolean;
            status?: unknown;
            service?: string;
            worker?: string;
            endpoints?: unknown;
            features?: unknown;
          };
          if (
            j.endpoints ||
            j.status ||
            j.service ||
            j.worker ||
            j.features ||
            j.websocket != null
          ) {
            health = j;
            break;
          }
        } catch {
          /* HTML shell — try next */
        }
      }
      if (!health) return false;
      if (health.websocket) {
        const { probeEngineWs } = await import('./engine-ws');
        void probeEngineWs(endpoint, 3_000);
      }
      return true;
    } catch {
      return false;
    }
  },
  async run({
    script,
    bars,
    config,
    inputs,
    libraries,
    signal,
    liveTick,
    liveSessionOwner,
    dataSession,
  }) {
    // Prefer store.endpoint (Settings) over plugin config so a stale
    // pluginsConfig.endpoint cannot pin an old backend after Save.
    // Explicit config.endpoint still wins when set (e.g. pyne-worker engine).
    const endpoint = (
      (config?.endpoint as string) ||
      store.endpoint ||
      (this.configSchema!.endpoint.default as string)
    ).replace(/\/$/, '');
    const cfg = resolveConfig(this.configSchema, { ...(config || {}), endpoint });
    const modeRaw = String(cfg.mode || 'auto');
    const profilerOn = cfg.profiler === true;
    const mode = resolveServerRunMode(modeRaw, script, profilerOn);
    const preferWs = cfg.preferWs !== false;
    const apiKey = String(cfg.apiKey || '').trim();
    const t0 = performance.now();
    // B6: never send the key to a fresh cross-origin backend without consent.
    if (!confirmEngineApiKeyTarget(endpoint, apiKey)) {
      return {
        status: 'error',
        plots: [],
        events: [],
        series: {},
        error: 'API key withheld for unconfirmed engine origin — approve it and re-run',
        meta: { ms: performance.now() - t0, transport: 'rest' },
      } satisfies RunResult;
    }
    // Generous budget: compile + large OHLCV can exceed 30s on cold Numba.
    const timeoutMs = Math.min(
      180_000,
      Math.max(90_000, 45_000 + (bars?.length || 0) * 40),
    );
    const inputOverrides =
      inputs && typeof inputs === 'object' && Object.keys(inputs).length
        ? inputs
        : undefined;
    // A resumable session freezes its inputs at create — `/tick` and `/append`
    // carry bars only. `resolveInputSourceValues` inlines `input.source` refs as
    // live series arrays that change every tick, so a session created over them
    // would evaluate stale inputs (and key-churn if the arrays were part of the
    // session key). Those scripts stay on the full run; everyone else is
    // scalar-only and safe to tick.
    const hasLiveInputValues = Object.values(inputOverrides || {}).some(
      (v) => v !== null && typeof v === 'object',
    );
    // Chart bars are unix seconds. Pine `time` / hour() / session clocks are ms.
    const pineBars = barsForPine(bars);
    // Key for the resolved-run-mode memo. Defined before the data-session
    // branch so engine-owned runs record it too — the live-session fast path
    // gates on this memo, and a data-session evaluation is still a full run
    // whose backend-resolved mode reflects reality.
    const modeFields = { endpoint, script, mode, profiler: profilerOn };

    // Prefer engine meta; do not force true — runner resolves indicator/strategy defaults.
    // Shared by the REST fallback and the live-session fast path (same envelope shape).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapRestPayload = (payload: any): RunResult => {
      // Prefer engine meta; do not force true — runner resolves indicator/strategy defaults.
      const restOverlay = normalizeOverlayFlag(payload.overlay ?? payload.meta?.overlay);
      const restName =
        payload.script_name || payload.meta?.script_name || 'plot';
      // Bar-time axis for the apply path: session series are joined to the
      // chart by time, not index tail-align (see `alignSeriesToTimes`).
      const restTimes = payloadEngineTimes(payload);
      const restProfile = (payload.profile ?? payload.meta?.profile) as
        | Record<string, unknown>
        | undefined;
      const restLogs = (payload.logs ?? payload.meta?.logs) as RunResult['logs'] | undefined;
      const restScriptType =
        payload.script_type ||
        payload.meta?.script_type ||
        (typeof restName === 'string' && /strategy/i.test(String(payload.meta?.kind || ''))
          ? 'strategy'
          : undefined);
      return {
        status: 'success',
        plots: (payload.plots as (number | null)[]) || [],
        series: (payload.series as Record<string, PlotSample[]>) || {},
        events: (payload.events as RunResult['events']) || [],
        drawings: (payload.drawings as RunResult['drawings']) || [],
        inputs: payload.inputs,
        ...(restProfile ? { profile: restProfile } : {}),
        ...(Array.isArray(restLogs) ? { logs: restLogs } : {}),
        meta: {
          ...(payload.meta || {}),
          ms: performance.now() - t0,
          transport: 'rest' as const,
          mode: payload.mode as string | undefined,
          script_id: payload.script_id as string | undefined,
          run_id: payload.run_id as string | undefined,
          ...(restOverlay !== undefined ? { overlay: restOverlay } : {}),
          script_name: restName as string,
          // Engine bar-time axis when the backend shipped one (apply joins by time).
          ...(restTimes ? { engineTimes: restTimes } : {}),
          ...(restScriptType ? { script_type: restScriptType } : {}),
          plot_meta: payload.plot_meta || payload.meta?.plot_meta || {},
          inputs: payload.inputs,
          ...(Array.isArray(payload.alerts) ? { alerts: payload.alerts } : {}),
          ...(Array.isArray(payload.alert_conditions)
            ? { alert_conditions: payload.alert_conditions }
            : {}),
          ...(restProfile ? { profile: restProfile } : {}),
          ...(Array.isArray(restLogs) ? { logs: restLogs } : {}),
        },
      } satisfies RunResult;
    };

    // ── Engine-owned series (PYNE Pro every-tick): identity only, never bars ──
    // The engine's store and feed own the OHLCV. A fallback to the bars path
    // here would ship the window the engine is meant to own, so errors surface.
    if (dataSession) {
      const { runDataSession } = await import('./data-sessions');
      const ds = await runDataSession({
        endpoint,
        apiKey,
        owner: liveSessionOwner,
        request: dataSession,
        script,
        inputs: inputOverrides,
        libraries,
        profiler: profilerOn,
        tick: liveTick === true,
        signal: signal || undefined,
      });
      if (!ds.ok) {
        return {
          status: 'error',
          plots: [],
          events: [],
          series: {},
          error: ds.error,
          meta: { ms: performance.now() - t0, transport: 'rest' },
        } satisfies RunResult;
      }
      const mapped = mapRestPayload(ds.payload);
      // Data-session runs are full evaluations (engine-owned series), so they
      // record the resolved mode like the bars-in REST/WS paths. Sessions
      // always evaluate in interpret (no resumable compile state); older
      // `/data/session` payloads carry no `mode`, so the fallback is
      // interpret — never the requested mode, which would misreport an `auto`
      // run the backend never resolved. Observable via `runModeAllowsSessions`.
      const dsPayload = ds.payload as {
        mode?: unknown;
        meta?: { mode?: unknown };
      };
      await rememberResolvedRunMode(
        modeFields,
        dsPayload.mode ?? dsPayload.meta?.mode ?? 'interpret',
      );
      return {
        ...mapped,
        meta: {
          ...mapped.meta,
          sessionVia: ds.via,
          session_id: ds.sessionId,
          provisioned: ds.provisioned,
        },
      } satisfies RunResult;
    }

    // ── Live-session fast path (Pro API 0.6.9+): O(delta) tick/append ──
    // Interpret only — compile has no resumable evaluator state, and a session
    // always evaluates in interpret. So the tick may only follow a full run the
    // backend itself resolved to interpret: an explicit `interpret` config
    // qualifies outright, `auto` does when the last full run for this script
    // reported interpret (recorded below). Never silently switch a compiled
    // series to interpreted values. REST-only (WS has no session routes); any
    // miss falls through to the full run, so old backends, edge, and proxies
    // behave exactly as before.
    const sessionSymbol =
      typeof store.symbol === 'string' && store.symbol ? store.symbol : 'CHART';
    const sessionInterval =
      typeof store.interval === 'string' && store.interval ? store.interval : '1d';
    if (
      liveTick === true &&
      mode !== 'compile' &&
      pineBars.length > 0 &&
      !hasLiveInputValues
    ) {
      try {
        const { tryLiveSessionTick, runModeAllowsSessions } = await import('./live-sessions');
        if (mode === 'interpret' || runModeAllowsSessions(modeFields)) {
          const hit = await tryLiveSessionTick({
            endpoint,
            apiKey,
            script,
            pineBars,
            ...(inputOverrides ? { inputs: inputOverrides } : {}),
            ...(profilerOn ? { profiler: true } : {}),
            ...(libraries?.length ? { libraries } : {}),
            ...(liveSessionOwner ? { ownerId: liveSessionOwner } : {}),
            symbol: sessionSymbol,
            interval: sessionInterval,
            signal: signal || undefined,
          });
          if (hit && hit.payload && typeof hit.payload === 'object') {
            const mapped = mapRestPayload(hit.payload);
            // Bar-time axis for the apply path: prefer the engine's own axis
            // when the envelope ships one, else the session's evaluated window
            // (the continuity guards only return in-window hits). Session
            // series are joined to the chart by time, not index tail-align.
            const hitTimes =
              payloadEngineTimes(hit.payload) ??
              (hit.barTimes?.length ? hit.barTimes : undefined);
            return {
              ...mapped,
              meta: {
                ...mapped.meta,
                sessionVia: hit.via,
                session_id: (hit.payload as { session_id?: unknown }).session_id as
                  | string
                  | undefined,
                ...(hitTimes ? { engineTimes: hitTimes } : {}),
              },
            } satisfies RunResult;
          }
        }
      } catch {
        /* fall through to the full WS/REST run */
      }
    }

    // ── WSS-first path (short budget so REST still has time) ──────
    // Gunicorn default workers do NOT speak WebSocket — connect can hang then
    // burn the whole AbortSignal; REST fallback must get a *fresh* timeout.
    if (preferWs && typeof WebSocket !== 'undefined') {
      try {
        const { getEngineWsClient } = await import('./engine-ws');
        const client = getEngineWsClient(endpoint);
        if (!client.isDead) {
          // Cap WS attempt so a dead /ws/run cannot exhaust the run budget.
          const wsBudget = Math.min(20_000, Math.max(8_000, Math.floor(timeoutMs / 4)));
          const wsResult = await client.run(
            {
              script,
              data: pineBars as unknown[],
              mode,
              // Always a string — API schema rejects null/omitted-as-null
              symbol: typeof store.symbol === 'string' && store.symbol ? store.symbol : 'CHART',
              ...(inputOverrides ? { inputs: inputOverrides } : {}),
              ...(profilerOn ? { profiler: true } : {}),
              ...(libraries?.length ? { libraries } : {}),
            },
            wsBudget,
            signal,
          );
          const ms = performance.now() - t0;
          if (wsResult.status === 'error') {
            return {
              status: 'error',
              plots: [],
              events: [],
              series: {},
              error: wsResult.error || wsResult.message || 'WS engine error',
              meta: { ms, transport: 'ws' },
            } satisfies RunResult;
          }
          const wsOverlay = normalizeOverlayFlag(
            wsResult.overlay ??
              (wsResult.meta as { overlay?: unknown } | undefined)?.overlay,
          );
          const wsName =
            (wsResult.script_name as string) ||
            (wsResult.meta as { script_name?: string } | undefined)?.script_name ||
            'plot';
          const wsProfile =
            ((wsResult as { profile?: unknown }).profile ??
              (wsResult.meta as { profile?: unknown } | undefined)?.profile) as
              | Record<string, unknown>
              | undefined;
          const wsLogs = (
            (wsResult as { logs?: unknown }).logs ??
            (wsResult.meta as { logs?: unknown } | undefined)?.logs
          ) as RunResult['logs'] | undefined;
          const wsScriptType = (wsResult.meta as { script_type?: string } | undefined)
            ?.script_type;
          const wsAlerts = (wsResult as { alerts?: unknown }).alerts;
          const wsAlertConds = (wsResult as { alert_conditions?: unknown }).alert_conditions;
          await rememberResolvedRunMode(modeFields, wsResult.mode || mode);
          return {
            status: 'success',
            plots: (wsResult.plots as (number | null)[]) || [],
            series: (wsResult.series as Record<string, PlotSample[]>) || {},
            events: (wsResult.events as RunResult['events']) || [],
            drawings: (wsResult.drawings as RunResult['drawings']) || [],
            inputs: (wsResult as { inputs?: unknown }).inputs,
            ...(wsProfile ? { profile: wsProfile } : {}),
            ...(Array.isArray(wsLogs) ? { logs: wsLogs } : {}),
            meta: {
              ...(typeof wsResult.meta === 'object' && wsResult.meta ? wsResult.meta : {}),
              ...(Array.isArray(wsAlerts) ? { alerts: wsAlerts } : {}),
              ...(Array.isArray(wsAlertConds) ? { alert_conditions: wsAlertConds } : {}),
              ms,
              transport: 'ws' as const,
              mode: (wsResult.mode || mode) as string,
              script_id: wsResult.script_id,
              run_id: wsResult.run_id,
              ...(wsOverlay !== undefined ? { overlay: wsOverlay } : {}),
              script_name: wsName,
              ...(wsScriptType ? { script_type: wsScriptType } : {}),
              plot_meta:
                (wsResult.plot_meta as Record<string, unknown>) ||
                (wsResult.meta as { plot_meta?: Record<string, unknown> } | undefined)
                  ?.plot_meta ||
                {},
              inputs: (wsResult as { inputs?: unknown }).inputs,
              ...(wsProfile ? { profile: wsProfile } : {}),
              ...(Array.isArray(wsLogs) ? { logs: wsLogs } : {}),
            },
          } satisfies RunResult;
        }
      } catch (err) {
        // A user cancel must end the run here — falling through to REST would
        // start a second evaluation the caller already abandoned.
        if (signal?.aborted) {
          return {
            status: 'error',
            plots: [],
            events: [],
            series: {},
            error: 'Aborted',
            meta: { ms: performance.now() - t0, transport: 'ws' },
          } satisfies RunResult;
        }
        // Surface the fallback (previously silent) — REST still runs below.
        // toast:false: once per run while WS is unavailable would flood toasts.
        appendLog(
          'warn',
          `WebSocket run unavailable — using REST (${err instanceof Error ? err.message : String(err)})`,
          'engine',
          { toast: false },
        );
      }
    }

    // ── REST fallback ─────────────────────────────────────────────
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
      headers.Authorization = `Bearer ${apiKey}`;
    }
    try {
      // Never reuse a parent AbortSignal that already fired while WS was tried —
      // browsers surface that as "The operation timed out." with no REST attempt.
      // Still honour a *fresh* parent cancel after the REST attempt begins.
      if (signal?.aborted) {
        return {
          status: 'error',
          plots: [],
          events: [],
          series: {},
          error: 'Aborted',
          meta: { ms: performance.now() - t0, transport: 'rest' },
        } satisfies RunResult;
      }
      const elapsed = performance.now() - t0;
      const restBudget = Math.max(45_000, timeoutMs - elapsed);
      // Fresh timeout per attempt: the 413 clamp and the legacy-`libraries`
      // retries must not reuse `restSignal` — it already spent the first
      // attempt's latency and could be near expiry when the retry starts.
      // A fresh parent cancel after each attempt begins is still honoured.
      const makeRestSignal = (): AbortSignal => {
        const budget = AbortSignal.timeout(restBudget);
        return signal && typeof AbortSignal.any === 'function'
          ? AbortSignal.any([budget, signal])
          : budget;
      };
      const restSignal = makeRestSignal();
      // mode must be in the JSON body — Pro API validates body only (query is legacy).
      const restMode = mode;
      const restBody = {
        script,
        data: pineBars,
        mode: restMode,
        ...(inputOverrides ? { inputs: inputOverrides } : {}),
        ...(profilerOn ? { profiler: true } : {}),
        ...(libraries?.length ? { libraries } : {}),
      };
      let res = await fetch(`${endpoint}/run?mode=${encodeURIComponent(restMode)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(restBody),
        signal: restSignal,
      });
      // Free-tier bar cap (PYNE `FREE_MAX_BARS`, e.g. 5000): the host refuses
      // the whole window with 413 + `max_bars`. Retry once with the newest
      // `max_bars` bars and mark the result, so the apply path can tail-align
      // the series to the chart window instead of failing every run.
      let clampedBars = 0;
      if (res.status === 413) {
        const peek = await res.clone().text();
        let maxBars = 0;
        try {
          const body = parseEngineJson(peek);
          if (body && typeof body === 'object' && !Array.isArray(body)) {
            const n = Number((body as { max_bars?: unknown }).max_bars);
            if (Number.isFinite(n) && n > 0) maxBars = Math.floor(n);
          }
        } catch {
          /* message-only body */
        }
        if (!maxBars) {
          const m = peek.match(/free-tier limit \((\d+)\s*bars\)/i);
          if (m) maxBars = Number(m[1]);
        }
        if (maxBars > 0 && maxBars < pineBars.length) {
          clampedBars = maxBars;
          res = await fetch(`${endpoint}/run?mode=${encodeURIComponent(restMode)}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ ...restBody, data: pineBars.slice(-maxBars) }),
            signal: makeRestSignal(),
          });
        }
      }
      // Older Pro APIs reject unknown `libraries` — retry without them.
      if (!res.ok && libraries?.length) {
        const peek = await res.clone().text();
        if (/UNKNOWN_FIELDS|libraries/i.test(peek)) {
          const { libraries: _drop, ...legacy } = restBody;
          res = await fetch(`${endpoint}/run?mode=${encodeURIComponent(restMode)}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(
              clampedBars > 0 ? { ...legacy, data: pineBars.slice(-clampedBars) } : legacy,
            ),
            signal: makeRestSignal(),
          });
        }
      }
      const text = await res.text();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let payload: any;
      try {
        // Empty body is not valid JSON for /run.
        if (!text || !String(text).trim()) {
          throw new SyntaxError('empty body');
        }
        // Python json.dumps can emit bare NaN; shared with the WS path.
        payload = parseEngineJson(text);
        if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
          throw new SyntaxError('expected JSON object');
        }
      } catch {
        const snippet = text.slice(0, 120).replace(/\s+/g, ' ').trim();
        payload = {
          status: 'error',
          message: `invalid JSON (HTTP ${res.status}${snippet ? `: ${snippet}` : ''})`,
        };
      }
      if (!res.ok || payload.status === 'error') {
        const httpHint =
          res.status >= 500
            ? `HTTP ${res.status}`
            : res.status >= 400
              ? `HTTP ${res.status}`
              : '';
        return {
          status: 'error',
          plots: [],
          events: [],
          series: {},
          error: String(
            payload.message ||
              payload.error ||
              httpHint ||
              `HTTP ${res.status}`,
          ),
          meta: {
            ms: performance.now() - t0,
            transport: 'rest',
            http_status: res.status,
          },
        } satisfies RunResult;
      }
      // Prefer engine meta; do not force true — runner resolves indicator/strategy defaults.
      await rememberResolvedRunMode(modeFields, payload.mode ?? payload.meta?.mode ?? mode);
      const mapped = mapRestPayload(payload);
      if (clampedBars > 0) {
        // The engine evaluated only the newest `clampedBars`; the apply path
        // tail-aligns series to the chart window when this is set.
        mapped.meta = { ...mapped.meta, windowBars: clampedBars };
      }
      return mapped;
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      const raw = err instanceof Error ? err.message : String(err);
      const aborted =
        name === 'AbortError' ||
        signal?.aborted ||
        /abort(ed)?|timed?\s*out|TimeoutError/i.test(raw);
      const msg = aborted
        ? signal?.aborted
          ? 'Aborted'
          : raw || 'Request timed out'
        : raw;
      return {
        status: 'error',
        plots: [],
        events: [],
        series: {},
        error: msg,
        meta: { ms: performance.now() - t0, transport: 'rest' },
      } satisfies RunResult;
    }
  },
};

/**
 * Normalize engine `overlay` flags. Runtimes may send bool or 0/1.
 * `undefined` means “not specified” (runner applies defaults).
 */
function normalizeOverlayFlag(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  return v !== false && v !== 0 && v !== '0' && v !== 'false';
}

declare global {
  interface Window {
    loadPyodide?: (opts: { indexURL: string }) => Promise<PyodideLike>;
  }
}

/** Self-hosted Pyodide (public/pyodide/v0.29.5, Python 3.13 — ~12MB, no CDN required). */
export const LOCAL_PYODIDE_VERSION = '0.29.5';
export const LOCAL_PYODIDE_INDEX = `/pyodide/v${LOCAL_PYODIDE_VERSION}/`;

/**
 * Absolute indexURL with trailing slash (relative paths resolve against location.origin).
 *
 * The index is loaded with `import()` into the app origin, i.e. it executes
 * JavaScript. Only **same-origin** absolute URLs are honoured; a cross-origin
 * value (e.g. from a hand-edited or imported plugin config) falls back to the
 * self-hosted runtime instead of running third-party code.
 */
export function resolvePyodideIndexUrl(configured?: string): string {
  const raw = (configured || LOCAL_PYODIDE_INDEX).trim() || LOCAL_PYODIDE_INDEX;
  if (/^https?:\/\//i.test(raw)) {
    let sameOrigin = false;
    try {
      sameOrigin = typeof location !== 'undefined' && new URL(raw).origin === location.origin;
    } catch {
      sameOrigin = false;
    }
    if (sameOrigin) return raw.endsWith('/') ? raw : `${raw}/`;
    appendLog(
      'warn',
      'Pyodide indexUrl is cross-origin — ignored; using the self-hosted runtime',
      'pyodide',
      { toast: false },
    );
    return resolvePyodideIndexUrl(LOCAL_PYODIDE_INDEX);
  }
  const origin = typeof location !== 'undefined' ? location.origin : '';
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  const withSlash = path.endsWith('/') ? path : `${path}/`;
  return `${origin}${withSlash}`;
}

function pyodidePluginConfig(): Record<string, unknown> {
  const configs = store.pluginsConfig || {};
  return (configs['engine:pyodide'] || configs.pyodide || {}) as Record<string, unknown>;
}

/**
 * Prefetch core Pyodide assets into the HTTP cache (wasm + stdlib are heavy).
 * Safe to call on idle; no-op outside the browser.
 */
export function prefetchPyodideAssets(indexUrl?: string): void {
  // Best-effort warm-up: a DOM without <head> (partial test doubles) must not
  // fail the load that follows.
  if (typeof document === 'undefined' || !document.head) return;
  const base = resolvePyodideIndexUrl(indexUrl);
  const files = [
    'pyodide.js',
    'pyodide.asm.js',
    'pyodide.asm.wasm',
    'python_stdlib.zip',
    'pyodide-lock.json',
    'micropip-0.11.1-py3-none-any.whl',
    'packaging-26.2-py3-none-any.whl',
  ];
  for (const f of files) {
    const href = `${base}${f}`;
    if (document.querySelector(`link[data-axis-pyodide="${f}"]`)) continue;
    const link = document.createElement('link');
    link.rel = f.endsWith('.js') ? 'modulepreload' : 'prefetch';
    link.href = href;
    link.as = f.endsWith('.wasm') ? 'fetch' : f.endsWith('.js') ? 'script' : 'fetch';
    link.crossOrigin = 'anonymous';
    link.dataset.axisPyodide = f;
    document.head.appendChild(link);
  }
  // Also warm vendor wheels + runtime (same-origin)
  if (typeof location !== 'undefined') {
    const origin = location.origin;
    for (const path of [
      '/vendor/pynescript-0.6.9-py3-none-any.whl',
      '/vendor/antlr4_python3_runtime-4.13.2-py3-none-any.whl',
      '/pyodide/pynescript_runtime.py',
    ]) {
      void fetch(`${origin}${path}`, { method: 'GET', credentials: 'same-origin' }).catch(() => {});
    }
  }
}

/** True when the user-selected calculation engine is pyodide (not background warm). */
function pyodideIsActiveEngine(): boolean {
  return store.engine === 'pyodide' || store.activePlugins?.engine === 'pyodide';
}

/**
 * Preload full Pyodide + pynescript runtime in the background.
 * Safe to call multiple times; shares the same ensure promise.
 * First cold load is often ~20–30s (wasm + micropip + wheels).
 *
 * IMPORTANT: only update the ENG telemetry plane when Pyodide is the *active*
 * engine. Background warm-up while MODE=server must not clobber ENG to pyodide.
 */
export function preloadPyodide(): Promise<unknown> {
  prefetchPyodideAssets();
  const reportHud = () => pyodideIsActiveEngine();

  // Worker-loaded runtimes leave `_pyodide` null; don't re-announce a cold load.
  if (!pyodideEngine._pyodide && !isPyodideWorkerLoaded() && reportHud()) {
    setTelemetryPlane('engine', {
      id: 'pyodide',
      name: 'Client-Side (Pyodide)',
      transport: 'local',
      state: 'connecting',
      detail: 'cold load ~20–30s (Pyodide + micropip + wheel)',
      error: null,
    });
    setStatus(
      'loading',
      'Loading Pyodide runtime… ~20–30s first open (wasm + micropip + pynescript wheel)',
    );
  }
  return pyodideEngine
    ._ensure()
    .then((py) => {
      if (py && reportHud()) {
        setTelemetryState('engine', 'open', {
          id: 'pyodide',
          name: 'Client-Side (Pyodide)',
          transport: 'local',
          detail: 'ready · local',
          error: null,
        });
        setStatus('ready', 'Pyodide ready · offline evaluate available', {
          toast: true,
          source: 'engine',
        });
        appendLog('ok', 'Pyodide runtime ready (~self-hosted)', 'pyodide');
      } else if (py && !reportHud()) {
        // Background warm only — leave MODE/ENG (server etc.) alone
        appendLog('ok', 'Pyodide runtime preloaded (background)', 'pyodide');
      }
      return py;
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[axis] pyodide preload failed', err);
      if (reportHud()) {
        setTelemetryState('engine', 'error', {
          id: 'pyodide',
          transport: 'local',
          detail: 'load failed',
          error: msg,
        });
        setStatus('error', `Pyodide load failed: ${msg}`);
      }
      return null;
    });
}

/** After a failed cold load, wait this long before another full attempt. */
const PYODIDE_LOAD_COOLDOWN_MS = 30_000;

/** Warn once per session that Pyodide ignored a requested field. */
let warnedUnsupportedFields = false;

/** Cancelled run, in the same envelope as a failed one (`error: 'Aborted'`). */
function pyodideAbortedResult(ms: number): RunResult {
  return {
    status: 'error',
    plots: [],
    series: {},
    events: [],
    drawings: [],
    error: 'Aborted',
    meta: { ms, transport: 'local' },
  };
}

function isWorkerRuntime(rt: PyodideLike | PyodideWorkerRuntime): rt is PyodideWorkerRuntime {
  return 'kind' in rt && rt.kind === 'worker';
}

/** @internal test helper — clear cached instance, in-flight load and failure state. */
export function _resetPyodideEngineState(): void {
  pyodideEngine._pyodide = null;
  pyodideEngine._partial = null;
  pyodideEngine._loadPromise = null;
  pyodideEngine._failure = null;
  terminatePyodideWorker(new Error('Pyodide engine state reset'));
  warnedUnsupportedFields = false;
}

export const pyodideEngine: EnginePlugin & {
  /** In-thread runtime (fallback path only). Stays null while the worker owns the runtime. */
  _pyodide: PyodideLike | null;
  _loadPromise: Promise<PyodideLike> | null;
  /** Instance whose `loadPyodide()` succeeded but later setup failed — reused on retry. */
  _partial: PyodideLike | null;
  _failure: { at: number; message: string } | null;
  /**
   * Resolves to the in-thread runtime, or to a {@link PyodideWorkerRuntime}
   * marker when the evaluator lives in the Pyodide worker.
   */
  _ensure: () => Promise<PyodideLike | PyodideWorkerRuntime>;
} = {
  id: 'pyodide',
  name: 'Client-Side (Pyodide)',
  kind: 'engine',
  builtIn: true,
  description:
    'Runs Pine in the browser via self-hosted Pyodide (~14MB from this origin). Preloads on idle; no CDN required after deploy.',
  capabilities: { offline: true, needsNetwork: false },
  configSchema: {
    indexUrl: {
      type: 'string',
      default: LOCAL_PYODIDE_INDEX,
      label: 'Pyodide index URL (default: self-hosted /pyodide/v0.29.5/)',
    },
    // Same control as server — browser runtime accepts mode; pure Numba compile
    // still needs the server engine (Numba is not available in Wasm).
    mode: {
      type: 'select',
      options: ['interpret', 'compile', 'auto'],
      default: 'auto',
      label: 'Execution mode',
      description:
        'auto = try compile, fall back to interpret; compile/auto use pynescript.compiler when possible (object-mode without Numba; numeric Numba needs server)',
    },
  },
  _pyodide: null,
  _loadPromise: null,
  _partial: null,
  _failure: null,
  async getCapabilities() {
    return { liveModes: ['bar-close'], ownsData: false };
  },
  async isReady() {
    try {
      return true;
    } catch {
      return false;
    }
  },
  async _ensure() {
    if (this._pyodide) return this._pyodide;
    if (this._loadPromise) return this._loadPromise;
    // Failure cool-down: a broken index/wheel otherwise re-downloads wasm on
    // every single run (and a stuck worker never gets a chance to recover).
    if (this._failure && Date.now() - this._failure.at < PYODIDE_LOAD_COOLDOWN_MS) {
      const waitS = Math.ceil((PYODIDE_LOAD_COOLDOWN_MS - (Date.now() - this._failure.at)) / 1000);
      throw new Error(`${this._failure.message} (retrying in ${waitS}s)`);
    }
    const cfg = resolveConfig(this.configSchema, pyodidePluginConfig());
    const indexUrl = resolvePyodideIndexUrl(String(cfg.indexUrl || LOCAL_PYODIDE_INDEX));
    const origin = typeof location !== 'undefined' ? location.origin : '';
    if (pyodideWorkerAvailable()) {
      // Worker path: the client owns the load promise (shared by concurrent
      // callers) and respawns after a crash, so nothing is memoised in
      // `_loadPromise` here — a stale resolved promise would wedge the engine.
      prefetchPyodideAssets(indexUrl);
      try {
        const info = await loadPyodideWorker({ indexUrl, origin });
        this._failure = null;
        return { kind: 'worker', acceptsInputs: info.acceptsInputs };
      } catch (err: unknown) {
        this._failure = {
          at: Date.now(),
          message: err instanceof Error ? err.message : String(err),
        };
        throw err;
      }
    }
    this._loadPromise = (async () => {
      prefetchPyodideAssets(indexUrl);

      if (typeof window !== 'undefined' && typeof window.loadPyodide !== 'function') {
        await import(/* @vite-ignore */ `${indexUrl}pyodide.js`);
      }
      if (typeof window === 'undefined' || typeof window.loadPyodide !== 'function') {
        throw new Error('loadPyodide not available');
      }
      // Pyodide has no public destroy(): a runtime that loaded but failed setup
      // is kept and reused on retry instead of leaking a second wasm heap.
      const py = this._partial ?? (await window.loadPyodide({ indexURL: indexUrl }));
      this._partial = py;
      // micropip + wheels + runtime — shared with the worker (pyodide-runtime).
      await installPynescriptRuntime(py, origin);
      this._pyodide = py;
      this._partial = null;
      this._failure = null;
      return py;
    })().catch((err) => {
      this._loadPromise = null;
      this._failure = {
        at: Date.now(),
        message: err instanceof Error ? err.message : String(err),
      };
      throw err;
    });
    return this._loadPromise;
  },
  async run({ script, bars, config, libraries, inputs, signal }) {
    const t0 = performance.now();
    // Cancel before any work: nothing has started yet.
    if (signal?.aborted) return pyodideAbortedResult(0);
    try {
      // A cancel during a cold load returns at once. The load itself keeps
      // running (preload and the next run share it).
      const runtime = await raceAbort(this._ensure(), signal);
      if (runtime === ABORTED || signal?.aborted) {
        return pyodideAbortedResult(performance.now() - t0);
      }
      const cfg = resolveConfig(this.configSchema, {
        ...pyodidePluginConfig(),
        ...(config || {}),
      });
      const mode = String((cfg as { mode?: string }).mode || 'auto');
      // Forward Script Settings when the loaded runtime accepts them. Anything
      // we cannot honour is reported in meta.unsupported — never dropped silently.
      const inputBag =
        inputs && typeof inputs === 'object' && Object.keys(inputs).length ? inputs : undefined;
      const unsupported: string[] = [];
      const acceptsInputs = isWorkerRuntime(runtime)
        ? runtime.acceptsInputs
        : pyodideRuntimeAcceptsInputs(runtime);
      const forwardInputs = inputBag !== undefined && acceptsInputs;
      if (inputBag !== undefined && !forwardInputs) unsupported.push('inputs');
      if (cfg.profiler === true) unsupported.push('profiler');
      if (unsupported.length && !warnedUnsupportedFields) {
        warnedUnsupportedFields = true;
        appendLog(
          'warn',
          `Browser runtime ignores ${unsupported.join(', ')} — use the server engine for these`,
          'pyodide',
          { toast: false },
        );
      }
      let resultJson: string;
      if (isWorkerRuntime(runtime)) {
        // Off the main thread: numpy load + run_script happen in the worker.
        // A cancel terminates the worker and rejects with PyodideAbortedError.
        resultJson = await runPyodideWorker(
          {
            script,
            bars: barsForPine(bars),
            mode,
            libraries: libraries || [],
            ...(forwardInputs ? { inputs: inputBag } : {}),
          },
          signal,
        );
      } else {
        // In-thread fallback (no Worker available). Cannot be interrupted once started.
        // Optional: load numpy for compile/object-mode (no-op if already present)
        if (mode === 'compile' || mode === 'auto') {
          try {
            await runtime.loadPackage?.('numpy');
          } catch {
            /* interpret fallback handles missing numpy */
          }
        }
        resultJson = callPyodideRunScript(
          runtime,
          script,
          barsForPine(bars),
          mode,
          libraries || [],
          forwardInputs ? inputBag : undefined,
        );
      }
      const result = JSON.parse(resultJson) as RunResult & {
        overlay?: unknown;
        script_name?: string;
      };
      const overlay = normalizeOverlayFlag(result.overlay ?? result.meta?.overlay);
      const scriptName =
        result.script_name || result.meta?.script_name || 'plot';
      return {
        ...result,
        series: result.series || {},
        events: result.events || [],
        meta: {
          ...(result.meta || {}),
          ms: performance.now() - t0,
          ...(overlay !== undefined ? { overlay } : {}),
          script_name: scriptName,
          transport: 'local',
          ...(unsupported.length ? { unsupported } : {}),
        },
      };
    } catch (err: unknown) {
      if (err instanceof PyodideAbortedError) {
        return pyodideAbortedResult(performance.now() - t0);
      }
      // Worker errors arrive pre-formatted (same formatPyodideBridgeError output).
      const msg = err instanceof PyodideWorkerError ? err.message : formatPyodideBridgeError(err);
      return {
        status: 'error',
        plots: [],
        series: {},
        events: [],
        drawings: [],
        error: msg,
        meta: { ms: performance.now() - t0 },
      };
    }
  },
};

/**
 * Resolve the pyne-worker base URL for readiness / run.
 * Prefer plugin config, then a store.endpoint that looks like pyne-worker, else production default.
 */
export function resolvePyneWorkerEndpoint(
  config?: Record<string, unknown> | null,
): string {
  const fromCfg = String(config?.endpoint || '').trim().replace(/\/$/, '');
  if (fromCfg) return fromCfg;
  const fromStore = String(store.endpoint || '').trim().replace(/\/$/, '');
  if (fromStore && /pyne-worker|pine-worker/i.test(fromStore)) return fromStore;
  return DEFAULT_PYNE_WORKER_ENDPOINT;
}

/** True when a base URL targets the HOOX pyne-worker (not AXIS worker-axis). */
export function looksLikePyneWorkerEndpoint(raw: string | undefined | null): boolean {
  const s = String(raw || '').toLowerCase();
  if (!s) return false;
  return s.includes('pyne-worker') || s.includes('pine-worker');
}

/**
 * HOOX **pyne-worker** edge evaluator — same `/run` contract as Flask Pro API,
 * default origin production workers.dev. Optional `apiKey` for `X-API-Key`.
 *
 * Distinct from the AXIS data-plane Worker (`worker-axis` / engine `server`
 * pointed at that host). Prefer this when you want edge Pine + alerts/cron mesh.
 */
export const pyneWorkerEngine: EnginePlugin = {
  id: 'pyne-worker',
  name: 'pyne-worker (edge)',
  kind: 'engine',
  builtIn: true,
  description:
    'HOOX pyne-worker Cloudflare® edge evaluator (POST /run). ' +
    'Default production origin is pyne-worker.cryptolinx.workers.dev. ' +
    'Set API key when the Worker secret API_KEY is required. ' +
    'Not the AXIS data-plane Worker (on-chain / scripts proxy).',
  capabilities: { needsNetwork: true },
  configSchema: {
    endpoint: {
      type: 'string',
      default: DEFAULT_PYNE_WORKER_ENDPOINT,
      label: 'pyne-worker URL',
    },
    mode: {
      type: 'select',
      options: ['interpret', 'compile', 'auto'],
      default: 'interpret',
      label: 'Execution mode',
      description:
        'interpret = AST; compile / auto when the edge runtime supports them (see /health features.modes)',
    },
    preferWs: {
      type: 'boolean',
      default: false,
      label: 'Prefer WebSocket (/ws/run)',
      description: 'Most pyne-worker deploys are REST-only; leave off unless /ws/run is enabled',
    },
    apiKey: {
      type: 'string',
      default: '',
      label: 'API key (X-API-Key)',
      description: 'Required when the Worker has secret API_KEY set (production)',
    },
  },
  async getCapabilities() {
    return { liveModes: ['bar-close'], ownsData: false };
  },
  async isReady() {
    const endpoint = resolvePyneWorkerEndpoint(
      resolveConfig(this.configSchema, {
        ...(store.pluginsConfig?.['engine:pyne-worker'] as Record<string, unknown> | undefined),
        endpoint: store.endpoint,
      }),
    );
    try {
      const res = await fetch(`${endpoint}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return false;
      const j = (await res.json()) as {
        status?: string;
        worker?: string;
        features?: unknown;
        engine?: unknown;
      };
      // pyne-worker health uses status: "ok" (not "healthy")
      if (j.worker === 'pyne-worker') return true;
      if (j.status === 'ok' || j.status === 'healthy') return true;
      if (j.features || j.engine) return true;
      return false;
    } catch {
      return false;
    }
  },
  async run(opts) {
    const pluginCfg =
      (store.pluginsConfig?.['engine:pyne-worker'] as Record<string, unknown> | undefined) ||
      {};
    const merged = {
      ...pluginCfg,
      ...(opts.config || {}),
    };
    const endpoint = resolvePyneWorkerEndpoint(merged);
    // Delegate to server engine (WS + REST + NaN cleanup + libraries retry)
    return serverEngine.run({
      ...opts,
      config: {
        ...merged,
        endpoint,
        // Default preferWs false unless user explicitly enabled it
        preferWs: merged.preferWs === true,
      },
    });
  },
};

/**
 * Resolve an engine's capabilities with a safe fallback.
 * Capability hydration must never throw or block the UI loop.
 *
 * The last resolved value is cached so synchronous callers (live-bar write
 * gates) can read it without a fetch; it is only a hint — an unresolved
 * cache means "not engine-owned", never the reverse.
 */
export async function getEngineCapabilities(id?: string): Promise<EngineCapabilities> {
  const fallback = (): EngineCapabilities => ({
    ...DEFAULT_ENGINE_CAPABILITIES,
    liveModes: [...DEFAULT_ENGINE_CAPABILITIES.liveModes],
  });
  const selectedId =
    id ||
    String(store.activePlugins?.engine || store.engine || '');
  const engine = selectedId ? getEngine(selectedId) : undefined;
  if (!engine || typeof engine.getCapabilities !== 'function') return fallback();
  try {
    const caps = await engine.getCapabilities();
    cachedEngineCapabilities = caps;
    // Only the `server` engine probes PYNE /health; a stale readiness badge
    // from the previous engine would misreport the newly selected one.
    if (engine.id !== 'server') cachedEngineHealth = null;
    return caps;
  } catch {
    return fallback();
  }
}

let cachedEngineCapabilities: EngineCapabilities | null = null;
let cachedEngineHealth: EngineHealth | null = null;

/** Synchronous read of the last resolved capabilities (default when unknown). */
export function getCachedEngineCapabilities(): EngineCapabilities {
  return cachedEngineCapabilities ?? {
    ...DEFAULT_ENGINE_CAPABILITIES,
    liveModes: [...DEFAULT_ENGINE_CAPABILITIES.liveModes],
  };
}

/**
 * Effective live re-run cadence for the selected engine.
 *
 * `store.live.rerunOn` is the user's stored preference — Settings owns it, and
 * capability resolution must never rewrite it (a silent downgrade reads as
 * "my setting does not save"). When the engine has positively advertised its
 * live modes and every-tick is not among them, callers run bar close instead;
 * while capabilities are unknown (no probe yet) the stored preference stands.
 */
export function liveRerunModeForEngine(
  stored: 'every-tick' | 'bar-close' | string | undefined,
): 'every-tick' | 'bar-close' {
  const mode: 'every-tick' | 'bar-close' =
    stored === 'bar-close' ? 'bar-close' : 'every-tick';
  if (mode !== 'every-tick' || cachedEngineCapabilities == null) return mode;
  return cachedEngineCapabilities.liveModes.includes('every-tick') ? 'every-tick' : 'bar-close';
}

/**
 * Last `/health`-derived readiness for the selected engine, or null when the
 * engine is not a PYNE server engine / the endpoint never answered. Read this
 * from UI badges and optional-surface gates; never infer support from it.
 */
export function getCachedEngineHealth(): EngineHealth | null {
  return cachedEngineHealth;
}

/** @internal test helper */
export function _setCachedEngineCapabilitiesForTests(caps: EngineCapabilities | null): void {
  cachedEngineCapabilities = caps;
}

/** @internal test helper */
export function _setCachedEngineHealthForTests(health: EngineHealth | null): void {
  cachedEngineHealth = health;
}

/** Both views of one `GET /health` body. */
export interface EngineHealthProbe {
  health: EngineHealth;
  capabilities: EngineCapabilities;
}

/**
 * Probe an explicit endpoint's `/health` and return both views.
 *
 * Deliberately side-effect free: the Runtime form uses it to inspect a draft
 * endpoint before Save, so it must not overwrite the caches that describe the
 * *selected* engine. Returns null when the endpoint is empty, unreachable, or
 * answers with something other than a JSON object.
 */
export async function probeEngineHealth(
  endpoint: string,
  timeoutMs = 5_000,
): Promise<EngineHealthProbe | null> {
  const base = String(endpoint || '').replace(/\/$/, '');
  if (!base) return null;
  try {
    const res = await fetch(`${base}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    return { health: healthFromBody(body), capabilities: capabilitiesFromHealth(body) };
  } catch {
    return null;
  }
}

export const BUILTIN_ENGINES: EnginePlugin[] = [
  serverEngine,
  pyneWorkerEngine,
  pyodideEngine,
];

let registered = false;

/**
 * Register built-in engines. Always re-installs so a dynamic plugin cannot
 * leave a stale `server` entry without `configSchema.mode`.
 */
export function ensureEnginesRegistered(): void {
  if (registered) return;
  registered = true;
  // Always (re)install built-ins so a dynamic plugin cannot leave a stale
  // `server` entry without configSchema.mode (Settings hides Execution mode).
  for (const e of BUILTIN_ENGINES) {
    registry.registerEngine(e);
  }
}

/** Look up an engine by id (ensures built-ins are registered). */
export function getEngine(id: string): EnginePlugin | undefined {
  ensureEnginesRegistered();
  return registry.getEngine(id);
}

/** All registered engines in registration order. */
export function listEngines(): EnginePlugin[] {
  ensureEnginesRegistered();
  return registry.listEngines();
}

/**
 * Register a runtime engine plugin. Cannot replace built-in `server` / `pyodide`.
 */
export function registerDynamicEngine(engine: EnginePlugin): void {
  ensureEnginesRegistered();
  if (!engine?.id || engine.kind !== 'engine') throw new Error('Invalid engine plugin');
  if (typeof engine.run !== 'function') throw new Error('Engine must implement run()');
  // Refuse to replace built-in engines (preserves Settings schema + run path)
  const existing = registry.getEngine(engine.id);
  if (
    existing?.builtIn &&
    (engine.id === 'server' || engine.id === 'pyodide' || engine.id === 'pyne-worker')
  ) {
    throw new Error(
      `Cannot replace built-in engine "${engine.id}" — use a different plugin id`,
    );
  }
  registry.registerEngine({ ...engine, builtIn: engine.builtIn ?? false });
}

export function unregisterDynamicEngine(id: string): boolean {
  ensureEnginesRegistered();
  return registry.unregisterEngine(id);
}

export function listDynamicEngineIds(): string[] {
  ensureEnginesRegistered();
  return registry.listEngines().filter((e) => !e.builtIn).map((e) => e.id);
}

/** @internal test helper */
export function _resetEngineRegistrationFlag() {
  registered = false;
}
