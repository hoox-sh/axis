/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Workers Manager HTTP / SW probes with mocked fetch + navigator.
 */

import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import { probeWorker, probeAllWorkers, probeAbortSignal } from '../src/workers/probe';
import {
  DEFAULT_AXIS_WORKER_BASE,
  DEFAULT_PYNE_PRO_BASE,
  PRODUCT_PYNE_PRO_HINT,
  getWorkerCatalogEntry,
  isLoopbackBase,
  isProductSameOriginApiHost,
  listWorkerCatalog,
  matchCatalogForEndpoint,
  resolveProbeEndpoint,
} from '../src/workers/catalog';

describe('probeWorker http-health', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('marks axis-worker healthy on feature JSON', async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url.includes('/health') || url.endsWith('/')).toBe(true);
      return new Response(
        JSON.stringify({
          status: 'healthy',
          service: 'pynescript-axis-worker',
          features: { onchain: true, d1: false, scripts: true },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const r = await probeWorker('axis-worker', {
      endpoint: DEFAULT_AXIS_WORKER_BASE,
      timeoutMs: 2000,
    });
    expect(r.status).toBe('healthy');
    expect(r.service).toBe('pynescript-axis-worker');
    expect(r.features.onchain).toBe(true);
    expect(r.latencyMs).not.toBeNull();
    expect(r.error).toBeNull();
  });

  it('marks pyne-pro down on network error', async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;

    const r = await probeWorker('pyne-pro', {
      endpoint: DEFAULT_PYNE_PRO_BASE,
      timeoutMs: 500,
    });
    expect(r.status).toBe('down');
    expect(r.error).toBeTruthy();
  });

  it('probes pyne-worker /health when default endpoint is set', async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('pyne-worker');
      expect(url).toContain('/health');
      return new Response(
        JSON.stringify({ status: 'ok', worker: 'pyne-worker', features: {} }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    const r = await probeWorker('pyne-worker', { timeoutMs: 500 });
    expect(r.status).toBe('healthy');
    expect(r.endpoint).toContain('pyne-worker');
  });

  it('returns unknown for bogus id', async () => {
    const r = await probeWorker('nope' as never);
    expect(r.status).toBe('unknown');
  });
});

describe('probeWorker service-worker', () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    // @ts-expect-error restore
    globalThis.navigator = originalNavigator;
  });

  it('skipped when serviceWorker API missing', async () => {
    // @ts-expect-error stub
    globalThis.navigator = {};
    const r = await probeWorker('service-worker');
    expect(r.status).toBe('skipped');
  });

  it('healthy when registration active + controlled', async () => {
    // @ts-expect-error stub
    globalThis.navigator = {
      serviceWorker: {
        controller: {},
        getRegistration: async () => ({
          active: {},
          waiting: null,
          installing: null,
          scope: 'https://example.com/',
        }),
      },
    };
    const r = await probeWorker('service-worker');
    expect(r.status).toBe('healthy');
    expect(r.features.controlled).toBe(true);
  });
});

describe('probeAllWorkers', () => {
  const originalFetch = globalThis.fetch;
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    // @ts-expect-error stub
    globalThis.navigator = {
      serviceWorker: {
        controller: null,
        getRegistration: async () => undefined,
      },
    };
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('pyodide.js')) {
        return new Response('// pyodide', {
          status: 200,
          headers: { 'Content-Type': 'application/javascript' },
        });
      }
      if (url.includes('8787') || url.includes('workers.dev') || url.includes('5002')) {
        return new Response(
          JSON.stringify({ status: 'healthy', service: 'test-service', endpoints: {} }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('pyne-agent')) {
        return new Response(
          JSON.stringify({ service: 'pyne-agent-worker', version: '0.1.0' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('nope', { status: 404 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    // @ts-expect-error restore
    globalThis.navigator = originalNavigator;
  });

  it('returns a full snapshot', async () => {
    const snap = await probeAllWorkers({ timeoutMs: 2000 });
    expect(snap.results.length).toBeGreaterThanOrEqual(6);
    expect(snap.checkedAt).toBeGreaterThan(0);
    expect(snap.healthy + snap.degraded + snap.down + snap.unknown).toBe(
      snap.results.length,
    );
  });

  it('finishes when a host never responds (hard timeout)', async () => {
    globalThis.fetch = mock(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    ) as typeof fetch;

    const t0 = Date.now();
    const snap = await probeAllWorkers({ timeoutMs: 400 });
    const elapsed = Date.now() - t0;
    // Wall clock should stay near one timeout budget, not hang forever
    expect(elapsed).toBeLessThan(4000);
    expect(snap.results.length).toBe(listWorkerCatalog().length);
  });
});

describe('catalog usage + icons', () => {
  it('every catalog entry has a distinct icon and non-empty usage', () => {
    const all = listWorkerCatalog();
    const icons = new Set(all.map((w) => w.icon));
    expect(icons.size).toBe(all.length);
    for (const w of all) {
      expect(w.usage.trim().length).toBeGreaterThan(20);
      expect(w.icon).toBeTruthy();
    }
  });
});

describe('probeAbortSignal', () => {
  it('aborts after timeout when parent is idle', async () => {
    const s = probeAbortSignal(50);
    expect(s.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 80));
    expect(s.aborted).toBe(true);
  });
});

describe('resolveProbeEndpoint / hardened VPS', () => {
  it('detects product same-origin hosts and loopback', () => {
    expect(isProductSameOriginApiHost('https://axis.hoox.sh')).toBe(true);
    expect(isProductSameOriginApiHost('https://axis.hoox.sh/app')).toBe(true);
    expect(isLoopbackBase('http://127.0.0.1:5002')).toBe(true);
    expect(isLoopbackBase('https://axis.hoox.sh')).toBe(false);
  });

  it('maps axis.hoox.sh endpoint to pyne-pro (not CF worker)', () => {
    expect(matchCatalogForEndpoint('https://axis.hoox.sh')).toBe('pyne-pro');
    expect(matchCatalogForEndpoint(PRODUCT_PYNE_PRO_HINT)).toBe('pyne-pro');
  });

  it('probes same-origin public health on product page, not client loopback', () => {
    const entry = getWorkerCatalogEntry('pyne-pro')!;
    expect(entry.publicEndpoint).toBe(PRODUCT_PYNE_PRO_HINT);
    const ep = resolveProbeEndpoint(entry, {
      pageOrigin: 'https://axis.hoox.sh',
    });
    expect(ep).toBe('https://axis.hoox.sh');
    expect(isLoopbackBase(ep)).toBe(false);
  });

  it('keeps loopback probe on local Vite page', () => {
    const entry = getWorkerCatalogEntry('pyne-pro')!;
    const ep = resolveProbeEndpoint(entry, {
      pageOrigin: 'http://127.0.0.1:3000',
    });
    expect(ep).toBe(DEFAULT_PYNE_PRO_BASE);
  });

  it('uses active backend when it maps to the worker', () => {
    const entry = getWorkerCatalogEntry('pyne-pro')!;
    const ep = resolveProbeEndpoint(entry, {
      activeEndpoint: 'https://axis.hoox.sh',
      pageOrigin: 'http://127.0.0.1:3000',
    });
    expect(ep).toBe('https://axis.hoox.sh');
  });
});
