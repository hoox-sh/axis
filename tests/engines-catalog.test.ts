/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Engine catalog: server success/error paths (mocked fetch) + isReady.
 * Guards registration, dynamic engines, and error envelopes from `/run`.
 * Failure coverage: non-JSON body, 5xx, abort, network throw, WS→REST fallback.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import {
  serverEngine,
  pyneWorkerEngine,
  listEngines,
  getEngine,
  registerDynamicEngine,
  ensureEnginesRegistered,
  resolvePyneWorkerEndpoint,
  DEFAULT_PYNE_WORKER_ENDPOINT,
  _resetEngineRegistrationFlag,
} from '../src/engines/catalog';
import { _resetEngineWsClients } from '../src/engines/engine-ws';
import { registry } from '../src/plugins/registry';
import { _resetBootstrapFlag } from '../src/plugins/bootstrap';
import { setStore } from '../src/store';
import { SAMPLE_BARS } from './fixtures/bars';

let restoreFetch: (() => void) | null = null;
let restoreWs: (() => void) | null = null;

/** Minimal WS stub for catalog WS→REST fallback tests. */
class CatalogFakeWS {
  static instances: CatalogFakeWS[] = [];
  static failConstruct = false;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  readyState = 0;
  url: string;
  sent: string[] = [];

  constructor(url: string) {
    if (CatalogFakeWS.failConstruct) throw new Error('ws unavailable');
    this.url = url;
    CatalogFakeWS.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

beforeEach(() => {
  registry.clear();
  _resetEngineRegistrationFlag();
  _resetBootstrapFlag();
  _resetEngineWsClients();
  CatalogFakeWS.instances = [];
  CatalogFakeWS.failConstruct = false;
  ensureEnginesRegistered();
  setStore('endpoint', 'http://engine.test:5002');
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
  restoreWs?.();
  restoreWs = null;
  _resetEngineWsClients();
});

function installCatalogFakeWs(): void {
  const prev = globalThis.WebSocket;
  (globalThis as unknown as { WebSocket: typeof CatalogFakeWS }).WebSocket =
    CatalogFakeWS as never;
  restoreWs = () => {
    globalThis.WebSocket = prev;
  };
}

describe('engines catalog', () => {
  it('lists server, pyne-worker, and pyodide', () => {
    const ids = listEngines().map((e) => e.id);
    expect(ids).toContain('server');
    expect(ids).toContain('pyne-worker');
    expect(ids).toContain('pyodide');
    expect(getEngine('pyne-worker')?.builtIn).toBe(true);
    expect(pyneWorkerEngine.configSchema?.endpoint?.default).toBe(
      DEFAULT_PYNE_WORKER_ENDPOINT,
    );
  });

  it('resolvePyneWorkerEndpoint prefers config then production default', () => {
    setStore('endpoint', 'http://127.0.0.1:5002');
    expect(resolvePyneWorkerEndpoint({})).toBe(DEFAULT_PYNE_WORKER_ENDPOINT);
    expect(
      resolvePyneWorkerEndpoint({ endpoint: 'https://custom.example/pw' }),
    ).toBe('https://custom.example/pw');
    setStore('endpoint', 'https://pyne-worker.cryptolinx.workers.dev');
    expect(resolvePyneWorkerEndpoint({})).toBe(
      'https://pyne-worker.cryptolinx.workers.dev',
    );
  });

  it('pyne-worker run posts to edge /run with api key headers', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    restoreFetch = mockFetch(async (input, init) => {
      const url = String(input);
      if (url.includes('/health')) {
        return jsonResponse({ status: 'ok', worker: 'pyne-worker' });
      }
      const h = (init?.headers || {}) as Record<string, string>;
      seen.push({ url, headers: h });
      expect(url).toContain('pyne-worker');
      expect(url).toContain('/run');
      return jsonResponse({
        status: 'success',
        plots: [1],
        series: {},
        events: [],
        mode: 'interpret',
      });
    });
    // Force REST (no WS)
    CatalogFakeWS.failConstruct = true;
    installCatalogFakeWs();
    const result = await pyneWorkerEngine.run({
      script: 'plot(close)',
      bars: SAMPLE_BARS as never,
      config: {
        endpoint: DEFAULT_PYNE_WORKER_ENDPOINT,
        preferWs: false,
        apiKey: 'test-key',
      },
    });
    expect(result.status).toBe('success');
    expect(seen.some((s) => s.url.includes('/run'))).toBe(true);
    const run = seen.find((s) => s.url.includes('/run'));
    expect(run?.headers['X-API-Key'] || run?.headers['x-api-key']).toBeTruthy();
  });

  it('server run success', async () => {
    restoreFetch = mockFetch(async (input, init) => {
      const url = String(input);
      expect(url).toContain('/run');
      expect(url).toContain('mode=compile');
      // Pro API reads mode from the JSON body (query is legacy only)
      const body = JSON.parse(String(init?.body || '{}')) as {
        script?: string;
        data?: unknown[];
        mode?: string;
      };
      expect(body.mode).toBe('compile');
      expect(body.script).toBe('plot(close)');
      expect(Array.isArray(body.data)).toBe(true);
      return jsonResponse({
        status: 'success',
        plots: [1, 2, 3],
        series: { a: [1, 2, 3] },
        events: [],
        meta: { script_name: 't' },
        mode: 'compile',
      });
    });
    // preferWs: false forces REST so mockFetch is exercised (WS not mocked here)
    const r = await serverEngine.run({
      script: 'plot(close)',
      bars: SAMPLE_BARS,
      config: { endpoint: 'http://engine.test:5002', mode: 'compile', preferWs: false },
    });
    expect(r.status).toBe('success');
    expect(r.plots).toEqual([1, 2, 3]);
    expect(r.meta?.mode).toBe('compile');
    expect(r.meta?.transport).toBe('rest');
  });

  it('server run error status', async () => {
    restoreFetch = mockFetch(async () =>
      jsonResponse({ status: 'error', message: 'bad pine' }, 400),
    );
    const r = await serverEngine.run({
      script: 'bad',
      bars: SAMPLE_BARS,
      config: { endpoint: 'http://engine.test:5002', preferWs: false },
    });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/bad pine|HTTP/);
  });

  it('server run non-JSON body returns error (not throw)', async () => {
    restoreFetch = mockFetch(async () =>
      new Response('<html>gateway error</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    const r = await serverEngine.run({
      script: 'plot(1)',
      bars: SAMPLE_BARS,
      config: { endpoint: 'http://engine.test:5002', preferWs: false },
    });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/invalid JSON/i);
    expect(r.error).toMatch(/gateway error|html/i);
    expect(r.meta?.transport).toBe('rest');
  });

  it('server run empty body is invalid JSON', async () => {
    restoreFetch = mockFetch(async () => new Response('', { status: 200 }));
    const r = await serverEngine.run({
      script: 'plot(1)',
      bars: SAMPLE_BARS,
      config: { endpoint: 'http://engine.test:5002', preferWs: false },
    });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/invalid JSON/i);
  });

  it('server run 5xx surfaces HTTP status / body message', async () => {
    restoreFetch = mockFetch(async () =>
      jsonResponse({ status: 'error', message: 'worker crashed' }, 502),
    );
    const r = await serverEngine.run({
      script: 'plot(1)',
      bars: SAMPLE_BARS,
      config: { endpoint: 'http://engine.test:5002', preferWs: false },
    });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/worker crashed|HTTP 502/);
    expect(r.meta?.http_status).toBe(502);
  });

  it('server run 5xx with non-JSON body', async () => {
    restoreFetch = mockFetch(async () =>
      new Response('Internal Server Error', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );
    const r = await serverEngine.run({
      script: 'plot(1)',
      bars: SAMPLE_BARS,
      config: { endpoint: 'http://engine.test:5002', preferWs: false },
    });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/invalid JSON|HTTP 500|Internal/);
    expect(r.meta?.http_status).toBe(500);
  });

  it('server run respects AbortSignal', async () => {
    const ac = new AbortController();
    ac.abort();
    restoreFetch = mockFetch(async () => {
      throw new Error('fetch should not be called when already aborted');
    });
    const r = await serverEngine.run({
      script: 'plot(1)',
      bars: SAMPLE_BARS,
      config: { endpoint: 'http://engine.test:5002', preferWs: false },
      signal: ac.signal,
    });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/abort/i);
  });

  it('server run aborts in-flight REST when signal fires', async () => {
    const ac = new AbortController();
    restoreFetch = mockFetch(async (_input, init) => {
      const sig = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        if (sig?.aborted) {
          const e = new Error('The operation was aborted');
          e.name = 'AbortError';
          reject(e);
          return;
        }
        sig?.addEventListener('abort', () => {
          const e = new Error('The operation was aborted');
          e.name = 'AbortError';
          reject(e);
        });
        // never resolve — wait for abort
      });
    });
    const p = serverEngine.run({
      script: 'plot(1)',
      bars: SAMPLE_BARS,
      config: { endpoint: 'http://engine.test:5002', preferWs: false },
      signal: ac.signal,
    });
    // Let fetch attach the abort listener
    await Promise.resolve();
    await Promise.resolve();
    ac.abort();
    const r = await p;
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/abort/i);
  });

  it('server run network failure returns error envelope', async () => {
    restoreFetch = mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const r = await serverEngine.run({
      script: 'plot(1)',
      bars: SAMPLE_BARS,
      config: { endpoint: 'http://engine.test:5002', preferWs: false },
    });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/Failed to fetch/);
    expect(r.meta?.transport).toBe('rest');
  });

  it('server normalizes bare NaN in REST JSON', async () => {
    // Python json.dumps can emit bare NaN; browsers reject that without cleanup.
    restoreFetch = mockFetch(async () =>
      new Response('{"status":"success","plots":[NaN],"series":{},"events":[]}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const r = await serverEngine.run({
      script: 'plot(1)',
      bars: SAMPLE_BARS,
      config: { endpoint: 'http://engine.test:5002', preferWs: false },
    });
    expect(r.status).toBe('success');
    expect(r.plots?.[0]).toBeNull();
  });

  it('WS connect fail falls through to REST', async () => {
    installCatalogFakeWs();
    CatalogFakeWS.failConstruct = true;
    restoreFetch = mockFetch(async () =>
      jsonResponse({
        status: 'success',
        plots: [7],
        series: {},
        events: [],
        mode: 'interpret',
      }),
    );
    const r = await serverEngine.run({
      script: 'plot(1)',
      bars: SAMPLE_BARS,
      config: {
        endpoint: 'http://engine.test:5002',
        preferWs: true,
      },
    });
    expect(r.status).toBe('success');
    expect(r.plots).toEqual([7]);
    expect(r.meta?.transport).toBe('rest');
  });

  it('WS premature close falls through to REST', async () => {
    installCatalogFakeWs();
    restoreFetch = mockFetch(async () =>
      jsonResponse({
        status: 'success',
        plots: [3],
        series: {},
        events: [],
      }),
    );
    // Kick run; close socket before open so ensureConnected rejects.
    // engine-ws is dynamically imported — poll until the socket is constructed.
    const runP = serverEngine.run({
      script: 'plot(1)',
      bars: SAMPLE_BARS,
      config: { endpoint: 'http://engine.test:5002', preferWs: true },
    });
    const deadline = Date.now() + 2_000;
    while (!CatalogFakeWS.instances[0] && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(CatalogFakeWS.instances[0]).toBeDefined();
    CatalogFakeWS.instances[0]!.close();
    const r = await runP;
    expect(r.status).toBe('success');
    expect(r.meta?.transport).toBe('rest');
    expect(r.plots).toEqual([3]);
  });

  it('server catalog exposes interpret|compile|auto modes', () => {
    const mode = serverEngine.configSchema?.mode;
    expect(mode?.type).toBe('select');
    expect(mode?.options).toEqual(['interpret', 'compile', 'auto']);
    expect(mode?.default).toBe('interpret');
  });

  it('pyodide catalog also exposes execution mode (settings UI)', async () => {
    const { pyodideEngine } = await import('../src/engines/catalog');
    const mode = pyodideEngine.configSchema?.mode;
    expect(mode?.type).toBe('select');
    expect(mode?.options).toEqual(['interpret', 'compile', 'auto']);
  });

  it('server isReady probes root', async () => {
    // isReady requires a JSON health body (status/service/endpoints/websocket);
    // plain text "ok" is treated as SPA HTML and returns false.
    restoreFetch = mockFetch(async () =>
      jsonResponse({ status: 'ok', service: 'pyne-pro', websocket: false }),
    );
    expect(await serverEngine.isReady()).toBe(true);
  });

  it('server isReady false on network error', async () => {
    restoreFetch = mockFetch(async () => {
      throw new Error('down');
    });
    expect(await serverEngine.isReady()).toBe(false);
  });

  it('registerDynamicEngine', () => {
    registerDynamicEngine({
      id: 'dyn-eng',
      name: 'D',
      kind: 'engine',
      async isReady() {
        return true;
      },
      async run() {
        return { status: 'success', plots: [], events: [], series: {} };
      },
    });
    expect(getEngine('dyn-eng')).toBeDefined();
  });
});
