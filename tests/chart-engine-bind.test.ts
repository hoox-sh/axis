/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * PR-C — engine bind for chart generation: invalidate sessions, stop wire,
 * arm live paint only after reveal.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import {
  _resetChartReadinessForTests,
  beginChartReadiness,
  chartLiveArmedGeneration,
  getChartReadiness,
  isLivePaintAllowed,
  priorChartReadinessIdentity,
  revealChart,
} from '../src/chart/readiness';
import { bindChartEngineForGeneration } from '../src/chart/engine-bind';
import { setStore, setActivePlugin } from '../src/store';
import {
  _getSeriesProvisionForTests,
  _noteSeriesProvisionForTests,
  _resetDataSessionMemo,
  invalidateDataSessions,
} from '../src/engines/data-sessions';
import { _resetChartDataSessionForTests } from '../src/engines/chart-data-session';

const ENDPOINT = 'http://chart-bind.test';

let restoreFetch: (() => void) | null = null;

beforeEach(() => {
  _resetChartReadinessForTests();
  _resetDataSessionMemo();
  _resetChartDataSessionForTests();
  setStore('endpoint', ENDPOINT);
  setStore('source', 'binance-rest');
  setStore('symbol', 'BTCUSDT');
  setStore('interval', '1m');
  setStore('pluginsConfig', {
    'engine:server': { mode: 'interpret', preferWs: false, endpoint: ENDPOINT, apiKey: 'k' },
  });
  setActivePlugin('engine', 'server');
  restoreFetch = mockFetch(async (input, init) => {
    const url = new URL(String(input));
    const method = String(init?.method || 'GET').toUpperCase();
    if (method === 'DELETE' && url.pathname.startsWith('/data/session/')) {
      return jsonResponse({ status: 'success' });
    }
    return jsonResponse({ status: 'error' }, 404);
  });
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
  _resetChartReadinessForTests();
  _resetDataSessionMemo();
  _resetChartDataSessionForTests();
});

describe('live paint arming', () => {
  it('disarms on begin and arms on reveal', () => {
    beginChartReadiness(1, { symbol: 'BTCUSDT', interval: '1m', source: 'binance-rest' });
    expect(isLivePaintAllowed()).toBe(false);
    expect(chartLiveArmedGeneration()).toBe(0);
    revealChart(1);
    expect(isLivePaintAllowed()).toBe(true);
    expect(chartLiveArmedGeneration()).toBe(1);
    beginChartReadiness(2, { symbol: 'ETHUSDT', interval: '1m', source: 'binance-rest' });
    expect(isLivePaintAllowed()).toBe(false);
    expect(priorChartReadinessIdentity()?.symbol).toBe('BTCUSDT');
  });
});

describe('bindChartEngineForGeneration', () => {
  it('runs binding-engine, stops the wire, and drops prior series provision', async () => {
    const btcKey = {
      exchange: 'binance',
      market: 'spot' as const,
      symbol: 'BTC/USDT',
      interval: '1m',
    };
    beginChartReadiness(1, { symbol: 'BTCUSDT', interval: '1m', source: 'binance-rest' });
    revealChart(1);
    _noteSeriesProvisionForTests(ENDPOINT, btcKey, 500);
    expect(_getSeriesProvisionForTests(ENDPOINT, btcKey)?.historyBars).toBe(500);

    beginChartReadiness(2, { symbol: 'ETHUSDT', interval: '1m', source: 'binance-rest' });
    expect(priorChartReadinessIdentity()?.symbol).toBe('BTCUSDT');

    const result = await bindChartEngineForGeneration(2, {
      symbol: 'ETHUSDT',
      interval: '1m',
      source: 'binance-rest',
    });
    expect(result.stoppedWire).toBe(true);
    expect(result.releasedChartSession).toBe(true);
    expect(result.invalidatedData).toBeGreaterThanOrEqual(1);
    expect(_getSeriesProvisionForTests(ENDPOINT, btcKey)).toBeNull();
    expect(getChartReadiness().phase).toBe('binding-engine');
  });

  it('invalidateDataSessions drops series provision memos', () => {
    const key = {
      exchange: 'binance',
      market: 'spot' as const,
      symbol: 'ETH/USDT',
      interval: '5m',
    };
    _noteSeriesProvisionForTests(ENDPOINT, key, 200);
    expect(invalidateDataSessions(ENDPOINT, key)).toBeGreaterThanOrEqual(1);
    expect(_getSeriesProvisionForTests(ENDPOINT, key)).toBeNull();
  });

  it('no-ops when generation is stale', async () => {
    beginChartReadiness(3, { symbol: 'SOLUSDT', interval: '5m', source: 'binance-rest' });
    const result = await bindChartEngineForGeneration(2, {
      symbol: 'SOLUSDT',
      interval: '5m',
      source: 'binance-rest',
    });
    expect(result).toEqual({
      invalidatedData: 0,
      invalidatedLive: 0,
      releasedChartSession: false,
      stoppedWire: false,
    });
  });
});
