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
 * Message protocol between the main thread (`pyodide-client.ts`) and the
 * Pyodide Web Worker (`pyodide.worker.ts`).
 *
 * Every request carries a numeric `id`; the worker answers with the same `id`,
 * so responses route to the right promise even if a stale one arrives after a
 * respawn. Payloads are structured-clone safe: plain JSON-compatible data only
 * (no functions, PyProxy handles or class instances).
 *
 * There is intentionally **no `cancel` request**. A synchronous `run_script`
 * blocks the worker's event loop, so the worker cannot read a message while a
 * run is in flight. Cancel is `worker.terminate()` on the client side.
 *
 * @module workers/pyodide-protocol
 */

/** Fetch `pyodide.js`, install micropip wheels + the runtime, report readiness. */
export interface PyodideLoadRequest {
  id: number;
  type: 'load';
  /** Absolute, same-origin index URL with a trailing slash (`/pyodide/v0.29.5/`). */
  indexUrl: string;
  /** Page origin — used to build the `/vendor/*.whl` and runtime URLs. */
  origin: string;
}

/** Evaluate one script. Bars are sent as the array; the worker serialises them. */
export interface PyodideRunRequest {
  id: number;
  type: 'run';
  script: string;
  bars: unknown[];
  mode: string;
  libraries: unknown[];
  /**
   * Present only when the client decided to forward Script Settings, i.e. the
   * loaded runtime accepts an `inputs` parameter (reported by the load reply).
   */
  inputs?: Record<string, unknown>;
}

export type PyodideWorkerRequest = PyodideLoadRequest | PyodideRunRequest;

/** Request body without the routing `id` (the client assigns ids). */
export type PyodideLoadBody = Omit<PyodideLoadRequest, 'id'>;
export type PyodideRunBody = Omit<PyodideRunRequest, 'id' | 'type'>;

export type PyodideWorkerResponse =
  | { id: number; type: 'loaded'; acceptsInputs: boolean }
  /**
   * `resultJson` is the raw string returned by `run_script`. It is parsed on
   * the main thread (see the choice note in `pyodide-client.ts`).
   */
  | { id: number; type: 'result'; resultJson: string }
  /** `message` is already formatted with `formatPyodideBridgeError` in the worker. */
  | { id: number; type: 'error'; message: string };
