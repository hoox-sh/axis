// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Engine-side dataset flush.
 *
 * AXIS caches the venue's OHLCV twice: locally (the dataset store) and in the
 * engine's own series store. Flushing only the local side leaves the engine
 * serving the old — stale, holed — window, and the chart mirrors the engine's
 * copy in the live path. The flush therefore drops the engine's series for
 * every key AXIS knows about (per key — the engine's store is shared).
 */

import { describe, expect, it, beforeEach } from 'bun:test';

import './setup';
import { installLightweightChartsMock } from './helpers/mock-lwc';

installLightweightChartsMock();

const { knownEngineSeriesKeys, flushEngineSeries } = await import('../src/data/engine-flush');
const { seriesKeyString } = await import('../src/engines/data-sessions');
const { putDatasetBars, _resetDatasetStoreForTests } = await import('../src/data/dataset-store');
const { setStore, store } = await import('../src/store');

describe('knownEngineSeriesKeys', () => {
  beforeEach(() => {
    _resetDatasetStoreForTests();
    setStore('symbol', '');
    setStore('interval', '');
  });

  it('lists the local datasets and the chart series', async () => {
    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [
      { time: 60, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);
    setStore('symbol', 'ETHUSDT');
    setStore('interval', '1h');
    setStore('exchange', 'binance');

    const keys = knownEngineSeriesKeys().map((k) => seriesKeyString(k));

    expect(keys).toContain('binance|spot|BTC/USDT|1d');
    expect(keys).toContain('binance|spot|ETH/USDT|1h');
  });
});

describe('flushEngineSeries', () => {
  beforeEach(() => {
    _resetDatasetStoreForTests();
    setStore('symbol', '');
    setStore('interval', '');
  });

  it('reports the keys it could not drop without engine credentials', async () => {
    setStore('symbol', 'BTCUSDT');
    setStore('interval', '1h');

    const out = await flushEngineSeries();

    expect(out.keys).toEqual([]);
    expect(out.removed).toBe(0);
    expect(out.failed.length).toBeGreaterThan(0);
    expect(out.failed[0]!.key).toContain('BTC/USDT');
  });

  it('keeps the engine series when the local store is empty', async () => {
    const out = await flushEngineSeries();
    expect(out.failed).toEqual([]);
    expect(out.keys).toEqual([]);
  });
});
