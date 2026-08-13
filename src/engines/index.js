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
 * Legacy calculation engine plugins (pre-Solid path).
 *
 * Prefer the TypeScript catalog at `src/engines/catalog.ts` for AXIS Solid UI.
 * Both engines implement the same contract:
 *
 * ```
 * isReady() → Promise<boolean>
 * run({ script, bars, config }) → Promise<RunResult>
 * ```
 *
 * RunResult shape:
 * ```
 * {
 *   status: 'success' | 'error',
 *   plots: (number|null)[],
 *   series?: Record<string, (number|null)[]>,
 *   events: any[],
 *   error?: string,
 *   meta?: { mode?, script_id?, run_id?, ms? },
 * }
 * ```
 *
 * - **serverEngine**: `POST {endpoint}/run` (Flask/Worker); uses legacy `state.js`.
 * - **pyodideEngine**: self-hosted Pyodide + `/vendor` wheels + `pynescript_runtime.py`.
 *
 * @module engines/index (legacy)
 * @see src/engines/catalog.ts
 */

import { getState } from '../state.js';

function resolveConfig(schema, config) {
    const out = {};
    for (const [k, def] of Object.entries(schema || {})) {
        out[k] = def && Object.prototype.hasOwnProperty.call(def, 'default') ? def.default : undefined;
    }
    for (const [k, v] of Object.entries(config || {})) {
        if (v !== undefined) out[k] = v;
    }
    return out;
}

export const serverEngine = {
    id: 'server',
    name: 'Server-Side',
    kind: 'engine',
    description: 'Sends the script + bars to the configured backend (Flask or Cloudflare Worker) and renders its response.',
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
        const state = getState();
        const cfg = resolveConfig(this.configSchema, { endpoint: state?.get?.('endpoint') });
        try {
            const res = await fetch(`${cfg.endpoint}/`, {
                method: 'GET',
                signal: AbortSignal.timeout(30_000),
            });
            return res.ok;
        } catch (_) { return false; }
    },
    async run({ script, bars, config }) {
        const state = getState();
        const endpoint = config?.endpoint || state?.get?.('endpoint') || this.configSchema.endpoint.default;
        const cfg = resolveConfig(this.configSchema, { ...(config || {}), endpoint });
        const headers = { 'Content-Type': 'application/json' };
        if (state?.get?.('mode') === 'cloud' && state?.get?.('apiKey')) {
            headers['Authorization'] = `Bearer ${state.get('apiKey')}`;
        }
        const t0 = performance.now();
        try {
            // mode must be in the JSON body — Pro API validates body only (query is legacy).
            const res = await fetch(`${cfg.endpoint}/run?mode=${encodeURIComponent(cfg.mode)}`, {
                method: 'POST', headers, body: JSON.stringify({ script, data: bars, mode: cfg.mode }),
                signal: AbortSignal.timeout(30_000),
            });
            const text = await res.text();
            let payload;
            try {
                const cleaned = text.replace(/\bNaN\b/g, 'null').replace(/\b-?Infinity\b/g, 'null');
                payload = JSON.parse(cleaned);
            } catch {
                const snippet = text.slice(0, 120).replace(/\s+/g, ' ');
                payload = { status: 'error', message: `invalid JSON (HTTP ${res.status}${snippet ? `: ${snippet}` : ''})` };
            }
            if (!res.ok || payload.status === 'error') {
                return { status: 'error', plots: [], events: [], error: payload.message || `HTTP ${res.status}`, meta: { ms: performance.now() - t0 } };
            }
            return {
                status: 'success',
                plots: payload.plots || [],
                series: payload.series || {},
                events: payload.events || [],
                meta: { ...(payload.meta || {}), ms: performance.now() - t0, mode: payload.mode, script_id: payload.script_id, run_id: payload.run_id },
            };
        } catch (err) {
            return { status: 'error', plots: [], events: [], error: err.message, meta: { ms: performance.now() - t0 } };
        }
    },
};

export const pyodideEngine = {
    id: 'pyodide',
    name: 'Client-Side (Pyodide)',
    kind: 'engine',
    description: 'Self-hosted Pyodide (~14MB from this origin). Preloads on idle; no CDN required after deploy.',
    configSchema: {
        indexUrl: { type: 'string', default: '/pyodide/v0.26.2/', label: 'Pyodide index URL (self-hosted)' },
        mode: {
            type: 'select',
            options: ['interpret', 'compile', 'auto'],
            default: 'interpret',
            label: 'Execution mode',
            description:
                'interpret = AST in browser; compile needs NumPy/object-mode; numeric Numba needs server engine',
        },
    },
    _pyodide: null,
    _loadPromise: null,
    _progressCallback: null,
    setProgressCallback(cb) { this._progressCallback = cb; },
    _emitProgress(msg) { if (this._progressCallback) this._progressCallback(msg); },
    async isReady() {
        try { await this._ensure(); return true; } catch (_) { return false; }
    },
    async _ensure() {
        if (this._pyodide) return this._pyodide;
        if (this._loadPromise) return this._loadPromise;
        const self = this;
        const cfg = resolveConfig(this.configSchema, {});
        // Overall timeout: 90s should be plenty for CDN + wheel + runtime
        const TIMEOUT_MS = 90_000;
        const timer = setTimeout(() => {
            self._loadPromise = null;
            self._emitProgress('');
        }, TIMEOUT_MS);
        this._loadPromise = (async () => {
            try {
                const origin = location.origin;
                self._emitProgress('Loading Pyodide runtime…');
                // Inject Pyodide loader if not already present.
                if (typeof loadPyodide !== 'function') {
                    try {
                        await import(/* @vite-ignore */ `${cfg.indexUrl}pyodide.js`);
                    } catch (e) {
                        clearTimeout(timer);
                        throw new Error(`Failed to load Pyodide from CDN: ${e.message}. Check your internet connection.`);
                    }
                }
                self._emitProgress('Initialising Pyodide…');
                const timeoutPy = AbortSignal.timeout(TIMEOUT_MS - 10_000);
                const py = await window.loadPyodide({ indexURL: cfg.indexUrl, signal: timeoutPy });

                self._emitProgress('Installing micropip…');
                await py.loadPackage('micropip');

                self._emitProgress('Installing pynescript…');
                const micropip = py.pyimport('micropip');
                const wheelUrl = `${origin}/vendor/pynescript-0.3.6-py3-none-any.whl`;
                const antlrUrl = `${origin}/vendor/antlr4_python3_runtime-4.13.2-py3-none-any.whl`;
                // Guard against SPA HTML fallback → micropip BadZipFile
                const wheelRes = await fetch(wheelUrl);
                if (!wheelRes.ok) {
                    throw new Error(`pynescript wheel missing: HTTP ${wheelRes.status} at ${wheelUrl}`);
                }
                const wheelCt = (wheelRes.headers.get('content-type') || '').toLowerCase();
                if (wheelCt.includes('text/html')) {
                    throw new Error(
                        `pynescript wheel returned HTML (SPA fallback) at ${wheelUrl} — deploy public/vendor into dist/`,
                    );
                }
                // deps=false: do not pull click/requests/tqdm (not on self-hosted index)
                try {
                    const antlrRes = await fetch(antlrUrl);
                    if (antlrRes.ok && !(antlrRes.headers.get('content-type') || '').includes('text/html')) {
                        await micropip.install(antlrUrl, false, false);
                    } else {
                        await micropip.install('antlr4-python3-runtime>=4.13.1', false, false);
                    }
                    await micropip.install(wheelUrl, false, false);
                } catch (e) {
                    throw new Error(`Failed to load browser wheels from ${origin}: ${e.message}`);
                }

                self._emitProgress('Loading Pine runtime…');
                const runtimeResp = await fetch(`${origin}/pyodide/pynescript_runtime.py`);
                if (!runtimeResp.ok) throw new Error(`Failed to load pynescript_runtime.py: HTTP ${runtimeResp.status}`);
                const runtimePy = await runtimeResp.text();
                if (runtimePy.trimStart().startsWith('<!')) {
                    throw new Error(`pynescript_runtime.py returned HTML — deploy public/pyodide into dist/`);
                }
                await py.runPythonAsync(runtimePy);

                self._emitProgress('');
                clearTimeout(timer);
                self._pyodide = py;
                return py;
            } catch (err) {
                self._loadPromise = null;
                self._emitProgress('');
                clearTimeout(timer);
                throw err;
            }
        })();
        return this._loadPromise;
    },
    async run({ script, bars, config }) {
        const t0 = performance.now();
        try {
            const py = await this._ensure();
            const mode = String(config?.mode || 'interpret');
            if (mode === 'compile' || mode === 'auto') {
                try { await py.loadPackage?.('numpy'); } catch (_) { /* fallback */ }
            }
            const resultJson = py.runPython(
                `run_script(${JSON.stringify(script)}, ${JSON.stringify(bars)}, ${JSON.stringify(mode)})`,
            );
            const result = JSON.parse(resultJson);
            return { ...result, meta: { ...(result.meta || {}), ms: performance.now() - t0 } };
        } catch (err) {
            return { status: 'error', plots: [], series: {}, events: [], error: err.message, meta: { ms: performance.now() - t0 } };
        }
    },
};
