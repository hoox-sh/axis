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
 * Pyodide runtime helpers shared by the Web Worker (`pyodide.worker.ts`) and
 * the main-thread engine (`engines/catalog.ts`, used only as the in-thread
 * fallback when no Worker is available).
 *
 * Keep this module free of DOM, store and registry imports: it is bundled into
 * the worker and must stay loadable there.
 *
 * @module workers/pyodide-runtime
 */

/**
 * Narrow Pyodide surface used by the browser engine.
 * micropip 0.6: `install(req, keep_going=False, deps=True, …)` — third arg is deps.
 */
export type PyodideLike = {
  loadPackage: (name: string) => Promise<void>;
  pyimport: (name: string) => {
    install: (
      url: string,
      keepGoing?: boolean,
      deps?: boolean,
    ) => Promise<void>;
  };
  runPythonAsync: (code: string) => Promise<void>;
  runPython: (code: string) => unknown;
  globals: {
    set: (key: string, value: unknown) => void;
    /** PyProxy dict delete — optional so narrow test doubles still type-check. */
    delete?: (key: string) => void;
  };
};

/**
 * Format a Pyodide bridge failure with the full Python traceback.
 * `err.message` alone is truncated (`…`) by Pyodide's eval_code wrapper —
 * prefer `stack`, which carries the complete `Traceback (most recent call …)`.
 * When the stack is too long, trim the *middle* — the head keeps the
 * `eval_code` frame context and the tail keeps the final Python exception
 * line (`NameError: …`), which is the part that matters.
 */

/** Long-traceback budget: keep the head and the tail, drop the middle frames. */
const TRACEBACK_KEEP_MAX = 6000;
const TRACEBACK_KEEP_HEAD = 2000;
const TRACEBACK_KEEP_TAIL = TRACEBACK_KEEP_MAX - TRACEBACK_KEEP_HEAD;

export function formatPyodideBridgeError(err: unknown): string {
  if (err instanceof Error) {
    const stack = typeof err.stack === 'string' ? err.stack.trim() : '';
    const full = stack || err.message;
    if (full.length <= TRACEBACK_KEEP_MAX) return full;
    const head = full.slice(0, TRACEBACK_KEEP_HEAD).replace(/\s+$/, '');
    const tail = full.slice(-TRACEBACK_KEEP_TAIL).replace(/^\s+/, '');
    return `${head} … [${full.length - TRACEBACK_KEEP_MAX} chars trimmed] …\n${tail}`;
  }
  return String(err);
}

/**
 * Invoke the in-browser `run_script` bridge without interpolating raw JSON
 * into Python source. Direct interpolation emits JSON literals (`null`,
 * `true`, `false`) that are `NameError`s in Python — any bar with a null
 * field (gap, NaN→null) crashed eval_code before Pine ever ran, surfacing
 * only as a truncated `_pyodide/_base.py` traceback. Passing JSON strings
 * via `globals` + `json.loads` keeps parsing on the JSON side.
 */
export function callPyodideRunScript(
  py: PyodideLike,
  script: string,
  bars: unknown,
  mode: string,
  libraries: unknown,
  /**
   * Pine input overrides. Passed as a 5th positional argument only when the
   * loaded runtime accepts it — see {@link pyodideRuntimeAcceptsInputs}.
   */
  inputs?: Record<string, unknown>,
): string {
  const globalsKeys = [
    '_axis_script_json',
    '_axis_bars_json',
    '_axis_mode_json',
    '_axis_libs_json',
  ];
  py.globals.set('_axis_script_json', JSON.stringify(script));
  py.globals.set('_axis_bars_json', JSON.stringify(bars ?? []));
  py.globals.set('_axis_mode_json', JSON.stringify(mode));
  py.globals.set('_axis_libs_json', JSON.stringify(libraries ?? []));
  let call =
    'run_script(__import__("json").loads(_axis_script_json), ' +
    '__import__("json").loads(_axis_bars_json), ' +
    '__import__("json").loads(_axis_mode_json), ' +
    '__import__("json").loads(_axis_libs_json)';
  if (inputs !== undefined) {
    py.globals.set('_axis_inputs_json', JSON.stringify(inputs));
    globalsKeys.push('_axis_inputs_json');
    call += ', __import__("json").loads(_axis_inputs_json)';
  }
  call += ')';
  try {
    return String(py.runPython(call));
  } finally {
    // Bars JSON can be megabytes; do not keep it alive in the Python globals
    // between runs (the next run overwrites it anyway).
    for (const key of globalsKeys) {
      try {
        py.globals.delete?.(key);
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

const runtimeInputsSupport = new WeakMap<object, boolean>();

/**
 * True when the loaded `run_script` accepts an `inputs` parameter.
 * Probed once per Pyodide instance via `inspect` so the JS side can forward
 * Script Settings as soon as the runtime supports them, without a JS release.
 */
export function pyodideRuntimeAcceptsInputs(py: PyodideLike): boolean {
  const cached = runtimeInputsSupport.get(py);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    ok =
      py.runPython(
        "'inputs' in __import__('inspect').signature(run_script).parameters",
      ) === true;
  } catch {
    ok = false;
  }
  runtimeInputsSupport.set(py, ok);
  return ok;
}

/** Ensure a URL is a real zip/wheel, not SPA HTML fallback (micropip BadZipFile). */
export async function assertZipAsset(url: string, label: string): Promise<void> {
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

/**
 * Install micropip wheels and the `pynescript_runtime.py` bridge into a fresh
 * Pyodide instance. This is the single source of the load sequence: the
 * in-thread engine and the worker both call it, so the order and the checks
 * cannot drift apart.
 *
 * `origin` is the page origin (the worker passes its own `location.origin`,
 * which is the app origin because the worker script is same-origin).
 */
export async function installPynescriptRuntime(py: PyodideLike, origin: string): Promise<void> {
  // micropip + packaging served from same self-hosted index
  await py.loadPackage('micropip');
  const micropip = py.pyimport('micropip');

  // Local wheels under /vendor (public/ → dist). Validate before micropip
  // so SPA HTML fallbacks surface as clear errors instead of BadZipFile.
  //
  // deps=false: the pynescript METADATA requires click/requests/tqdm (CLI/API),
  // which are not needed for in-browser evaluate and are NOT vendored under
  // /pyodide/v0.29.5/ — micropip would 404 them on the self-hosted index.
  // Second positional arg alone is keep_going, not deps (micropip 0.6).
  const wheelUrl = `${origin}/vendor/pynescript-0.6.25-py3-none-any.whl`;
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
}
