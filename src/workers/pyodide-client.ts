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
 * Main-thread side of the Pyodide worker: owns the single worker, routes
 * request/response ids, and implements cancel and concurrency.
 *
 * ## Cancel
 * A synchronous `run_script` cannot be interrupted from inside (no message is
 * read while it runs), so an abort **terminates the worker**. The in-flight run
 * rejects with {@link PyodideAbortedError}; the next run respawns the worker and
 * reloads the runtime (cold-load cost, accepted). A run that is only queued, or
 * a load that is still in progress, is abandoned without touching the worker —
 * a shared load keeps running for the next caller.
 *
 * ## Concurrency
 * One worker, one run at a time. A run that arrives while another is in flight
 * **waits in a FIFO queue** (it is never dispatched concurrently and results
 * cannot cross). A queued run honours its own abort immediately. There is no
 * timeout on a run: a script that never returns holds the queue until the
 * caller aborts — the same budget the caller already passes via its signal.
 *
 * ## JSON parsing (where it happens, and why)
 * `run_script` returns a JSON **string**; the worker posts that string back and
 * the main thread parses it with `JSON.parse`, exactly as the in-thread path did.
 * Parsing in the worker and posting the object would instead pay a structured-
 * clone deserialisation on the main thread for the same object graph, with no
 * saving on the main side. The expensive part — evaluating the script and
 * building the JSON — is what moved off the main thread. The inbound direction
 * is the reverse: the bars array is structured-cloned to the worker, which
 * JSON-serialises it once for Python.
 *
 * ## Fallback
 * {@link pyodideWorkerAvailable} is false when no Worker can be created (e.g.
 * bun unit tests, which ship a global `Worker` but no `document`); the engine
 * then runs the original in-thread path.
 *
 * @module workers/pyodide-client
 */

import type {
  PyodideLoadBody,
  PyodideRunBody,
  PyodideWorkerRequest,
  PyodideWorkerResponse,
} from './pyodide-protocol';

/** Structural subset of `Worker` the client uses — lets tests inject a fake. */
export interface PyodideWorkerTransport {
  postMessage(message: PyodideWorkerRequest): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent<PyodideWorkerResponse>) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
  onmessageerror: ((ev: MessageEvent) => void) | null;
}

export type PyodideWorkerFactory = () => PyodideWorkerTransport;

/** Thrown (and reported as `Aborted`) when a run is cancelled. */
export class PyodideAbortedError extends Error {
  constructor() {
    super('Aborted');
    this.name = 'PyodideAbortedError';
  }
}

/** A failure reported by the worker. `message` is already a bridge-formatted string. */
export class PyodideWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PyodideWorkerError';
  }
}

export interface PyodideWorkerLoadInfo {
  /** Whether the loaded `run_script` accepts Script Settings (`inputs`). */
  acceptsInputs: boolean;
}

/** What `_ensure()` resolves to on the worker path (no main-thread runtime). */
export interface PyodideWorkerRuntime extends PyodideWorkerLoadInfo {
  readonly kind: 'worker';
}

interface PendingRequest {
  resolve: (msg: PyodideWorkerResponse) => void;
  reject: (err: Error) => void;
}

interface LoadArgs {
  indexUrl: string;
  origin: string;
}

let workerFactory: PyodideWorkerFactory | null = null;

/** Test seam: inject a fake worker. Pass `null` to restore the real `Worker`. */
export function setPyodideWorkerFactory(factory: PyodideWorkerFactory | null): void {
  workerFactory = factory;
}

const defaultWorkerFactory: PyodideWorkerFactory = () =>
  new Worker(new URL('./pyodide.worker.ts', import.meta.url), {
    type: 'module',
    name: 'axis-pyodide',
  });

/**
 * True when the worker path can be used. bun ships a global `Worker` but has no
 * `document`, so the unit-test environment keeps the in-thread path; browsers
 * always have both.
 */
export function pyodideWorkerAvailable(): boolean {
  if (workerFactory) return true;
  return typeof Worker === 'function' && typeof document !== 'undefined';
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

class PyodideWorkerClient {
  private worker: PyodideWorkerTransport | null = null;
  private loadArgs: LoadArgs | null = null;
  private loadInfo: PyodideWorkerLoadInfo | null = null;
  private loadPromise: Promise<PyodideWorkerLoadInfo> | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  /** Tail of the run queue; never rejects (every turn settles its caller). */
  private queue: Promise<void> = Promise.resolve();

  isLoaded(): boolean {
    return this.worker !== null && this.loadInfo !== null;
  }

  /**
   * Spawn (if needed) and load the runtime. Concurrent callers share one
   * promise. A failed load terminates the worker so the next attempt starts
   * from a clean heap.
   */
  load(args: LoadArgs): Promise<PyodideWorkerLoadInfo> {
    this.loadArgs = args;
    if (this.loadInfo && this.worker) return Promise.resolve(this.loadInfo);
    if (this.loadPromise) return this.loadPromise;
    const worker = this.spawn();
    const pendingLoad: Promise<PyodideWorkerLoadInfo> = this.request({ type: 'load', ...args })
      .then((msg) => {
        if (msg.type !== 'loaded') {
          throw new PyodideWorkerError('Pyodide worker sent an unexpected reply to load');
        }
        const info: PyodideWorkerLoadInfo = { acceptsInputs: msg.acceptsInputs };
        if (this.worker === worker) this.loadInfo = info;
        return info;
      })
      .catch((err: unknown) => {
        // Covers a rejected request AND a malformed reply: either way the heap
        // is unusable, so drop it instead of memoising a dead load promise.
        const error = toError(err);
        if (this.worker === worker) this.terminate(error);
        throw error;
      });
    this.loadPromise = pendingLoad;
    return pendingLoad;
  }

  /**
   * Queue one evaluation. Resolves with the raw `run_script` JSON string.
   * Rejects with {@link PyodideAbortedError} on cancel, or with
   * {@link PyodideWorkerError} / a plain Error for worker-side failures.
   */
  run(body: PyodideRunBody, signal?: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new PyodideAbortedError());
        return;
      }
      let settled = false;
      let inFlight = false;

      const finish = (settle: () => void): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        settle();
      };

      const onAbort = (): void => {
        const wasInFlight = inFlight;
        finish(() => reject(new PyodideAbortedError()));
        // Only a dispatched run owns the worker. A queued run or a load still in
        // progress is abandoned without disturbing anything else.
        if (wasInFlight) this.terminate(new PyodideAbortedError());
      };

      signal?.addEventListener('abort', onAbort, { once: true });

      this.queue = this.queue.then(async () => {
        if (settled) return;
        try {
          // A worker dropped while this run was queued (abort of the previous
          // run, crash) is respawned and reloaded here.
          await this.ensureLoaded();
        } catch (err) {
          finish(() => reject(toError(err)));
          return;
        }
        if (settled) return;
        inFlight = true;
        try {
          const msg = await this.request({ ...body, type: 'run' });
          if (msg.type !== 'result') {
            throw new PyodideWorkerError('Pyodide worker sent an unexpected reply to run');
          }
          finish(() => resolve(msg.resultJson));
        } catch (err) {
          finish(() => reject(toError(err)));
        } finally {
          inFlight = false;
        }
      });
    });
  }

  /**
   * Kill the worker and reject everything waiting on it. Also used for crash
   * and abort. The next load respawns; `loadArgs` is kept so queued runs can
   * reload on their own.
   */
  terminate(reason: Error): void {
    const worker = this.worker;
    this.worker = null;
    this.loadInfo = null;
    this.loadPromise = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      try {
        worker.terminate();
      } catch {
        /* already gone */
      }
    }
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const p of waiting) p.reject(reason);
  }

  private ensureLoaded(): Promise<PyodideWorkerLoadInfo> {
    if (this.loadInfo && this.worker) return Promise.resolve(this.loadInfo);
    if (!this.loadArgs) {
      return Promise.reject(new PyodideWorkerError('Pyodide worker has not been loaded'));
    }
    return this.load(this.loadArgs);
  }

  private spawn(): PyodideWorkerTransport {
    if (this.worker) return this.worker;
    const worker = (workerFactory ?? defaultWorkerFactory)();
    worker.onmessage = (ev) => {
      if (this.worker === worker) this.route(ev.data);
    };
    worker.onerror = (ev) => {
      if (this.worker === worker) {
        this.terminate(
          new PyodideWorkerError(`Pyodide worker crashed: ${ev?.message || 'unknown error'}`),
        );
      }
    };
    worker.onmessageerror = () => {
      if (this.worker === worker) {
        this.terminate(new PyodideWorkerError('Pyodide worker sent an unreadable message'));
      }
    };
    this.worker = worker;
    return worker;
  }

  /** Post a request and resolve with the reply that carries the same `id`. */
  private request(
    body: PyodideLoadBody | (PyodideRunBody & { type: 'run' }),
  ): Promise<PyodideWorkerResponse> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new PyodideWorkerError('Pyodide worker is not running'));
    const id = this.nextId++;
    return new Promise<PyodideWorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ ...body, id } as PyodideWorkerRequest);
      } catch (err) {
        this.pending.delete(id);
        reject(toError(err));
      }
    });
  }

  private route(msg: PyodideWorkerResponse | undefined): void {
    const entry = msg ? this.pending.get(msg.id) : undefined;
    if (!msg || !entry) return;
    this.pending.delete(msg.id);
    if (msg.type === 'error') entry.reject(new PyodideWorkerError(msg.message));
    else entry.resolve(msg);
  }
}

let sharedClient: PyodideWorkerClient | null = null;

function getSharedClient(): PyodideWorkerClient {
  sharedClient ??= new PyodideWorkerClient();
  return sharedClient;
}

/** Load the runtime in the shared worker (spawns it if needed). */
export function loadPyodideWorker(args: LoadArgs): Promise<PyodideWorkerLoadInfo> {
  return getSharedClient().load(args);
}

/** Evaluate one script in the shared worker; resolves with the raw result JSON. */
export function runPyodideWorker(body: PyodideRunBody, signal?: AbortSignal): Promise<string> {
  return getSharedClient().run(body, signal);
}

/** True when a worker exists and its runtime finished loading. */
export function isPyodideWorkerLoaded(): boolean {
  return sharedClient?.isLoaded() ?? false;
}

/** Terminate the shared worker (reset / tests). The next load respawns it. */
export function terminatePyodideWorker(reason?: Error): void {
  sharedClient?.terminate(reason ?? new PyodideWorkerError('Pyodide worker terminated'));
}

/** Sentinel returned by {@link raceAbort} when the signal wins. */
export const ABORTED: unique symbol = Symbol('aborted');

/**
 * Resolve with `p`'s value, or with {@link ABORTED} as soon as `signal` fires.
 * `p` itself is not cancelled; its later rejection is swallowed here.
 */
export function raceAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T | typeof ABORTED> {
  if (!signal) return p;
  if (signal.aborted) {
    p.catch(() => undefined);
    return Promise.resolve(ABORTED);
  }
  return new Promise<T | typeof ABORTED>((resolve, reject) => {
    const onAbort = (): void => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(toError(err));
      },
    );
  });
}
