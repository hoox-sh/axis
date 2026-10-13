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
 * Dedicated Web Worker that hosts the in-browser Pyodide runtime, so a
 * multi-second Pine evaluation never blocks the main thread (chart, panels,
 * input). Spawned by `pyodide-client.ts` as
 * `new Worker(new URL('./pyodide.worker.ts', import.meta.url), { type: 'module' })`.
 *
 * Module workers cannot use `importScripts` (it throws there), so `pyodide.js`
 * is loaded with a dynamic `import()` — the same mechanism the main-thread
 * engine uses. The self-hosted UMD file assigns `globalThis.loadPyodide`,
 * which is visible inside the worker global scope.
 *
 * @module workers/pyodide.worker
 */

import { createPyodideWorkerCore } from './pyodide-worker-core';
import type { PyodideWorkerRequest, PyodideWorkerResponse } from './pyodide-protocol';
import type { PyodideLike } from './pyodide-runtime';

/** Minimal worker-global surface (lib.dom types `self` as `Window`). */
interface PyodideWorkerScope {
  postMessage: (msg: PyodideWorkerResponse) => void;
  onmessage: ((ev: MessageEvent<PyodideWorkerRequest>) => void) | null;
}

const scope = self as unknown as PyodideWorkerScope;

async function importPyodide(indexUrl: string): Promise<PyodideLike> {
  await import(/* @vite-ignore */ `${indexUrl}pyodide.js`);
  // pyodide.js assigns `globalThis.loadPyodide`; read it through a narrow type
  // rather than relying on the Window augmentation declared in engines/catalog.
  const loader = (
    globalThis as unknown as {
      loadPyodide?: (opts: { indexURL: string }) => Promise<PyodideLike>;
    }
  ).loadPyodide;
  if (typeof loader !== 'function') {
    throw new Error('loadPyodide not available');
  }
  return loader({ indexURL: indexUrl });
}

const handle = createPyodideWorkerCore({
  importPyodide,
  post: (msg) => scope.postMessage(msg),
});

scope.onmessage = (ev: MessageEvent<PyodideWorkerRequest>) => {
  void handle(ev.data);
};
