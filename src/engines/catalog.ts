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

import type { EnginePlugin, RunResult } from '../plugins/types';
import { store, setTelemetryPlane, setTelemetryState, setStatus, appendLog } from '../store';
import { registry } from '../plugins/registry';
import { classifyTransport } from '../ui/telemetry';

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

/** Ensure a URL is a real zip/wheel, not SPA HTML fallback (micropip BadZipFile). */
async function assertZipAsset(url: string, label: string): Promise<void> {
  const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new Error(`${label} missing: HTTP ${res.status} at ${url}`);
  }
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('text/html')) {
    throw new Error(
      `${label} returned HTML (SPA fallback) at ${url} — deploy public/vendor and public/pyodide into dist/`,
    );
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  // ZIP local file header magic: PK\x03\x04
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    const head = new TextDecoder().decode(buf.slice(0, 32));
    throw new Error(
      `${label} is not a zip/wheel at ${url} (got ${buf.length} bytes, starts with ${JSON.stringify(head)})`,
    );
  }
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
      default: 'interpret',
      label: 'Execution mode',
      description:
        'interpret = AST interpreter; compile = Numba/numpy path; auto = try compile, fall back to interpret',
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
  async run({ script, bars, config, inputs, libraries, signal }) {
    // Prefer store.endpoint (Settings) over plugin config so a stale
    // pluginsConfig.endpoint cannot pin an old backend after Save.
    // Explicit config.endpoint still wins when set (e.g. pyne-worker engine).
    const endpoint = (
      (config?.endpoint as string) ||
      store.endpoint ||
      (this.configSchema!.endpoint.default as string)
    ).replace(/\/$/, '');
    const cfg = resolveConfig(this.configSchema, { ...(config || {}), endpoint });
    const mode = String(cfg.mode || 'interpret');
    const preferWs = cfg.preferWs !== false;
    const apiKey = String(cfg.apiKey || '').trim();
    const t0 = performance.now();
    // Generous budget: compile + large OHLCV can exceed 30s on cold Numba.
    const timeoutMs = Math.min(
      180_000,
      Math.max(90_000, 45_000 + (bars?.length || 0) * 40),
    );
    const inputOverrides =
      inputs && typeof inputs === 'object' && Object.keys(inputs).length
        ? inputs
        : undefined;

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
          const profilerOn = cfg.profiler === true;
          const wsResult = await client.run(
            {
              script,
              data: bars as unknown[],
              mode: profilerOn ? 'interpret' : mode,
              // Always a string — API schema rejects null/omitted-as-null
              symbol: typeof store.symbol === 'string' && store.symbol ? store.symbol : 'CHART',
              ...(inputOverrides ? { inputs: inputOverrides } : {}),
              ...(profilerOn ? { profiler: true } : {}),
              ...(libraries?.length ? { libraries } : {}),
            },
            wsBudget,
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
          return {
            status: 'success',
            plots: (wsResult.plots as (number | null)[]) || [],
            series: (wsResult.series as Record<string, (number | null)[]>) || {},
            events: (wsResult.events as RunResult['events']) || [],
            drawings: (wsResult.drawings as RunResult['drawings']) || [],
            inputs: (wsResult as { inputs?: unknown }).inputs,
            ...(wsProfile ? { profile: wsProfile } : {}),
            ...(Array.isArray(wsLogs) ? { logs: wsLogs } : {}),
            meta: {
              ...(typeof wsResult.meta === 'object' && wsResult.meta ? wsResult.meta : {}),
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
      } catch {
        // Fall through to REST with a fresh timeout (see below).
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
      const restTimeout = AbortSignal.timeout(restBudget);
      const restSignal =
        signal && typeof AbortSignal.any === 'function'
          ? AbortSignal.any([restTimeout, signal])
          : restTimeout;
      // mode must be in the JSON body — Pro API validates body only (query is legacy).
      const profilerOn = cfg.profiler === true;
      const restMode = profilerOn ? 'interpret' : mode;
      const restBody = {
        script,
        data: bars,
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
      // Older Pro APIs reject unknown `libraries` — retry without them.
      if (!res.ok && libraries?.length) {
        const peek = await res.clone().text();
        if (/UNKNOWN_FIELDS|libraries/i.test(peek)) {
          const { libraries: _drop, ...legacy } = restBody;
          res = await fetch(`${endpoint}/run?mode=${encodeURIComponent(restMode)}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(legacy),
            signal: restSignal,
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
        // Python json.dumps can emit bare NaN; browsers reject that. Normalize first.
        const cleaned = text
          .replace(/\bNaN\b/g, 'null')
          .replace(/\b-?Infinity\b/g, 'null');
        payload = JSON.parse(cleaned);
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
      const restOverlay = normalizeOverlayFlag(payload.overlay ?? payload.meta?.overlay);
      const restName =
        payload.script_name || payload.meta?.script_name || 'plot';
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
        series: (payload.series as Record<string, (number | null)[]>) || {},
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
          ...(restScriptType ? { script_type: restScriptType } : {}),
          plot_meta: payload.plot_meta || payload.meta?.plot_meta || {},
          inputs: payload.inputs,
          ...(restProfile ? { profile: restProfile } : {}),
          ...(Array.isArray(restLogs) ? { logs: restLogs } : {}),
        },
      } satisfies RunResult;
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
 * Narrow Pyodide surface used by the browser engine.
 * micropip 0.6: `install(req, keep_going=False, deps=True, …)` — third arg is deps.
 */
type PyodideLike = {
  loadPackage: (name: string) => Promise<void>;
  pyimport: (name: string) => {
    install: (
      url: string,
      keepGoing?: boolean,
      deps?: boolean,
    ) => Promise<void>;
  };
  runPythonAsync: (code: string) => Promise<void>;
  runPython: (code: string) => string;
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

/** Self-hosted Pyodide (public/pyodide/v0.26.2 — ~14MB, no CDN required). */
export const LOCAL_PYODIDE_VERSION = '0.26.2';
export const LOCAL_PYODIDE_INDEX = `/pyodide/v${LOCAL_PYODIDE_VERSION}/`;

/** Absolute indexURL with trailing slash (relative paths resolve against location.origin). */
export function resolvePyodideIndexUrl(configured?: string): string {
  const raw = (configured || LOCAL_PYODIDE_INDEX).trim() || LOCAL_PYODIDE_INDEX;
  if (/^https?:\/\//i.test(raw)) {
    return raw.endsWith('/') ? raw : `${raw}/`;
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
  if (typeof document === 'undefined') return;
  const base = resolvePyodideIndexUrl(indexUrl);
  const files = [
    'pyodide.js',
    'pyodide.asm.js',
    'pyodide.asm.wasm',
    'python_stdlib.zip',
    'pyodide-lock.json',
    'micropip-0.6.0-py3-none-any.whl',
    'packaging-23.2-py3-none-any.whl',
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
      '/vendor/pynescript-0.3.7-py3-none-any.whl',
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

  if (!pyodideEngine._pyodide && reportHud()) {
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
        setStatus('ready', 'Pyodide ready · offline evaluate available');
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

export const pyodideEngine: EnginePlugin & {
  _pyodide: PyodideLike | null;
  _loadPromise: Promise<PyodideLike> | null;
  _ensure: () => Promise<PyodideLike>;
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
      label: 'Pyodide index URL (default: self-hosted /pyodide/v0.26.2/)',
    },
    // Same control as server — browser runtime accepts mode; pure Numba compile
    // still needs the server engine (Numba is not available in Wasm).
    mode: {
      type: 'select',
      options: ['interpret', 'compile', 'auto'],
      default: 'interpret',
      label: 'Execution mode',
      description:
        'interpret = AST in browser; compile/auto use pynescript.compiler when possible (object-mode without Numba; numeric Numba needs server)',
    },
  },
  _pyodide: null,
  _loadPromise: null,
  async isReady() {
    try {
      await this._ensure();
      return true;
    } catch {
      return false;
    }
  },
  async _ensure() {
    if (this._pyodide) return this._pyodide;
    if (this._loadPromise) return this._loadPromise;
    const self = this;
    const cfg = resolveConfig(this.configSchema, pyodidePluginConfig());
    const indexUrl = resolvePyodideIndexUrl(String(cfg.indexUrl || LOCAL_PYODIDE_INDEX));
    this._loadPromise = (async () => {
      const origin = typeof location !== 'undefined' ? location.origin : '';
      prefetchPyodideAssets(indexUrl);

      if (typeof window !== 'undefined' && typeof window.loadPyodide !== 'function') {
        await import(/* @vite-ignore */ `${indexUrl}pyodide.js`);
      }
      if (typeof window === 'undefined' || typeof window.loadPyodide !== 'function') {
        throw new Error('loadPyodide not available');
      }
      const py = await window.loadPyodide({ indexURL: indexUrl });
      // micropip + packaging served from same self-hosted index
      await py.loadPackage('micropip');
      const micropip = py.pyimport('micropip');

      // Local wheels under /vendor (public/ → dist). Validate before micropip
      // so SPA HTML fallbacks surface as clear errors instead of BadZipFile.
      //
      // deps=false: the pynescript METADATA requires click/requests/tqdm (CLI/API),
      // which are not needed for in-browser evaluate and are NOT vendored under
      // /pyodide/v0.26.2/ — micropip would 404 them on the self-hosted index.
      // Second positional arg alone is keep_going, not deps (micropip 0.6).
      const wheelUrl = `${origin}/vendor/pynescript-0.3.7-py3-none-any.whl`;
      const antlrUrl = `${origin}/vendor/antlr4_python3_runtime-4.13.2-py3-none-any.whl`;
      await assertZipAsset(wheelUrl, 'pynescript wheel');
      await assertZipAsset(antlrUrl, 'antlr4 wheel');
      try {
        // antlr first so pynescript import can resolve
        await micropip.install(antlrUrl, false, false);
        await micropip.install(wheelUrl, false, false);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Failed to install browser wheels from ${origin}/vendor: ${msg}`);
      }

      const runtimeUrl = `${origin}/pyodide/pynescript_runtime.py`;
      const runtimeResp = await fetch(runtimeUrl);
      if (!runtimeResp.ok) {
        throw new Error(`Failed to load pynescript_runtime.py: HTTP ${runtimeResp.status} (${runtimeUrl})`);
      }
      const runtimeCt = runtimeResp.headers.get('content-type') || '';
      const runtimePy = await runtimeResp.text();
      if (runtimeCt.includes('text/html') || runtimePy.trimStart().startsWith('<!')) {
        throw new Error(
          `pynescript_runtime.py returned HTML instead of Python — is ${runtimeUrl} deployed under dist/pyodide/?`,
        );
      }
      await py.runPythonAsync(runtimePy);
      self._pyodide = py;
      return py;
    })().catch((err) => {
      self._loadPromise = null;
      throw err;
    });
    return this._loadPromise;
  },
  async run({ script, bars, config, libraries }) {
    const t0 = performance.now();
    try {
      const py = await this._ensure();
      const cfg = resolveConfig(this.configSchema, {
        ...pyodidePluginConfig(),
        ...(config || {}),
      });
      const mode = String((cfg as { mode?: string }).mode || 'interpret');
      // Optional: load numpy for compile/object-mode (no-op if already present)
      if (mode === 'compile' || mode === 'auto') {
        try {
          await py.loadPackage?.('numpy');
        } catch {
          /* interpret fallback handles missing numpy */
        }
      }
      const resultJson = py.runPython(
        `run_script(${JSON.stringify(script)}, ${JSON.stringify(bars)}, ${JSON.stringify(mode)}, ${JSON.stringify(libraries || [])})`,
      );
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
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 'error',
        plots: [],
        series: {},
        events: [],
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

/** True when a base URL targets the HOOX pyne-worker (not AXIS pynescript-axis). */
export function looksLikePyneWorkerEndpoint(raw: string | undefined | null): boolean {
  const s = String(raw || '').toLowerCase();
  if (!s) return false;
  return s.includes('pyne-worker') || s.includes('pine-worker');
}

/**
 * HOOX **pyne-worker** edge evaluator — same `/run` contract as Flask Pro API,
 * default origin production workers.dev. Optional `apiKey` for `X-API-Key`.
 *
 * Distinct from the AXIS data-plane Worker (`pynescript-axis` / engine `server`
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
