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
 * | `server` | WebSocket `/ws/run` preferred, then `POST /run` | pyne Pro API (default `http://localhost:5002`) or Worker |
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
 * - {@link serverEngine} / {@link pyodideEngine} — plugin instances
 * - {@link ensureEnginesRegistered}, {@link getEngine}, {@link listEngines}
 * - {@link registerDynamicEngine} / {@link unregisterDynamicEngine} — runtime plugins
 * - {@link preloadPyodide}, {@link prefetchPyodideAssets} — cold-load helpers
 *
 * @module engines/catalog
 * @see {@link EnginePlugin} in `plugins/types`
 * @see {@link engine-ws} for the persistent WS client
 */

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
  },
  async isReady() {
    const endpoint = (store.endpoint || this.configSchema!.endpoint.default as string).replace(/\/$/, '');
    try {
      const res = await fetch(`${endpoint}/`, {
        method: 'GET',
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return false;
      // Best-effort warm WS when health advertises it
      try {
        const j = (await res.clone().json()) as { websocket?: boolean };
        if (j.websocket) {
          const { probeEngineWs } = await import('./engine-ws');
          void probeEngineWs(endpoint, 3_000);
        }
      } catch {
        /* health body optional */
      }
      return true;
    } catch {
      return false;
    }
  },
  async run({ script, bars, config, inputs, signal }) {
    // Prefer store.endpoint (Settings) over plugin config so a stale
    // pluginsConfig.endpoint cannot pin an old backend after Save.
    const endpoint = (
      store.endpoint ||
      (config?.endpoint as string) ||
      (this.configSchema!.endpoint.default as string)
    ).replace(/\/$/, '');
    const cfg = resolveConfig(this.configSchema, { ...(config || {}), endpoint });
    const mode = String(cfg.mode || 'interpret');
    const preferWs = cfg.preferWs !== false;
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
          const wsResult = await client.run(
            {
              script,
              data: bars as unknown[],
              mode,
              // Always a string — API schema rejects null/omitted-as-null
              symbol: typeof store.symbol === 'string' && store.symbol ? store.symbol : 'CHART',
              ...(inputOverrides ? { inputs: inputOverrides } : {}),
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
          const wsOverlay =
            wsResult.overlay ??
            (wsResult.meta as { overlay?: boolean } | undefined)?.overlay ??
            true;
          const wsName =
            (wsResult.script_name as string) ||
            (wsResult.meta as { script_name?: string } | undefined)?.script_name ||
            'plot';
          return {
            status: 'success',
            plots: (wsResult.plots as (number | null)[]) || [],
            series: (wsResult.series as Record<string, (number | null)[]>) || {},
            events: (wsResult.events as RunResult['events']) || [],
            drawings: (wsResult.drawings as RunResult['drawings']) || [],
            inputs: (wsResult as { inputs?: unknown }).inputs,
            meta: {
              ms,
              transport: 'ws',
              mode: wsResult.mode || mode,
              script_id: wsResult.script_id,
              run_id: wsResult.run_id,
              overlay: wsOverlay !== false,
              script_name: wsName,
              plot_meta: wsResult.plot_meta || {},
              inputs: (wsResult as { inputs?: unknown }).inputs,
            },
          } satisfies RunResult;
        }
      } catch {
        // Fall through to REST with a fresh timeout (see below).
      }
    }

    // ── REST fallback ─────────────────────────────────────────────
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      // Never reuse a parent AbortSignal that already fired while WS was tried —
      // browsers surface that as "The operation timed out." with no REST attempt.
      const elapsed = performance.now() - t0;
      const restBudget = Math.max(45_000, timeoutMs - elapsed);
      const restSignal = AbortSignal.timeout(restBudget);
      void signal; // engine-level cancel reserved; REST uses its own budget after WS
      // mode must be in the JSON body — Pro API validates body only (query is legacy).
      const res = await fetch(`${endpoint}/run?mode=${encodeURIComponent(mode)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          script,
          data: bars,
          mode,
          ...(inputOverrides ? { inputs: inputOverrides } : {}),
        }),
        signal: restSignal,
      });
      const text = await res.text();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let payload: any;
      try {
        // Python json.dumps can emit bare NaN; browsers reject that. Normalize first.
        const cleaned = text
          .replace(/\bNaN\b/g, 'null')
          .replace(/\b-?Infinity\b/g, 'null');
        payload = JSON.parse(cleaned);
      } catch {
        const snippet = text.slice(0, 120).replace(/\s+/g, ' ');
        payload = {
          status: 'error',
          message: `invalid JSON (HTTP ${res.status}${snippet ? `: ${snippet}` : ''})`,
        };
      }
      if (!res.ok || payload.status === 'error') {
        return {
          status: 'error',
          plots: [],
          events: [],
          series: {},
          error: String(payload.message || payload.error || `HTTP ${res.status}`),
          meta: { ms: performance.now() - t0, transport: 'rest' },
        } satisfies RunResult;
      }
      const restOverlay =
        payload.overlay ?? payload.meta?.overlay ?? true;
      const restName =
        payload.script_name || payload.meta?.script_name || 'plot';
      return {
        status: 'success',
        plots: (payload.plots as (number | null)[]) || [],
        series: (payload.series as Record<string, (number | null)[]>) || {},
        events: (payload.events as RunResult['events']) || [],
        drawings: (payload.drawings as RunResult['drawings']) || [],
        inputs: payload.inputs,
        meta: {
          ...(payload.meta || {}),
          ms: performance.now() - t0,
          transport: 'rest',
          mode: payload.mode as string | undefined,
          script_id: payload.script_id as string | undefined,
          run_id: payload.run_id as string | undefined,
          overlay: restOverlay !== false,
          script_name: restName as string,
          plot_meta: payload.plot_meta || {},
          inputs: payload.inputs,
        },
      } satisfies RunResult;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
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

type PyodideLike = {
  loadPackage: (name: string) => Promise<void>;
  pyimport: (name: string) => { install: (url: string, keep?: boolean) => Promise<void> };
  runPythonAsync: (code: string) => Promise<void>;
  runPython: (code: string) => string;
};

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
      '/vendor/pynescript-0.2.0-py3-none-any.whl',
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
      const wheelUrl = `${origin}/vendor/pynescript-0.2.0-py3-none-any.whl`;
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
  async run({ script, bars, config }) {
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
        `run_script(${JSON.stringify(script)}, ${JSON.stringify(bars)}, ${JSON.stringify(mode)})`,
      );
      const result = JSON.parse(resultJson) as RunResult & {
        overlay?: boolean;
        script_name?: string;
      };
      const overlay =
        result.overlay ?? result.meta?.overlay ?? true;
      const scriptName =
        result.script_name || result.meta?.script_name || 'plot';
      return {
        ...result,
        series: result.series || {},
        events: result.events || [],
        meta: {
          ...(result.meta || {}),
          ms: performance.now() - t0,
          overlay: overlay !== false,
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

export const BUILTIN_ENGINES: EnginePlugin[] = [serverEngine, pyodideEngine];

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
  // Refuse to replace built-in server/pyodide (preserves Settings schema + run path)
  const existing = registry.getEngine(engine.id);
  if (existing?.builtIn && (engine.id === 'server' || engine.id === 'pyodide')) {
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
