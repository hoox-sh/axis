/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, afterEach } from 'bun:test';
import {
  BINANCE_REST_HOSTS,
  binanceKlineWsUrls,
  binanceTickerWsUrls,
  fetchBinanceJson,
} from '../src/data/binance-http';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';

let restoreFetch: (() => void) | undefined;

afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
});

describe('binanceKlineWsUrls', () => {
  it('rotates hosts and ports', () => {
    const urls = binanceKlineWsUrls('BTCUSDT', '1d');
    expect(urls.length).toBeGreaterThanOrEqual(3);
    expect(urls[0]).toContain('stream.binance.com:9443');
    expect(urls.some((u) => u.includes(':443') || u.endsWith('/ws/btcusdt@kline_1d'))).toBe(true);
    expect(urls.some((u) => u.includes('data-stream.binance.vision'))).toBe(true);
  });

  it('uses fstream for USDT-M and dstream for COIN-M', () => {
    expect(binanceKlineWsUrls('BTCUSDT', '1m', 'linear')[0]).toContain('fstream.binance.com');
    expect(binanceKlineWsUrls('BTCUSD_PERP', '1m', 'inverse')[0]).toContain('dstream.binance.com');
  });
});

describe('binanceTickerWsUrls', () => {
  it('builds combined stream path', () => {
    const urls = binanceTickerWsUrls(['BTCUSDT', 'ETHUSDT']);
    expect(urls[0]).toContain('btcusdt@ticker');
    expect(urls[0]).toContain('ethusdt@ticker');
  });
});

describe('fetchBinanceJson', () => {
  it('returns first successful host', async () => {
    const seen: string[] = [];
    restoreFetch = mockFetch(async (input) => {
      seen.push(String(input));
      if (String(input).includes('api.binance.com')) {
        return jsonResponse([[1, '1', '2', '0.5', '1.5', '10']]);
      }
      throw new Error('should not reach');
    });
    const data = await fetchBinanceJson({
      path: 'klines',
      query: 'symbol=BTCUSDT&interval=1d&limit=1',
      skipWorkerProxy: true,
    });
    expect(Array.isArray(data)).toBe(true);
    expect(seen[0]).toContain(BINANCE_REST_HOSTS[0]);
  });

  it('hits fapi for linear klines', async () => {
    const seen: string[] = [];
    restoreFetch = mockFetch(async (input) => {
      seen.push(String(input));
      return jsonResponse([[1, '1', '2', '0.5', '1.5', '10']]);
    });
    await fetchBinanceJson({
      path: 'klines',
      query: 'symbol=BTCUSDT&interval=1m&limit=1',
      market: 'linear',
      skipWorkerProxy: true,
      skipSigned: true,
    });
    expect(seen[0]).toContain('fapi.binance.com/fapi/v1/klines');
  });

  it('falls through hosts then fails without worker', async () => {
    restoreFetch = mockFetch(async () => {
      throw new Error('blocked');
    });
    await expect(
      fetchBinanceJson({
        path: 'klines',
        query: 'symbol=BTCUSDT&interval=1d',
        skipWorkerProxy: true,
      }),
    ).rejects.toThrow(/Binance network error/);
  });

  it('uses worker proxy after direct hosts fail', async () => {
    const seen: string[] = [];
    restoreFetch = mockFetch(async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.includes('/api/market/binance/')) {
        return jsonResponse([[1, '1', '2', '0.5', '1.5', '10']]);
      }
      throw new Error('direct blocked');
    });
    const data = await fetchBinanceJson({
      path: 'klines',
      query: 'symbol=BTCUSDT&interval=1d&limit=1',
    });
    expect(Array.isArray(data)).toBe(true);
    expect(seen.some((u) => u.includes('/api/market/binance/klines'))).toBe(true);
  });
});
