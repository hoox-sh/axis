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
 * Request handler that runs inside the Pyodide worker. Kept free of `self`
 * wiring so the protocol can be exercised with fake deps in bun tests.
 *
 * @module workers/pyodide-worker-core
 */

import {
  callPyodideRunScript,
  formatPyodideBridgeError,
  installPynescriptRuntime,
  pyodideRuntimeAcceptsInputs,
  type PyodideLike,
} from './pyodide-runtime';
import type {
  PyodideLoadRequest,
  PyodideRunRequest,
  PyodideWorkerRequest,
  PyodideWorkerResponse,
} from './pyodide-protocol';

export interface PyodideWorkerCoreDeps {
  /** Import `pyodide.js` from `indexUrl` and return a bare runtime (no wheels yet). */
  importPyodide: (indexUrl: string) => Promise<PyodideLike>;
  /** Send a response back to the main thread. */
  post: (msg: PyodideWorkerResponse) => void;
}

/**
 * Build the message handler. One runtime per worker; the client terminates
 * and respawns the worker instead of reloading in place.
 */
export function createPyodideWorkerCore(
  deps: PyodideWorkerCoreDeps,
): (req: PyodideWorkerRequest) => Promise<void> {
  let runtime: PyodideLike | null = null;
  let acceptsInputs = false;
  let booting: Promise<void> | null = null;

  async function boot(req: PyodideLoadRequest): Promise<void> {
    const py = await deps.importPyodide(req.indexUrl);
    await installPynescriptRuntime(py, req.origin);
    acceptsInputs = pyodideRuntimeAcceptsInputs(py);
    runtime = py;
  }

  async function runScript(req: PyodideRunRequest): Promise<string> {
    const py = runtime;
    if (!py) throw new Error('Pyodide runtime is not loaded in the worker');
    // Same policy as the in-thread path: numpy is optional for compile/auto.
    if (req.mode === 'compile' || req.mode === 'auto') {
      try {
        await py.loadPackage('numpy');
      } catch {
        /* interpret fallback handles missing numpy */
      }
    }
    // Defence in depth: the client only forwards inputs when the load reply
    // said the runtime accepts them, but never pass an unknown kwarg to Python.
    const inputs = acceptsInputs ? req.inputs : undefined;
    return callPyodideRunScript(py, req.script, req.bars, req.mode, req.libraries, inputs);
  }

  return async function handle(req: PyodideWorkerRequest): Promise<void> {
    const id = typeof req?.id === 'number' ? req.id : -1;
    try {
      if (req.type === 'load') {
        if (!runtime) {
          // A second load while booting shares the same boot (client never sends
          // one, but a duplicate must not start a second wasm heap).
          booting ??= boot(req).finally(() => {
            booting = null;
          });
          await booting;
        }
        deps.post({ id, type: 'loaded', acceptsInputs });
        return;
      }
      if (req.type === 'run') {
        const resultJson = await runScript(req);
        deps.post({ id, type: 'result', resultJson });
        return;
      }
      throw new Error(`Unknown Pyodide worker request type: ${String((req as { type?: unknown }).type)}`);
    } catch (err: unknown) {
      deps.post({ id, type: 'error', message: formatPyodideBridgeError(err) });
    }
  };
}
