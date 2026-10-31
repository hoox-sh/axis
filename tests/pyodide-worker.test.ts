/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pyodide Web Worker path: message protocol (ids, routing, errors), cancel
 * (terminate + Aborted + lazy respawn), queueing, crash recovery, load-failure
 * cooldown, the in-thread fallback, and the worker-side request handler.
 *
 * Uses an injected fake transport (`setPyodideWorkerFactory`) so no real
 * Worker or Pyodide is started. One test wires the real worker core to the
 * client through a structured-clone pipe to prove payloads are clone-safe.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { pyodideEngine, _resetPyodideEngineState } from '../src/engines/catalog';
import {
  setPyodideWorkerFactory,
  pyodideWorkerAvailable,
  loadPyodideWorker,
  runPyodideWorker,
  terminatePyodideWorker,
  PyodideAbortedError,
  type PyodideWorkerTransport,
} from '../src/workers/pyodide-client';
import { createPyodideWorkerCore } from '../src/workers/pyodide-worker-core';
import { formatPyodideBridgeError, type PyodideLike } from '../src/workers/pyodide-runtime';
import type {
  PyodideRunRequest,
  PyodideWorkerRequest,
  PyodideWorkerResponse,
} from '../src/workers/pyodide-protocol';

const G = globalThis as unknown as Record<string, unknown>;
const originalFetch = globalThis.fetch;
const originalWorker = G.Worker;

type Responder = (req: PyodideWorkerRequest) => PyodideWorkerResponse | null;

/** Fake worker: replies asynchronously (like postMessage) unless the responder returns null. */
class FakeWorker implements PyodideWorkerTransport {
  posted: PyodideWorkerRequest[] = [];
  terminated = false;
  onmessage: ((ev: MessageEvent<PyodideWorkerResponse>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  onmessageerror: ((ev: MessageEvent) => void) | null = null;

  constructor(private readonly respond: Responder) {}

  postMessage(req: PyodideWorkerRequest): void {
    this.posted.push(req);
    const reply = this.respond(req);
    if (reply) queueMicrotask(() => this.emit(reply));
  }

  /** Deliver a message to the client as if the worker had posted it. */
  emit(msg: PyodideWorkerResponse): void {
    this.onmessage?.({ data: msg } as MessageEvent<PyodideWorkerResponse>);
  }

  terminate(): void {
    this.terminated = true;
  }

  runs(): PyodideRunRequest[] {
    return this.posted.filter((r): r is PyodideRunRequest => r.type === 'run');
  }
}

let responder: Responder = defaultResponder();
let created: FakeWorker[] = [];

function defaultResponder(
  resultObj: Record<string, unknown> = { status: 'success', plots: [], series: {}, events: [], drawings: [] },
): Responder {
  return (req) => {
    if (req.type === 'load') return { id: req.id, type: 'loaded', acceptsInputs: true };
    if (req.type === 'run') return { id: req.id, type: 'result', resultJson: JSON.stringify(resultObj) };
    return null;
  };
}

/** Responder that answers the load but leaves every run hanging (a long Pine run). */
const hangRuns: Responder = (req) => {
  if (req.type === 'load') return { id: req.id, type: 'loaded', acceptsInputs: true };
  return null;
};

function installFakeWorkers(): void {
  created = [];
  setPyodideWorkerFactory(() => {
    const w = new FakeWorker((req) => responder(req));
    created.push(w);
    return w;
  });
}

function worker(i = 0): FakeWorker {
  const w = created[i];
  if (!w) throw new Error(`no fake worker #${i} (have ${created.length})`);
  return w;
}

function firstRun(w: FakeWorker): PyodideRunRequest {
  const r = w.runs()[0];
  if (!r) throw new Error('no run posted yet');
  return r;
}

const BARS = [{ time: 1_700_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }];

function runOpts(extra: Record<string, unknown> = {}, signal?: AbortSignal) {
  return {
    script: 'indicator("t")',
    bars: BARS,
    config: { mode: 'interpret' },
    ...extra,
    ...(signal ? { signal } : {}),
  } as never;
}

async function waitFor(pred: () => boolean, ms = 1000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 2));
  }
}

function stubRuntimeFetch(): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('.whl')) {
      return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]), {
        headers: { 'content-type': 'application/zip' },
      });
    }
    if (url.endsWith('pynescript_runtime.py')) {
      return new Response('def run_script(*a): return "{}"\n', {
        headers: { 'content-type': 'text/x-python' },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
}

function fakePyodide(opts: { acceptsInputs: boolean; runResult?: string; runError?: Error }) {
  const calls: string[] = [];
  const installs: string[] = [];
  const globals = new Map<string, unknown>();
  return {
    calls,
    installs,
    globals: {
      set: (k: string, v: unknown) => void globals.set(k, v),
      delete: (k: string) => void globals.delete(k),
    },
    loadPackage: async (name: string) => {
      calls.push(`loadPackage:${name}`);
    },
    pyimport: () => ({
      install: async (url: string) => {
        installs.push(url);
      },
    }),
    runPythonAsync: async () => {
      calls.push('runPythonAsync');
    },
    runPython: (code: string) => {
      if (code.includes('signature')) return opts.acceptsInputs;
      calls.push(`run:${code}`);
      if (opts.runError) throw opts.runError;
      return opts.runResult ?? '{"status":"success"}';
    },
  };
}

beforeEach(() => {
  responder = defaultResponder();
  _resetPyodideEngineState();
  installFakeWorkers();
});

afterEach(() => {
  _resetPyodideEngineState();
  setPyodideWorkerFactory(null);
  globalThis.fetch = originalFetch;
  G.Worker = originalWorker;
});

describe('pyodide worker — message protocol (fake transport)', () => {
  it('loads once, then routes the run reply back by id', async () => {
    const res = await pyodideEngine.run(runOpts());
    expect(res.status).toBe('success');
    expect(res.meta?.transport).toBe('local');
    expect(typeof res.meta?.ms).toBe('number');
    expect(created).toHaveLength(1);
    const [load, run] = worker().posted;
    expect(worker().posted.map((r) => r.type)).toEqual(['load', 'run']);
    expect(load?.id).not.toBe(run?.id);
    expect((load as { indexUrl: string }).indexUrl).toContain('/pyodide/v');
  });

  it('sends script, mode, and bars in the run request; no second load', async () => {
    await pyodideEngine.run(runOpts());
    await pyodideEngine.run(runOpts());
    expect(created).toHaveLength(1);
    const runs = worker().runs();
    expect(runs).toHaveLength(2);
    expect(runs[0]?.script).toBe('indicator("t")');
    expect(runs[0]?.mode).toBe('interpret');
    expect(runs[0]?.bars).toHaveLength(1);
    expect(runs[0] && 'inputs' in runs[0]).toBe(false);
  });

  it('surfaces a worker error as an error result with the formatted message', async () => {
    const message = "Traceback (most recent call last):\nNameError: name 'null' is not defined";
    responder = (req) => {
      if (req.type === 'load') return { id: req.id, type: 'loaded', acceptsInputs: true };
      return { id: req.id, type: 'error', message };
    };
    const res = await pyodideEngine.run(runOpts());
    expect(res.status).toBe('error');
    expect(res.error).toBe(message);
    expect(res.drawings).toEqual([]);
  });

  it('ignores replies whose id matches no pending request', async () => {
    responder = (req) => {
      if (req.type === 'load') return { id: req.id, type: 'loaded', acceptsInputs: true };
      // A stray reply with an unknown id is delivered first; it must be dropped.
      return null;
    };
    const pending = pyodideEngine.run(runOpts());
    await waitFor(() => created.length === 1 && worker().runs().length === 1);
    worker().emit({ id: 999, type: 'result', resultJson: '{"status":"success","plots":[7]}' });
    worker().emit({ id: firstRun(worker()).id, type: 'result', resultJson: '{"status":"success","plots":[1]}' });
    const out = await pending;
    expect(out.status).toBe('success');
    expect(out.plots).toEqual([1]);
  });

  it('parses the result JSON on the main thread (malformed JSON -> error)', async () => {
    responder = (req) => {
      if (req.type === 'load') return { id: req.id, type: 'loaded', acceptsInputs: true };
      return { id: req.id, type: 'result', resultJson: 'not json' };
    };
    const res = await pyodideEngine.run(runOpts());
    expect(res.status).toBe('error');
    expect(String(res.error)).toMatch(/JSON|Unexpected|SyntaxError/);
  });
});

describe('pyodide worker — cancel, queueing, crash', () => {
  it('cancel terminates the worker, reports Aborted, and the next run respawns', async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((r) => {
      markStarted = r;
    });
    responder = (req) => {
      if (req.type === 'load') return { id: req.id, type: 'loaded', acceptsInputs: true };
      markStarted();
      return null; // hang: a long Pine run
    };
    const ctrl = new AbortController();
    const pending = pyodideEngine.run(runOpts({}, ctrl.signal));
    await started;
    ctrl.abort();
    const res = await pending;
    expect(res.status).toBe('error');
    expect(res.error).toBe('Aborted');
    expect(res.meta?.transport).toBe('local');
    expect(worker(0).terminated).toBe(true);

    // Lazy respawn on the next run; the reload is part of the cost.
    responder = defaultResponder();
    const again = await pyodideEngine.run(runOpts());
    expect(again.status).toBe('success');
    expect(created).toHaveLength(2);
    expect(worker(1).posted.map((r) => r.type)).toEqual(['load', 'run']);
  });

  it('aborting a queued run rejects only that run; the in-flight run and worker are untouched', async () => {
    responder = hangRuns;
    await loadPyodideWorker({ indexUrl: '/pyodide/v0.29.5/', origin: 'https://app.test' });
    const body = { script: 's', bars: [], mode: 'interpret', libraries: [] };
    const first = runPyodideWorker(body);
    await waitFor(() => worker().runs().length === 1);

    const ctrl = new AbortController();
    const queued = runPyodideWorker(body, ctrl.signal);
    ctrl.abort();
    await expect(queued).rejects.toBeInstanceOf(PyodideAbortedError);

    // Finish the first run by hand; the queued one must never have been posted.
    worker().emit({ id: firstRun(worker()).id, type: 'result', resultJson: '{"status":"success"}' });
    expect(await first).toBe('{"status":"success"}');
    expect(worker().terminated).toBe(false);
    expect(worker().runs()).toHaveLength(1);
  });

  it('queues concurrent runs: one in flight at a time, results in order', async () => {
    responder = hangRuns;
    const a = pyodideEngine.run(runOpts({ script: 'a' }));
    const b = pyodideEngine.run(runOpts({ script: 'b' }));
    await waitFor(() => created.length === 1 && worker().runs().length === 1);
    // Give the queue a chance to (wrongly) post the second run early.
    await new Promise((r) => setTimeout(r, 10));
    expect(worker().runs()).toHaveLength(1);
    expect(firstRun(worker()).script).toBe('a');

    worker().emit({ id: firstRun(worker()).id, type: 'result', resultJson: '{"status":"success","plots":[1]}' });
    await waitFor(() => worker().runs().length === 2);
    const second = worker().runs()[1];
    expect(second?.script).toBe('b');
    worker().emit({ id: second?.id ?? -1, type: 'result', resultJson: '{"status":"success","plots":[2]}' });

    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.plots).toEqual([1]);
    expect(rb.plots).toEqual([2]);
  });

  it('a worker crash rejects the run with a crash message and the next run respawns', async () => {
    responder = hangRuns;
    const pending = pyodideEngine.run(runOpts());
    await waitFor(() => created.length === 1 && worker().runs().length === 1);
    worker().onerror?.({ message: 'out of memory' } as unknown as ErrorEvent);
    const res = await pending;
    expect(res.status).toBe('error');
    expect(res.error).toContain('Pyodide worker crashed: out of memory');
    expect(worker(0).terminated).toBe(true);

    responder = defaultResponder();
    const next = await pyodideEngine.run(runOpts());
    expect(next.status).toBe('success');
    expect(created).toHaveLength(2);
  });

  it('a failed load terminates the worker, sets the cooldown, and resets cleanly', async () => {
    responder = (req) => {
      if (req.type === 'load') {
        return { id: req.id, type: 'error', message: 'pynescript wheel missing: HTTP 404' };
      }
      return null;
    };
    const first = await pyodideEngine.run(runOpts());
    expect(first.status).toBe('error');
    expect(first.error).toContain('pynescript wheel missing: HTTP 404');
    expect(worker(0).terminated).toBe(true);

    // Inside the cooldown: no new worker, message carries the retry hint.
    const second = await pyodideEngine.run(runOpts());
    expect(second.error).toContain('(retrying in');
    expect(created).toHaveLength(1);

    _resetPyodideEngineState();
    responder = defaultResponder();
    const third = await pyodideEngine.run(runOpts());
    expect(third.status).toBe('success');
    expect(created).toHaveLength(2);
  });

  it('a cancel during a cold load returns Aborted promptly without tearing the load down', async () => {
    responder = () => null; // the load never answers in this test
    const ctrl = new AbortController();
    const pending = pyodideEngine.run(runOpts({}, ctrl.signal));
    await waitFor(() => created.length === 1 && worker().posted.length === 1);
    ctrl.abort();
    const res = await pending;
    expect(res.error).toBe('Aborted');
    // The cancel only abandons the caller; the shared load is still in flight.
    expect(worker().terminated).toBe(false);
    // Clean up the hanging load so it cannot leak into later tests.
    terminatePyodideWorker(new Error('test cleanup'));
    await new Promise((r) => setTimeout(r, 5));
  });
});

describe('pyodide worker — inputs forwarding', () => {
  it('forwards Script Settings only when the runtime reported it accepts them', async () => {
    const res = await pyodideEngine.run(runOpts({ inputs: { length: 14 } }));
    expect(res.status).toBe('success');
    expect(res.meta?.unsupported).toBeUndefined();
    expect(firstRun(worker()).inputs).toEqual({ length: 14 });
  });

  it('reports inputs as unsupported and does not send them to an older runtime', async () => {
    responder = (req) => {
      if (req.type === 'load') return { id: req.id, type: 'loaded', acceptsInputs: false };
      return { id: req.id, type: 'result', resultJson: '{"status":"success"}' };
    };
    const res = await pyodideEngine.run(runOpts({ inputs: { length: 14 } }));
    expect(res.status).toBe('success');
    expect(res.meta?.unsupported).toEqual(['inputs']);
    expect('inputs' in firstRun(worker())).toBe(false);
  });
});

describe('pyodide worker — fallback and seams', () => {
  it('pyodideWorkerAvailable is false when no Worker constructor exists', () => {
    setPyodideWorkerFactory(null);
    G.Worker = undefined;
    expect(pyodideWorkerAvailable()).toBe(false);
  });

  it('an attached in-thread runtime bypasses the worker entirely', async () => {
    const calls: string[] = [];
    const mock = {
      loadPackage: async () => {},
      pyimport: () => ({ install: async () => {} }),
      runPythonAsync: async () => {},
      globals: { set: () => {}, delete: () => {} },
      runPython: (code: string) => {
        calls.push(code);
        if (code.includes('signature')) return false;
        return '{"status":"success","plots":[9],"series":{},"events":[],"drawings":[]}';
      },
    };
    const slot = pyodideEngine as unknown as { _pyodide: unknown };
    const prev = slot._pyodide;
    try {
      slot._pyodide = mock;
      const res = await pyodideEngine.run(runOpts());
      expect(res.status).toBe('success');
      expect(res.plots).toEqual([9]);
      expect(created).toHaveLength(0);
      expect(calls.some((c) => c.includes('run_script'))).toBe(true);
    } finally {
      slot._pyodide = prev ?? null;
    }
  });

  it('loadPyodideWorker and runPyodideWorker are usable directly (client API)', async () => {
    const info = await loadPyodideWorker({ indexUrl: '/pyodide/v0.29.5/', origin: 'https://x.test' });
    expect(info).toEqual({ acceptsInputs: true });
    const json = await runPyodideWorker({ script: 's', bars: [], mode: 'interpret', libraries: [] });
    expect(json).toBe('{"status":"success","plots":[],"series":{},"events":[],"drawings":[]}');
  });
});

describe('pyodide worker — worker-side handler (createPyodideWorkerCore)', () => {
  it('load installs the wheels in order and reports acceptsInputs; run returns the raw JSON', async () => {
    stubRuntimeFetch();
    const py = fakePyodide({ acceptsInputs: true, runResult: '{"status":"success"}' });
    const posted: PyodideWorkerResponse[] = [];
    const seenUrls: string[] = [];
    const handle = createPyodideWorkerCore({
      importPyodide: async (url) => {
        seenUrls.push(url);
        return py as unknown as PyodideLike;
      },
      post: (m) => void posted.push(m),
    });

    await handle({ id: 1, type: 'load', indexUrl: '/pyodide/v0.29.5/', origin: 'https://app.test' });
    expect(seenUrls).toEqual(['/pyodide/v0.29.5/']);
    expect(posted.at(-1)).toEqual({ id: 1, type: 'loaded', acceptsInputs: true });
    // antlr4 first, then pynescript — same order as the in-thread path.
    expect(py.installs).toEqual([
      'https://app.test/vendor/antlr4_python3_runtime-4.13.2-py3-none-any.whl',
      'https://app.test/vendor/pynescript-0.6.26-py3-none-any.whl',
    ]);
    expect(py.calls).toContain('runPythonAsync');

    await handle({
      id: 2,
      type: 'run',
      script: 'indicator("t")',
      bars: [],
      mode: 'auto',
      libraries: [],
      inputs: { a: 1 },
    });
    expect(py.calls).toContain('loadPackage:numpy');
    expect(py.calls.at(-1)).toContain('_axis_inputs_json');
    expect(posted.at(-1)).toEqual({ id: 2, type: 'result', resultJson: '{"status":"success"}' });
  });

  it('drops inputs when the loaded runtime does not accept them', async () => {
    stubRuntimeFetch();
    const py = fakePyodide({ acceptsInputs: false });
    const posted: PyodideWorkerResponse[] = [];
    const handle = createPyodideWorkerCore({
      importPyodide: async () => py as unknown as PyodideLike,
      post: (m) => void posted.push(m),
    });
    await handle({ id: 1, type: 'load', indexUrl: '/p/', origin: 'https://app.test' });
    await handle({
      id: 2,
      type: 'run',
      script: 's',
      bars: [],
      mode: 'interpret',
      libraries: [],
      inputs: { a: 1 },
    });
    expect(py.calls.at(-1)).not.toContain('_axis_inputs_json');
    expect(posted.at(-1)?.type).toBe('result');
  });

  it('a Python exception is posted as a bridge-formatted error with the same id', async () => {
    stubRuntimeFetch();
    const err = new Error('eval_code failed…');
    err.stack = "Error: eval_code failed…\nTraceback (most recent call last):\nNameError: name 'null' is not defined";
    const py = fakePyodide({ acceptsInputs: false, runError: err });
    const posted: PyodideWorkerResponse[] = [];
    const handle = createPyodideWorkerCore({
      importPyodide: async () => py as unknown as PyodideLike,
      post: (m) => void posted.push(m),
    });
    await handle({ id: 1, type: 'load', indexUrl: '/p/', origin: 'https://app.test' });
    await handle({ id: 5, type: 'run', script: 's', bars: [], mode: 'interpret', libraries: [] });
    const last = posted.at(-1);
    expect(last).toEqual({ id: 5, type: 'error', message: formatPyodideBridgeError(err) });
    expect(last?.type === 'error' ? last.message : '').toContain("NameError: name 'null' is not defined");
  });

  it('run before load and unknown request types answer with an error on the same id', async () => {
    const posted: PyodideWorkerResponse[] = [];
    const handle = createPyodideWorkerCore({
      importPyodide: async () => {
        throw new Error('should not import');
      },
      post: (m) => void posted.push(m),
    });
    await handle({ id: 3, type: 'run', script: 's', bars: [], mode: 'interpret', libraries: [] });
    expect(posted.at(-1)).toMatchObject({ id: 3, type: 'error' });
    const beforeLoad = posted.at(-1);
    expect(beforeLoad?.type === 'error' ? beforeLoad.message : '').toContain('not loaded');

    await handle({ id: 4, type: 'bogus' } as unknown as PyodideWorkerRequest);
    expect(posted.at(-1)).toMatchObject({ id: 4, type: 'error' });
  });
});

describe('pyodide worker — end-to-end over a structured-clone pipe', () => {
  it('client and real worker core exchange clone-safe payloads and produce a success result', async () => {
    stubRuntimeFetch();
    const py = fakePyodide({
      acceptsInputs: true,
      runResult: '{"status":"success","plots":[3],"series":{},"events":[],"drawings":[]}',
    });

    class PipeWorker implements PyodideWorkerTransport {
      onmessage: ((ev: MessageEvent<PyodideWorkerResponse>) => void) | null = null;
      onerror: ((ev: ErrorEvent) => void) | null = null;
      onmessageerror: ((ev: MessageEvent) => void) | null = null;
      private readonly core = createPyodideWorkerCore({
        importPyodide: async () => py as unknown as PyodideLike,
        post: (msg) => {
          queueMicrotask(() => {
            // Responses are cloned too — mirrors postMessage semantics.
            this.onmessage?.({ data: structuredClone(msg) } as MessageEvent<PyodideWorkerResponse>);
          });
        },
      });
      postMessage(req: PyodideWorkerRequest): void {
        const cloned = structuredClone(req);
        queueMicrotask(() => void this.core(cloned));
      }
      terminate(): void {}
    }

    setPyodideWorkerFactory(() => new PipeWorker());
    const res = await pyodideEngine.run(runOpts({ inputs: { length: 3 } }));
    expect(res.status).toBe('success');
    expect(res.plots).toEqual([3]);
    expect(res.meta?.transport).toBe('local');
    expect(py.calls.some((c) => c.includes('_axis_inputs_json'))).toBe(true);
  });
});
