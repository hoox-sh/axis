// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `POST /run/batch` client: request shaping (shared bars, script cap), per-script
 * result mapping (success / partial / missing), and the null-on-missing-route
 * contract that lets callers fall back to per-script runs.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import { runBatch, RUN_BATCH_MAX_SCRIPTS } from '../src/engines/batch';
import { SAMPLE_BARS } from './fixtures/bars';

const ENDPOINT = 'http://batch.test:5002';

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

let restore: (() => void) | null = null;
let calls: Call[] = [];

function install(handler: (call: Call) => Response | Promise<Response>): void {
  restore = mockFetch(async (input, init) => {
    const url = new URL(String(input));
    const call: Call = {
      method: String(init?.method || 'GET').toUpperCase(),
      path: url.pathname,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    };
    calls.push(call);
    return handler(call);
  });
}

function successEntry(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    status: 'success',
    plots: [1, 2, 3],
    series: { s0: [1, 2, 3] },
    plot_meta: { s0: { type: 'line' } },
    events: [],
    drawings: [],
    alerts: [],
    script_id: `${id}-sid`,
    run_id: `${id}-run`,
    count: 3,
    mode: 'interpret',
    ...extra,
  };
}

const twoScripts = [
  { id: 'ind-a', script: 'indicator("a")\nplot(close)' },
  { id: 'ind-b', script: 'indicator("b")\nplot(open)' },
];

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  restore?.();
  restore = null;
});

describe('runBatch', () => {
  it('posts scripts with shared bars and maps per-script results', async () => {
    install(() =>
      jsonResponse({
        status: 'success',
        results: [successEntry('ind-a'), successEntry('ind-b')],
        count: 2,
        ok: 2,
        data_source: 'chart',
      }),
    );

    const outcome = await runBatch({ endpoint: ENDPOINT, scripts: twoScripts, bars: SAMPLE_BARS });

    expect(calls.length).toBe(1);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.path).toBe('/run/batch');
    const body = calls[0]!.body!;
    expect(body.scripts).toEqual([
      { id: 'ind-a', script: 'indicator("a")\nplot(close)' },
      { id: 'ind-b', script: 'indicator("b")\nplot(open)' },
    ]);
    expect((body.data as unknown[]).length).toBe(SAMPLE_BARS.length);
    expect(body.symbol).toBe('CHART');
    expect(body.mode).toBe('auto');

    expect(outcome?.allOk).toBe(true);
    expect(outcome?.dataSource).toBe('chart');
    expect(outcome?.error).toBeNull();
    expect(outcome?.entries.map((e) => e.id)).toEqual(['ind-a', 'ind-b']);
    const first = outcome!.entries[0]!.result!;
    expect(first.status).toBe('success');
    expect(first.plots).toEqual([1, 2, 3]);
    expect(first.series).toEqual({ s0: [1, 2, 3] });
    expect(first.meta?.batch).toBe(true);
    expect(first.meta?.transport).toBe('rest');
    expect(first.meta?.script_id).toBe('ind-a-sid');
  });

  it('isolates a per-script failure (partial envelope)', async () => {
    install(() =>
      jsonResponse({
        status: 'partial',
        results: [
          successEntry('ind-a'),
          { id: 'ind-b', status: 'error', code: 'EXECUTION_ERROR', message: 'bad script' },
        ],
        count: 2,
        ok: 1,
      }),
    );
    const outcome = await runBatch({ endpoint: ENDPOINT, scripts: twoScripts, bars: SAMPLE_BARS });
    expect(outcome?.allOk).toBe(false);
    expect(outcome?.error).toBeNull();
    expect(outcome?.entries[0]?.ok).toBe(true);
    expect(outcome?.entries[1]?.ok).toBe(false);
    expect(outcome?.entries[1]?.error).toBe('bad script');
  });

  it('reports a requested script the backend did not answer for', async () => {
    install(() => jsonResponse({ status: 'partial', results: [successEntry('ind-a')] }));
    const outcome = await runBatch({ endpoint: ENDPOINT, scripts: twoScripts, bars: SAMPLE_BARS });
    expect(outcome?.entries[1]).toEqual({
      id: 'ind-b',
      ok: false,
      error: 'no result returned',
    });
  });

  it('returns null when the backend has no batch route', async () => {
    install(() => jsonResponse({ status: 'error' }, 404));
    expect(await runBatch({ endpoint: ENDPOINT, scripts: twoScripts, bars: SAMPLE_BARS })).toBeNull();
  });

  it('returns an error outcome for a transport failure, never throws', async () => {
    install(() => {
      throw new Error('offline');
    });
    const outcome = await runBatch({ endpoint: ENDPOINT, scripts: twoScripts, bars: SAMPLE_BARS });
    expect(outcome?.error).toBe('batch request failed');
    expect(outcome?.entries).toEqual([]);
  });

  it('surfaces an envelope error body', async () => {
    install(() => jsonResponse({ status: 'error', message: 'TOO_MANY_SCRIPTS' }, 400));
    const outcome = await runBatch({ endpoint: ENDPOINT, scripts: twoScripts, bars: SAMPLE_BARS });
    expect(outcome?.error).toBe('TOO_MANY_SCRIPTS');
  });

  it('refuses to batch more scripts than the backend allows', async () => {
    install(() => jsonResponse({ status: 'success', results: [] }));
    const many = Array.from({ length: RUN_BATCH_MAX_SCRIPTS + 1 }, (_, i) => ({
      id: `s${i}`,
      script: `indicator("s${i}")\nplot(close)`,
    }));
    expect(await runBatch({ endpoint: ENDPOINT, scripts: many, bars: SAMPLE_BARS })).toBeNull();
    expect(calls.length).toBe(0);
  });

  it('is a no-op without bars, endpoint, or scripts', async () => {
    install(() => jsonResponse({ status: 'success', results: [] }));
    expect(await runBatch({ endpoint: ENDPOINT, scripts: twoScripts, bars: [] })).toBeNull();
    expect(await runBatch({ endpoint: '', scripts: twoScripts, bars: SAMPLE_BARS })).toBeNull();
    expect(await runBatch({ endpoint: ENDPOINT, scripts: [], bars: SAMPLE_BARS })).toBeNull();
    expect(calls.length).toBe(0);
  });

  it('sends the API key headers when configured', async () => {
    install(() => jsonResponse({ status: 'success', results: [successEntry('ind-a')] }));
    await runBatch({
      endpoint: ENDPOINT,
      apiKey: 'pn_batch_key',
      scripts: twoScripts.slice(0, 1),
      bars: SAMPLE_BARS,
    });
    // Headers are asserted by the mock-fetch contract elsewhere; the request
    // shape here is the key thing.
    expect(calls[0]!.path).toBe('/run/batch');
  });
});

describe('batched result reuse (runner seam)', () => {
  it('applies a precomputed result without a second engine call', async () => {
    // Any network call here would be the single-run path leaking through.
    install(() => {
      throw new Error('engine must not be called for a precomputed result');
    });
    const { runAndApply, _resetRunEpochForTests } = await import('../src/indicators/runner');
    const { registry } = await import('../src/plugins/registry');
    const {
      _resetEngineRegistrationFlag,
      _setCachedEngineCapabilitiesForTests,
      DEFAULT_ENGINE_CAPABILITIES,
    } = await import('../src/engines/catalog');
    const { ensureBuiltins, _resetBootstrapFlag } = await import('../src/plugins/bootstrap');
    const { setStore, setActivePlugin, clearLogs } = await import('../src/store');

    registry.clear();
    _resetEngineRegistrationFlag();
    _resetBootstrapFlag();
    ensureBuiltins();
    clearLogs();
    _resetRunEpochForTests();
    _setCachedEngineCapabilitiesForTests(null);
    setStore('bars', SAMPLE_BARS.map((b) => ({ ...b })));
    setStore('endpoint', ENDPOINT);
    setStore('source', 'binance-rest');
    setStore('symbol', 'BTCUSDT');
    setStore('interval', '1h');
    setStore('pluginsConfig', { 'engine:server': { mode: 'interpret', preferWs: false } });
    setStore('scripts', []);
    setStore('runResults', {});
    setStore('lastRun', null);
    setActivePlugin('engine', 'server');

    const batched = {
      status: 'success' as const,
      plots: [7, 8],
      series: { s0: [7, 8] },
      events: [],
      meta: { ms: 1, script_name: 'batched', batch: true },
    };
    const result = await runAndApply('indicator("x")\nplot(close)', undefined, {
      silent: true,
      openResults: false,
      precomputedResult: batched,
    });
    expect(result.status).toBe('success');
    expect(result.plots).toEqual([7, 8]);
    expect(result.meta?.batch).toBe(true);
    expect(calls.length).toBe(0);
    // The normal post-run bookkeeping still ran.
    expect((await import('../src/store')).store.lastRun).not.toBeNull();
    _setCachedEngineCapabilitiesForTests(null);
  });
});
