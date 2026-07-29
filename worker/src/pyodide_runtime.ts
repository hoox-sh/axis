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
 * In-Worker Python runtime via Pyodide (scaffold).
 *
 * When `PYODIDE_IN_WORKER=enabled`, lazily loads Pyodide (CDN today; R2 /
 * workerd-native in production), installs the pynescript wheel, and maps
 * `/api/run` bodies to a Python `run_script(script, bars)` bridge.
 *
 * **Status:** boot path is wired; wheel install + `run_script` global are
 * still stubs. Until `RUNTIME.md` upload pipeline ships, callers typically
 * fall through to `EXTERNAL_BACKEND` after a soft failure, or receive an
 * error-shaped JSON object from the catch path.
 *
 * Isolate-scoped `pyReady` memoizes the load promise across requests on the
 * same Worker isolate (cold start still pays CDN cost once).
 */

import type { Env } from './index';

/** Cached Pyodide bootstrap promise for this isolate (null until first attempt). */
let pyReady: Promise<unknown> | null = null;

/**
 * Load Pyodide once per isolate. Production should swap CDN for workerd-native
 * and mount the wheel from `env.BUNDLES` (R2).
 */
async function ensurePyodide(_env: Env): Promise<unknown> {
    if (pyReady) return pyReady;
    pyReady = (async () => {
        // Two ways to boot Pyodide in a Worker:
        //   1. `workerd-pyodide` (workerd-native, fastest).
        //   2. Load from CDN at module init (simpler, slower cold start).
        // We use the CDN approach here and let the deploy pipeline swap it
        // for workerd-native in production.
        const indexURL = 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/';
        const { loadPyodide } = await import(/* @vite-ignore */ `${indexURL}pyodide.js`);
        const py = await (loadPyodide as (opts: { indexURL: string }) => Promise<unknown>)({ indexURL });
        // Stub: in production, load the wheel from R2.
        // await (py as { runPythonAsync: (s: string) => Promise<void> }).runPythonAsync(`
        //     import micropip
        //     await micropip.install('https://r2.example.com/pynescript-0.x.whl')
        // `);
        return py;
    })();
    return pyReady;
}

/**
 * Attempt an in-worker run. Returns `null` when the feature flag is off
 * (caller should proxy). On runtime errors returns `{ status:'error', error }`
 * so the HTTP layer can still 200 an error envelope (or the caller may proxy).
 */
export async function tryRunInWorker(script: string, bars: unknown[], env: Env): Promise<unknown | null> {
    if (env.PYODIDE_IN_WORKER !== 'enabled') return null;
    try {
        const py = await ensurePyodide(env);
        // @ts-expect-error - Pyodide dynamic
        const json = await py.runPythonAsync(`run_script(${JSON.stringify(script)}, ${JSON.stringify(bars)})`);
        return JSON.parse(json as string);
    } catch (err) {
        return { status: 'error', error: err instanceof Error ? err.message : String(err) };
    }
}
