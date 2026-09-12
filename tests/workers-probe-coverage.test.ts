/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Extended coverage for `src/workers/probe.ts` — pure status-mapping,
 * timeout, error, and retry/abort branches with mocked fetch/timers.
 *
 * Does not modify sources under test.
 */

import { describe, expect, it, afterEach } from 'bun:test';
import {
  probeWorker,
  probeAllWorkers,
  probeAbortSignal,
  workerHealthLabel,
} from '../src/workers/probe';
import { DEFAULT_AXIS_WORKER_BASE } from '../src/workers/catalog';
import { getEngine } from '../src/engines/catalog';
import { store, setStore } from '../src/store';

const originalFetch = globalThis.fetch;
const originalNavigator = globalThis.navigator;
const G = globalThis as unknown as Record<string, unknown>;
const originalWindow = G.window;

function healthyFetch(service: string) {
  return (async () =>
    new Response(JSON.stringify({ status: 'healthy', service, features: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
}

function jsonFetch(body: unknown, status = 200) {
  return (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.navigator = originalNavigator;
  if (originalWindow === undefined) {
    if ('window' in G) delete G.window;
  } else {
    G.window = originalWindow;
  }
  // Restore engine singleton stubs (pyodide tests below mutate in place)
  try {
    const eng = getEngine('pyodide') as unknown as Record<string, unknown>;
    if (eng && '_testOrig' in G) {
      const orig = G._testOrig as { isReady: unknown; py: unknown };
      eng.isReady = orig.isReady as never;
      eng._pyodide = orig.py;
      delete G._testOrig;
    }
  } catch {
    /* ignore */
  }
});

function stubPyodideEngine(stub: {
  isReady?: () => Promise<boolean>;
  py?: unknown;
  clearPy?: boolean;
}) {
  const eng = getEngine('pyodide') as unknown as {
    isReady: () => Promise<boolean>;
    _pyodide?: unknown;
  };
  if (!('_testOrig' in G)) {
    G._testOrig = { isReady: eng.isReady, py: eng._pyodide };
  }
  if (stub.isReady) eng.isReady = stub.isReady;
  if (stub.clearPy) eng._pyodide = null;
  if ('py' in stub) eng._pyodide = stub.py;
}

function pyodideJsFetch(
  handler: (method: string, url: string) => Response | Promise<Response>,
) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('pyodide.js')) return handler(init?.method || 'GET', url);
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
}

const okJsHeaders = { 'Content-Type': 'application/javascript' };

describe('probeAbortSignal parent branches', () => {
  it('propagates a live parent abort to the child', async () => {
    const parent = new AbortController();
    const child = probeAbortSignal(5000, parent.signal);
    expect(child.aborted).toBe(false);
    parent.abort();
    expect(child.aborted).toBe(true);
  });

  it('aborts immediately when the parent is already aborted', () => {
    const parent = new AbortController();
    parent.abort();
    const child = probeAbortSignal(5000, parent.signal);
    expect(child.aborted).toBe(true);
  });

  it('treats NaN timeout as the default budget', async () => {
    globalThis.fetch = healthyFetch('pynescript-axis-worker');
    const r = await probeWorker('axis-worker', {
      endpoint: DEFAULT_AXIS_WORKER_BASE,
      timeoutMs: NaN,
    });
    expect(r.status).toBe('healthy');
  });
});

describe('probeWorker wall-clock timeout / abort race', () => {
  it('resolves down/Timeout when fetch hangs (known entry)', async () => {
    globalThis.fetch = (() =>
      new Promise<Response>(() => {
        /* never resolves */
      })) as unknown as typeof fetch;
    const r = await probeWorker('pyne-pro', {
      endpoint: 'http://127.0.0.1:5002',
      timeoutMs: 100,
    });
    expect(r.status).toBe('down');
    expect(r.detail).toBe('Timeout');
    expect(r.error).toBe('Timeout');
  });

  it('resolves down/Aborted when the caller signal fires mid-flight', async () => {
    globalThis.fetch = (() =>
      new Promise<Response>(() => {
        /* never resolves */
      })) as unknown as typeof fetch;
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 30);
    const r = await probeWorker('pyne-pro', {
      endpoint: 'http://127.0.0.1:5002',
      timeoutMs: 5000,
      signal: ctrl.signal,
    });
    expect(r.status).toBe('down');
    expect(r.detail).toBe('Aborted');
    expect(r.error).toBe('Aborted');
  });

  it('covers the abort listener for an unknown id', async () => {
    const ctrl = new AbortController();
    const p = probeWorker('nope' as never, {
      timeoutMs: 5000,
      signal: ctrl.signal,
    });
    ctrl.abort();
    const r = await p;
    // run() wins the race; the abort resolution still executes
    expect(r.status).toBe('unknown');
  });

  it('covers the stray wall-clock timer for an unknown id', async () => {
    const r = await probeWorker('nope' as never, { timeoutMs: 50 });
    expect(r.status).toBe('unknown');
    // run() wins immediately; the losing timeout still fires and resolves
    await new Promise((res) => setTimeout(res, 450));
  });
});

describe('probeWorker http-health mapping branches', () => {
  it('breaks immediately when the probe signal is already aborted', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await probeWorker('pyne-pro', {
      endpoint: 'http://127.0.0.1:5002',
      timeoutMs: 500,
      signal: ctrl.signal,
    });
    expect(r.status).toBe('down');
    expect(r.detail).toBe('Timeout');
    expect(calls).toBe(0);
  });

  it('reports HTTP status when every path is an error', async () => {
    globalThis.fetch = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const r = await probeWorker('axis-worker', {
      endpoint: DEFAULT_AXIS_WORKER_BASE,
      timeoutMs: 1000,
    });
    expect(r.status).toBe('down');
    expect(r.error).toBe('HTTP 500');
  });

  it('reports non-JSON bodies (SPA shell)', async () => {
    globalThis.fetch = (async () =>
      new Response('<html><body>app</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })) as unknown as typeof fetch;
    const r = await probeWorker('axis-worker', {
      endpoint: DEFAULT_AXIS_WORKER_BASE,
      timeoutMs: 1000,
    });
    expect(r.status).toBe('down');
    expect(r.detail).toContain('Non-JSON');
  });

  it('reports JSON without health markers', async () => {
    globalThis.fetch = jsonFetch({ hello: 'world' });
    const r = await probeWorker('axis-worker', {
      endpoint: DEFAULT_AXIS_WORKER_BASE,
      timeoutMs: 1000,
    });
    expect(r.status).toBe('down');
    expect(r.detail).toContain('without health markers');
  });

  it('coerces mixed feature value types (bool/string/number/null/object)', async () => {
    globalThis.fetch = jsonFetch({
      status: 'ok',
      service: 'svc',
      features: { a: true, b: 'x', c: 42, d: null, e: { nested: 1 }, f: [1, 2] },
      websocket: true,
      version: '1.2.3',
    });
    const r = await probeWorker('axis-worker', {
      endpoint: DEFAULT_AXIS_WORKER_BASE,
      timeoutMs: 1000,
    });
    expect(r.status).toBe('healthy');
    expect(r.features.a).toBe(true);
    expect(r.features.d).toBeNull();
    expect(typeof r.features.e).toBe('string');
    expect(r.features.websocket).toBe(true);
    expect(r.features.version).toBe('1.2.3');
  });

  it('maps degraded and foreign status strings to degraded', async () => {
    globalThis.fetch = jsonFetch({ status: 'degraded', service: 'svc' });
    const d = await probeWorker('axis-worker', {
      endpoint: DEFAULT_AXIS_WORKER_BASE,
      timeoutMs: 1000,
    });
    expect(d.status).toBe('degraded');

    globalThis.fetch = jsonFetch({ status: 'maintenance', service: 'svc' });
    const m = await probeWorker('axis-worker', {
      endpoint: DEFAULT_AXIS_WORKER_BASE,
      timeoutMs: 1000,
    });
    expect(m.status).toBe('degraded');
  });
});

describe('probeWorker active-engine mapping', () => {
  it('marks the backend worker as active engine when endpoints match', async () => {
    const prevEndpoint = store.endpoint;
    const prevEngine = store.engine;
    try {
      setStore('endpoint', DEFAULT_AXIS_WORKER_BASE);
      setStore('engine', 'server');
      globalThis.fetch = healthyFetch('pynescript-axis-worker');
      const r = await probeWorker('axis-worker', {
        endpoint: DEFAULT_AXIS_WORKER_BASE,
        timeoutMs: 1000,
      });
      expect(r.isActiveEngine).toBe(true);
      expect(r.isActiveBackend).toBe(true);
    } finally {
      setStore('endpoint', prevEndpoint);
      setStore('engine', prevEngine);
    }
  });

  it('marks pyodide as active engine when selected', async () => {
    const prevEngine = store.engine;
    try {
      setStore('engine', 'pyodide');
      stubPyodideEngine({ clearPy: true, isReady: async () => false });
      pyodideJsFetch(() => new Response('// pyodide', { status: 200, headers: okJsHeaders }));
      const r = await probeWorker('pyodide', { timeoutMs: 1000 });
      expect(r.isActiveEngine).toBe(true);
    } finally {
      setStore('engine', prevEngine);
    }
  });

  it('uses the page origin for probing when window is present', async () => {
    const prevEndpoint = store.endpoint;
    try {
      // Must not map to pyne-pro or the active-backend shortcut wins first
      setStore('endpoint', 'http://127.0.0.1:8787');
      G.window = { location: { origin: 'https://pynescript.online' } };
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        expect(url.startsWith('https://pynescript.online')).toBe(true);
        return new Response(JSON.stringify({ status: 'healthy', service: 'pyne' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as unknown as typeof fetch;
      const r = await probeWorker('pyne-pro', { timeoutMs: 1000 });
      expect(r.status).toBe('healthy');
      expect(r.endpoint).toBe('https://pynescript.online');
    } finally {
      setStore('endpoint', prevEndpoint);
      delete G.window;
    }
  });
});

describe('probeWorker pyodide asset branches', () => {
  it('falls back to GET when HEAD is rejected (405)', async () => {
    stubPyodideEngine({ clearPy: true, isReady: async () => false });
    pyodideJsFetch((method) => {
      if (method === 'HEAD') return new Response('nope', { status: 405 });
      return new Response('// pyodide', { status: 200, headers: okJsHeaders });
    });
    const r = await probeWorker('pyodide', { timeoutMs: 1500 });
    expect(r.features.assetOk).toBe(true);
    expect(r.status).toBe('idle');
  });

  it('ignores a throwing body.cancel() on the GET fallback', async () => {
    stubPyodideEngine({ clearPy: true, isReady: async () => false });
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method || 'GET') === 'HEAD') return new Response('nope', { status: 405 });
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/javascript' },
        body: {
          cancel: () => {
            throw new Error('already closed');
          },
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const r = await probeWorker('pyodide', { timeoutMs: 1500 });
    expect(r.features.assetOk).toBe(true);
    expect(r.status).toBe('idle');
  });

  it('reports down when pyodide.js returns HTML (SPA fallback)', async () => {
    pyodideJsFetch(
      () => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
    const r = await probeWorker('pyodide', { timeoutMs: 1500 });
    expect(r.status).toBe('down');
    expect(r.error).toBe('SPA fallback');
  });

  it('reports down on asset HTTP errors', async () => {
    pyodideJsFetch(() => new Response('missing', { status: 500 }));
    const r = await probeWorker('pyodide', { timeoutMs: 1500 });
    expect(r.status).toBe('down');
    expect(r.error).toBe('HTTP 500');
  });

  it('reports down when assets are unreachable', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('dns fail');
    }) as unknown as typeof fetch;
    const r = await probeWorker('pyodide', { timeoutMs: 500 });
    expect(r.status).toBe('down');
    expect(r.detail).toContain('Assets unreachable');
  });

  it('maps abort-flavoured asset errors to Timeout', async () => {
    globalThis.fetch = (async () => {
      throw new Error('Aborted by harness');
    }) as unknown as typeof fetch;
    const r = await probeWorker('pyodide', { timeoutMs: 500 });
    expect(r.status).toBe('down');
    expect(r.error).toBe('Timeout');
  });

  it('treats a throwing isReady() as not ready (idle)', async () => {
    stubPyodideEngine({
      clearPy: true,
      isReady: async () => {
        throw new Error('boom');
      },
    });
    pyodideJsFetch(() => new Response('// pyodide', { status: 200, headers: okJsHeaders }));
    const r = await probeWorker('pyodide', { timeoutMs: 1500 });
    expect(r.status).toBe('idle');
  });

  it('aborts the isReady race when the caller aborts (outer result is Aborted)', async () => {
    stubPyodideEngine({ clearPy: true, isReady: () => new Promise<boolean>(() => {}) });
    pyodideJsFetch(() => new Response('// pyodide', { status: 200, headers: okJsHeaders }));
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 60);
    const r = await probeWorker('pyodide', { timeoutMs: 2000, signal: ctrl.signal });
    // Outer race reports Aborted; the inner isReady abort listener still runs
    // (clears its cap timer and resolves the race to false).
    expect(r.status).toBe('down');
    expect(r.error).toBe('Aborted');
  });

  it('reports healthy when the runtime is ready', async () => {
    stubPyodideEngine({ isReady: async () => true });
    pyodideJsFetch(() => new Response('// pyodide', { status: 200, headers: okJsHeaders }));
    const r = await probeWorker('pyodide', { timeoutMs: 1500 });
    expect(r.status).toBe('healthy');
    expect(r.detail).toBe('Pyodide runtime ready');
  });
});

describe('probeWorker service-worker branches', () => {
  it('healthy via active registration without a controller (waiting for control)', async () => {
    globalThis.navigator = {
      serviceWorker: {
        controller: null,
        getRegistration: async () => ({
          active: {},
          waiting: null,
          installing: null,
          scope: 'https://example.com/',
        }),
      },
    } as unknown as Navigator;
    const r = await probeWorker('service-worker');
    expect(r.status).toBe('healthy');
    expect(r.detail).toContain('waiting for control');
  });

  it('degraded when a registration exists but nothing is active', async () => {
    globalThis.navigator = {
      serviceWorker: {
        controller: null,
        getRegistration: async () => ({
          active: null,
          waiting: null,
          installing: null,
          scope: 'https://example.com/',
        }),
      },
    } as unknown as Navigator;
    const r = await probeWorker('service-worker');
    expect(r.status).toBe('degraded');
    expect(r.detail).toContain('no active worker');
  });

  it('down when getRegistration throws', async () => {
    globalThis.navigator = {
      serviceWorker: {
        controller: null,
        getRegistration: async () => {
          throw new Error('sw exploded');
        },
      },
    } as unknown as Navigator;
    const r = await probeWorker('service-worker');
    expect(r.status).toBe('down');
    expect(r.error).toBe('sw exploded');
  });
});

describe('probeAllWorkers rejection mapping + labels', () => {
  it('maps rejected probes to down results', async () => {
    globalThis.fetch = healthyFetch('x');
    const badSignal = {
      addEventListener() {
        throw new Error('boom');
      },
    } as unknown as AbortSignal;
    const snap = await probeAllWorkers({ timeoutMs: 300, signal: badSignal });
    expect(snap.results.length).toBeGreaterThan(0);
    expect(snap.results.every((r) => r.status === 'down')).toBe(true);
    expect(snap.down).toBe(snap.results.length);
    expect(snap.results[0]!.error).toBe('boom');
  });

  it('labels every health status', () => {
    expect(workerHealthLabel('healthy')).toBe('Healthy');
    expect(workerHealthLabel('degraded')).toBe('Degraded');
    expect(workerHealthLabel('down')).toBe('Down');
    expect(workerHealthLabel('idle')).toBe('Idle');
    expect(workerHealthLabel('skipped')).toBe('Skipped');
    expect(workerHealthLabel('unknown')).toBe('Unknown');
  });
});
