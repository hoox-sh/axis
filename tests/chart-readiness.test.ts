/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Chart Generation Readiness — splash until OHLCV (+ scripts) settle for G.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import {
  _resetChartReadinessForTests,
  beginChartReadiness,
  chartLiveArmedGeneration,
  chartReadinessStillCurrent,
  failChartReadiness,
  getChartReadiness,
  isChartReady,
  isChartReadinessBlocking,
  isLivePaintAllowed,
  noteChartScriptSettled,
  revealChart,
  setChartReadinessPhase,
  settleAllChartScripts,
} from '../src/chart/readiness';

beforeEach(() => {
  _resetChartReadinessForTests();
});

describe('chart readiness FSM', () => {
  it('starts ready and blocks after begin', () => {
    expect(isChartReady()).toBe(true);
    expect(isChartReadinessBlocking()).toBe(false);
    beginChartReadiness(1, { symbol: 'BTCUSDT', interval: '1m', source: 'binance-rest' });
    expect(isChartReady()).toBe(false);
    expect(isChartReadinessBlocking()).toBe(true);
    expect(getChartReadiness().phase).toBe('loading-data');
    expect(getChartReadiness().sentence).toContain('BTCUSDT');
  });

  it('ignores stale generation updates', () => {
    beginChartReadiness(2, { symbol: 'ETHUSDT', interval: '5m', source: 'binance-rest' });
    setChartReadinessPhase(1, 'applying-scripts', { scriptsTotal: 3 });
    expect(getChartReadiness().phase).toBe('loading-data');
    expect(chartReadinessStillCurrent(1)).toBe(false);
    expect(chartReadinessStillCurrent(2)).toBe(true);
  });

  it('tracks script settle counts then reveals', () => {
    beginChartReadiness(3, { symbol: 'SOLUSDT', interval: '1h', source: 'binance-rest' });
    setChartReadinessPhase(3, 'applying-scripts', { scriptsTotal: 2 });
    expect(getChartReadiness().sentence).toContain('0/2');
    noteChartScriptSettled(3, 'a');
    expect(getChartReadiness().scriptsSettled).toBe(1);
    expect(getChartReadiness().sentence).toContain('1/2');
    noteChartScriptSettled(3, 'a'); // idempotent per id
    expect(getChartReadiness().scriptsSettled).toBe(1);
    noteChartScriptSettled(3, 'b');
    expect(getChartReadiness().scriptsSettled).toBe(2);
    expect(getChartReadiness().sentence).toContain('2/2');
    settleAllChartScripts(3);
    expect(getChartReadiness().scriptsSettled).toBe(2);
    revealChart(3);
    expect(isChartReady()).toBe(true);
    expect(isChartReadinessBlocking()).toBe(false);
  });

  it('OHLCV-only loads reveal without a scripts phase', () => {
    beginChartReadiness(4, { symbol: 'BNBUSDT', interval: '1m', source: 'binance-rest' });
    expect(isLivePaintAllowed()).toBe(false);
    revealChart(4);
    expect(getChartReadiness().phase).toBe('ready');
    expect(isLivePaintAllowed()).toBe(true);
    expect(chartLiveArmedGeneration()).toBe(4);
  });

  it('keeps the overlay on hard failure', () => {
    beginChartReadiness(5, { symbol: 'XRPUSDT', interval: '1m', source: 'binance-rest' });
    failChartReadiness(5, 'Venue unreachable.');
    expect(isChartReadinessBlocking()).toBe(true);
    expect(getChartReadiness().phase).toBe('error');
    expect(getChartReadiness().sentence).toContain('Venue unreachable');
  });
});
