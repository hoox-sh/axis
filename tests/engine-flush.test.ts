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

const { knownEngineSeriesKeys, flushEngineSeries, flushLocalAndEngine } = await import(
  '../src/data/engine-flush',
);
const { seriesKeyString } = await import('../src/engines/data-sessions');
const { putDatasetBars, _resetDatasetStoreForTests } = await import('../src/data/dataset-store');
const { _resetBarsCacheForTests } = await import('../src/data/bars-cache');
const { setStore, store } = await import('../src/store');

describe('knownEngineSeriesKeys', () => {
  beforeEach(async () => {
    _resetDatasetStoreForTests();
    await _resetBarsCacheForTests();
    setStore('symbol', '');
    setStore('interval', '');
    setStore('provider', { ...store.provider, market: 'spot', authMode: 'public' });
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
  beforeEach(async () => {
    _resetDatasetStoreForTests();
    await _resetBarsCacheForTests();
    setStore('symbol', '');
    setStore('interval', '');
    setStore('endpoint', '');
    setStore('provider', { ...store.provider, market: 'spot', authMode: 'public' });
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

  it('deletes captured engine keys before the local wipe, including cache-only series', async () => {
    const { putCachedBars, getCachedBars } = await import('../src/data/bars-cache');
    const { getDataset } = await import('../src/data/dataset-store');
    const { setEngineApiKey } = await import('../src/storage/vault');
    const { getActiveEngineId } = await import('../src/plugins/active');

    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [
      { time: 60, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);
    // In the bars cache but not the dataset mirror — the same listing IndexedDB
    // rows use (the mirror caps at 48; listCachedSeries still returns them).
    await putCachedBars('binance-rest', 'SOLUSDT', '1h', [
      { time: 60, open: 1, high: 1, low: 1, close: 2, volume: 1 },
    ]);
    setStore('symbol', 'ETHUSDT');
    setStore('interval', '1h');
    setStore('exchange', 'binance');
    setStore('provider', { ...store.provider, market: 'linear' });
    const engineId = getActiveEngineId();
    setStore('pluginsConfig', `engine:${engineId}`, {
      endpoint: 'https://engine.test',
      apiKey: 'flush-key',
    });
    setStore('endpoint', 'https://engine.test');
    setEngineApiKey(engineId, 'flush-key');

    const deleted: string[] = [];
    let presentDuringDelete = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        deleted.push(String(input));
        const still = await getDataset('binance-rest', 'BTCUSDT', '1d');
        if (still.length) presentDuringDelete += 1;
        return new Response(JSON.stringify({ removed: 1 }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    try {
      const out = await flushLocalAndEngine();
      expect(out.engine.failed).toEqual([]);
      expect(out.local).toBeGreaterThanOrEqual(2);
      expect(deleted.length).toBeGreaterThanOrEqual(3);
      expect(presentDuringDelete).toBe(deleted.length);
      expect(deleted.some((u) => u.includes('BTC') && u.includes('market=spot'))).toBe(true);
      expect(deleted.some((u) => u.includes('SOL') && u.includes('market=spot'))).toBe(true);
      expect(deleted.some((u) => u.includes('ETH') && u.includes('market=swap'))).toBe(true);
      expect(await getDataset('binance-rest', 'BTCUSDT', '1d')).toHaveLength(0);
      expect(await getCachedBars('binance-rest', 'SOLUSDT', '1h')).toHaveLength(0);
    } finally {
      globalThis.fetch = realFetch;
      setStore('provider', { ...store.provider, market: 'spot' });
      setStore('endpoint', '');
      setEngineApiKey(engineId, '');
    }
  });
});
