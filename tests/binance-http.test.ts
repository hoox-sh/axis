/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, afterEach } from 'bun:test';
import {
  BINANCE_REST_HOSTS,
  _resetBinanceHttpWarnForTests,
  binanceKlineWsUrls,
  binanceTickerWsUrls,
  fetchBinanceJson,
  isPublicBinanceRestOrigin,
} from '../src/data/binance-http';
import { browserBlocksDirectCexRest } from '../src/data/worker-origin';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';

let restoreFetch: (() => void) | undefined;
const klineRow = [[1, '1', '2', '0.5', '1.5', '10']];

afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
  _resetBinanceHttpWarnForTests();
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

  it('hits Worker proxy first', async () => {
    const seen: string[] = [];
    restoreFetch = mockFetch(async (input) => {
      seen.push(String(input));
      if (String(input).includes('/api/market/binance/')) {
        return jsonResponse(klineRow);
      }
      throw new Error('should not reach direct host');
    });
    const data = await fetchBinanceJson({
      path: 'klines',
      query: 'symbol=BTCUSDT&interval=1d&limit=1',
    });
    expect(Array.isArray(data)).toBe(true);
    expect(seen[0]).toContain('/api/market/binance/klines');
    expect(seen.some((u) => u.includes('api.binance.com'))).toBe(false);
  });

  it('Worker 400 does not call api.binance.com', async () => {
    const seen: string[] = [];
    restoreFetch = mockFetch(async (input) => {
      seen.push(String(input));
      if (String(input).includes('/api/market/binance/')) {
        return jsonResponse(
          { status: 'error', code: 'UNAVAILABLE_FOR_LEGAL_REASONS', message: 'geo blocked' },
          451,
        );
      }
      return jsonResponse(klineRow);
    });
    await expect(
      fetchBinanceJson({
        path: 'klines',
        query: 'symbol=BTCUSDT&interval=1d',
      }),
    ).rejects.toThrow(/geo blocked/);
    expect(seen.some((u) => u.includes('api.binance.com'))).toBe(false);
  });

  it('Worker 5xx falls through to direct host outside a real browser', async () => {
    const seen: string[] = [];
    restoreFetch = mockFetch(async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.includes('/api/market/binance/')) {
        return jsonResponse({ status: 'error', message: 'down' }, 502);
      }
      if (url.includes('api.binance.com')) return jsonResponse(klineRow);
      throw new Error(`unexpected ${url}`);
    });
    const data = await fetchBinanceJson({
      path: 'klines',
      query: 'symbol=BTCUSDT&interval=1d&limit=1',
    });
    expect(Array.isArray(data)).toBe(true);
    expect(seen.some((u) => u.includes('/api/market/binance/'))).toBe(true);
    expect(seen.some((u) => u.includes('api.binance.com'))).toBe(true);
  });

  it('real browser does not fetch api.binance.com after Worker 5xx (CORS)', async () => {
    const prev = (globalThis as { document?: unknown }).document;
    (globalThis as { document: { nodeType: number } }).document = { nodeType: 9 };
    const seen: string[] = [];
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(String).join(' '));
    };
    restoreFetch = mockFetch(async (input) => {
      seen.push(String(input));
      if (String(input).includes('/api/market/binance/')) {
        return jsonResponse({ status: 'error', message: 'down' }, 502);
      }
      return jsonResponse(klineRow);
    });
    try {
      expect(browserBlocksDirectCexRest()).toBe(true);
      await expect(
        fetchBinanceJson({
          path: 'klines',
          query: 'symbol=BTCUSDT&interval=1d',
        }),
      ).rejects.toThrow(/Binance network error/);
      await expect(
        fetchBinanceJson({
          path: 'klines',
          query: 'symbol=BTCUSDT&interval=1d',
        }),
      ).rejects.toThrow(/Binance network error/);
    } finally {
      console.warn = origWarn;
      if (prev === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document: unknown }).document = prev;
      }
    }
    expect(seen.some((u) => u.includes('api.binance.com'))).toBe(false);
    expect(seen.every((u) => u.includes('/api/market/binance/'))).toBe(true);
    expect(warns.filter((w) => w.includes('Skipping direct api.binance.com')).length).toBe(1);
  });
});

describe('isPublicBinanceRestOrigin', () => {
  it('flags public Binance REST hosts', () => {
    expect(isPublicBinanceRestOrigin('https://api.binance.com')).toBe(true);
    expect(isPublicBinanceRestOrigin('https://data-api.binance.vision/')).toBe(true);
    expect(isPublicBinanceRestOrigin('https://fapi.binance.com')).toBe(true);
    expect(isPublicBinanceRestOrigin('https://proxy.example/binance')).toBe(false);
  });
});
