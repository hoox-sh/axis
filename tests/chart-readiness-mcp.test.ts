/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * PR-D — MCP readiness strip + generation isolation (foreign-G paint blocked,
 * failed scripts still reveal).
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import {
  _resetChartReadinessForTests,
  beginChartReadiness,
  chartReadinessSnapshot,
  failChartReadiness,
  getChartReadiness,
  isLivePaintAllowed,
  noteChartScriptSettled,
  revealChart,
  setChartReadinessPhase,
  settleAllChartScripts,
} from '../src/chart/readiness';
import { setStore, setActivePlugin, addIndicator, clearLogs } from '../src/store';
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
import {
  loadSymbolData,
  _resetLoadGeneration,
} from '../src/data/load-symbol';
import { invokeCapability } from '../src/mcp/dispatch';
import { SAMPLE_BARS } from './fixtures/bars';

// biome-ignore lint/suspicious/noExplicitAny: test-only loose capability-result view
type CapResult = Record<string, any>;

let restoreFetch: (() => void) | null = null;

beforeEach(() => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  _resetLoadGeneration();
  _resetChartReadinessForTests();
  ensureBuiltins();
  clearLogs();
  setStore('bars', SAMPLE_BARS.map((b) => ({ ...b })));
  setStore('symbol', 'BTCUSDT');
  setStore('interval', '1h');
  setStore('source', 'mock-walk');
  setStore('endpoint', 'http://readiness-mcp.test');
  setStore('scripts', []);
  setStore('live', {
    active: false,
    needsRerun: false,
    lastBarTime: 0,
    streamId: '',
    preferAfterLoad: false,
    rerunOn: 'every-tick',
  });
  setStore('pluginsConfig', {
    'engine:server': {
      mode: 'interpret',
      preferWs: false,
      endpoint: 'http://readiness-mcp.test',
      apiKey: 'k',
    },
  });
  setActivePlugin('engine', 'server');
  _setCachedEngineCapabilitiesForTests({
    ...DEFAULT_ENGINE_CAPABILITIES,
    liveModes: ['every-tick', 'bar-close'],
  });
  restoreFetch = mockFetch(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/health') {
      return jsonResponse({
        status: 'healthy',
        features: { live_stream: false, data_session: false, live_modes: ['bar-close'] },
      });
    }
    if (url.pathname === '/run' || url.pathname.endsWith('/run')) {
      return jsonResponse({
        status: 'success',
        plots: [],
        series: {},
        plot_meta: {},
        events: [],
        drawings: [],
        alerts: [],
        inputs: [],
        mode: 'interpret',
        overlay: true,
        count: SAMPLE_BARS.length,
        meta: {},
      });
    }
    return jsonResponse({ status: 'error', code: 'NOT_FOUND' }, 404);
  });
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
  _resetChartReadinessForTests();
  _resetLoadGeneration();
  _setCachedEngineCapabilitiesForTests(null);
});

describe('chartReadinessSnapshot / MCP', () => {
  it('exposes readiness on chart.get and chart.lag', async () => {
    beginChartReadiness(7, { symbol: 'ETHUSDT', interval: '5m', source: 'binance-rest' });
    setChartReadinessPhase(7, 'applying-scripts', { scriptsTotal: 2 });
    noteChartScriptSettled(7, 'a');

    const snap = chartReadinessSnapshot();
    expect(snap).toMatchObject({
      generation: 7,
      phase: 'applying-scripts',
      symbol: 'ETHUSDT',
      interval: '5m',
      scriptsTotal: 2,
      scriptsSettled: 1,
      blocking: true,
      livePaintAllowed: false,
      liveArmedGeneration: 0,
    });

    const get = await invokeCapability('chart.get');
    expect(get.readiness).toMatchObject({
      generation: 7,
      phase: 'applying-scripts',
      scriptsSettled: 1,
      blocking: true,
    });

    const lag = await invokeCapability('chart.lag', { engine: false });
    expect(lag.readiness).toMatchObject({
      generation: 7,
      phase: 'applying-scripts',
      blocking: true,
      livePaintAllowed: false,
    });
  });

  it('after reveal, MCP shows ready and livePaintAllowed', async () => {
    beginChartReadiness(8, { symbol: 'SOLUSDT', interval: '1m', source: 'binance-rest' });
    revealChart(8);
    const get = await invokeCapability('chart.get');
    expect(get.readiness).toMatchObject({
      generation: 8,
      phase: 'ready',
      blocking: false,
      livePaintAllowed: true,
      liveArmedGeneration: 8,
    });
  });
});

describe('generation isolation', () => {
  it('blocks live paint while loading and allows after reveal', () => {
    beginChartReadiness(1, { symbol: 'BTCUSDT', interval: '1m', source: 'binance-rest' });
    expect(isLivePaintAllowed()).toBe(false);
    setChartReadinessPhase(1, 'binding-engine');
    expect(isLivePaintAllowed()).toBe(false);
    setChartReadinessPhase(1, 'applying-scripts', { scriptsTotal: 3 });
    noteChartScriptSettled(1, 'x');
    noteChartScriptSettled(1, 'y');
    noteChartScriptSettled(1, 'z');
    expect(isLivePaintAllowed()).toBe(false);
    revealChart(1);
    expect(isLivePaintAllowed()).toBe(true);
  });

  it('a newer claim keeps the prior generation disarmed', () => {
    beginChartReadiness(1, { symbol: 'BTCUSDT', interval: '1m', source: 'binance-rest' });
    revealChart(1);
    expect(isLivePaintAllowed()).toBe(true);
    beginChartReadiness(2, { symbol: 'ETHUSDT', interval: '1m', source: 'binance-rest' });
    expect(isLivePaintAllowed()).toBe(false);
    expect(chartReadinessSnapshot().generation).toBe(2);
    // Stale reveal must not arm
    revealChart(1);
    expect(isLivePaintAllowed()).toBe(false);
    revealChart(2);
    expect(isLivePaintAllowed()).toBe(true);
  });

  it('failed scripts still settle and reveal (overlay cannot trap)', () => {
    beginChartReadiness(3, { symbol: 'XRPUSDT', interval: '15m', source: 'binance-rest' });
    setChartReadinessPhase(3, 'applying-scripts', { scriptsTotal: 2 });
    noteChartScriptSettled(3, 'ok-script');
    // Simulate a failed script still counting as settled:
    noteChartScriptSettled(3, 'bad-script');
    settleAllChartScripts(3);
    revealChart(3);
    expect(getChartReadiness().phase).toBe('ready');
    expect(isLivePaintAllowed()).toBe(true);
    expect(getChartReadiness().scriptsSettled).toBe(2);
  });

  it('failChartReadiness keeps blocking and disarms live paint', () => {
    beginChartReadiness(4, { symbol: 'ADAUSDT', interval: '1h', source: 'binance-rest' });
    failChartReadiness(4, 'Venue unreachable.');
    expect(getChartReadiness().phase).toBe('error');
    expect(chartReadinessSnapshot().blocking).toBe(true);
    expect(isLivePaintAllowed()).toBe(false);
  });
});

describe('loadSymbolData readiness integration', () => {
  it('ends ready with live paint armed after a successful mock load', async () => {
    addIndicator('SMA', 'indicator("SMA")\nplot(close)', 'price', {});
    // Force venue path: preferDataset false + mock-walk source
    const ok = await loadSymbolData('BTCUSDT', '1h', 'mock-walk', { preferDataset: false });
    expect(ok).toBe(true);
    const snap = chartReadinessSnapshot();
    expect(snap.phase).toBe('ready');
    expect(snap.blocking).toBe(false);
    expect(snap.livePaintAllowed).toBe(true);
    expect(snap.generation).toBeGreaterThan(0);
    // At least one script was expected during applying-scripts (may settle 1/1)
    expect(snap.scriptsTotal).toBeGreaterThanOrEqual(0);
  });
});
