/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Engine-owned live mode runner wiring: when the selected engine owns the
 * feed (dataSession caps + every-tick policy), `runAndApply` must evaluate
 * over the engine's series — sending identity only, never bars — instead of
 * the bars-in path.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import { registry } from '../src/plugins/registry';
import { ensureBuiltins, _resetBootstrapFlag } from '../src/plugins/bootstrap';
import { _resetSourceRegistrationFlag } from '../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../src/streams/catalog';
import {
  _resetEngineRegistrationFlag,
  _setCachedEngineCapabilitiesForTests,
  DEFAULT_ENGINE_CAPABILITIES,
} from '../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import { _resetDataSessionMemo } from '../src/engines/data-sessions';
import { _resetChartDataSessionForTests } from '../src/engines/chart-data-session';
import { reconcile } from 'solid-js/store';
import { setStore, setActivePlugin, clearLogs } from '../src/store';
import { runAndApply, _resetRunEpochForTests } from '../src/indicators/runner';
import { SAMPLE_BARS } from './fixtures/bars';
import type { Bar } from '../src/store/types';

const ENDPOINT = 'http://run.test:5002';
const SCRIPT = 'indicator("eo")\nplot(close)';

interface RecordedCall {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

let restoreFetch: (() => void) | null = null;
let calls: RecordedCall[] = [];

beforeEach(() => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  ensureBuiltins();
  clearLogs();
  _resetRunEpochForTests();
  _resetDataSessionMemo();
  _resetChartDataSessionForTests();
  calls = [];
  setStore('bars', SAMPLE_BARS.map((b) => ({ ...b })));
  setStore('endpoint', ENDPOINT);
  setStore('source', 'binance-rest');
  setStore('symbol', 'BTCUSDT');
  setStore('interval', '1h');
  setStore('pluginsConfig', { 'engine:server': { mode: 'interpret', preferWs: false } });
  setStore('profilerEnabled', false);
  setStore('scripts', []);
  setStore('live', 'rerunOn', 'every-tick');
  setStore('resultsPanel', { open: false, height: 220 });
  setStore('resultsFocusId', null);
  setStore('runResults', {});
  setStore('lastRun', null);
  setActivePlugin('engine', 'server');

  restoreFetch = mockFetch(async (input, init) => {
    const url = new URL(String(input));
    const call: RecordedCall = {
      method: String(init?.method || 'GET').toUpperCase(),
      path: url.pathname,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    };
    calls.push(call);
    if (call.method === 'POST' && call.path === '/data/session') {
      return jsonResponse({
        status: 'success',
        session_id: 'eo1',
        cache: 'hit',
        plots: [1],
        series: {},
        events: [],
        drawings: [],
        alerts: [],
        inputs: [],
        mode: 'interpret',
        overlay: false,
        meta: {},
      });
    }
    if (call.method === 'POST' && call.path === '/session') {
      return jsonResponse({
        status: 'success',
        session_id: 'legacy1',
        plots: [],
        series: {},
        events: [],
        mode: 'interpret',
        meta: {},
      });
    }
    if (call.method === 'POST' && call.path.startsWith('/run')) {
      return jsonResponse({ status: 'success', plots: [], events: [], series: {}, meta: {} });
    }
    return jsonResponse({ status: 'error', code: 'NOT_FOUND' }, 404);
  });
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
  _setCachedEngineCapabilitiesForTests(null);
  // This file writes `engine:server.preferWs: false`; Bun shares module state
  // across test files, so clear it or a later file's transport assertions see
  // 'rest' where they expect 'ws'. A plain `{}` MERGES in a Solid store and
  // leaves the key in place — reconcile({}) is what actually replaces it.
  setStore('pluginsConfig', reconcile({}));
});

describe('runner engine-owned routing', () => {
  it('sends identity only (no bars) over the data-session path when engine-owned', async () => {
    _setCachedEngineCapabilitiesForTests({
      ...DEFAULT_ENGINE_CAPABILITIES,
      liveModes: ['every-tick', 'bar-close'],
      ownsData: true,
      dataSession: true,
    });

    const r = await runAndApply(SCRIPT, undefined, { silent: true, openResults: false });
    expect(r.status).toBe('success');

    const session = calls.find((c) => c.method === 'POST' && c.path === '/data/session');
    expect(session).toBeDefined();
    // Identity is canonical for the engine store: pair-form symbol + market.
    expect(session!.body).toMatchObject({
      exchange: 'binance',
      market: 'spot',
      symbol: 'BTC/USDT',
      interval: '1h',
    });
    expect(session!.body!.history_bars).toBeGreaterThan(0);
    // The defining guarantee: no OHLCV leaves the browser.
    expect(session!.body).not.toHaveProperty('data');
    expect(session!.body).not.toHaveProperty('bars');
    // No legacy bars-in route is used.
    expect(calls.some((c) => c.path === '/session' || c.path.startsWith('/run'))).toBe(false);
  });

  it('keeps the bars-in path when the engine does not own data', async () => {
    // Default caps: no dataSession → bar-close engine.
    const r = await runAndApply(SCRIPT, undefined, { silent: true, openResults: false });
    expect(r.status).toBe('success');
    expect(calls.some((c) => c.path === '/session' || c.path.startsWith('/run'))).toBe(true);
    expect(calls.some((c) => c.path === '/data/session')).toBe(false);
  });

  it('keeps the bars-in path for isolate studies even when engine-owned', async () => {
    _setCachedEngineCapabilitiesForTests({
      ...DEFAULT_ENGINE_CAPABILITIES,
      liveModes: ['every-tick', 'bar-close'],
      ownsData: true,
      dataSession: true,
    });
    const r = await runAndApply(SCRIPT, undefined, {
      silent: true,
      openResults: false,
      isolate: true,
      bars: SAMPLE_BARS.slice(0, 10) as Bar[],
    });
    expect(r.status).toBe('success');
    expect(calls.some((c) => c.path === '/data/session')).toBe(false);
  });
});
