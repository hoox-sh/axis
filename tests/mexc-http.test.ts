/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, afterEach } from 'bun:test';
import { MEXC_REST_HOSTS, fetchMexcJson } from '../src/data/mexc-http';
import { fetchWatchlistTickers } from '../src/data/watchlist-tickers';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';

let restoreFetch: (() => void) | undefined;

afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
});

describe('fetchMexcJson', () => {
  it('hits Worker proxy first', async () => {
    const seen: string[] = [];
    restoreFetch = mockFetch(async (input) => {
      seen.push(String(input));
      if (String(input).includes('/api/market/mexc/')) {
        return jsonResponse([[1, '1', '2', '0.5', '1.5', '10']]);
      }
      throw new Error('should not reach direct host');
    });
    const data = await fetchMexcJson({
      path: 'klines',
      query: 'symbol=BTCUSDT&interval=60m&limit=1',
    });
    expect(Array.isArray(data)).toBe(true);
    expect(seen[0]).toContain('/api/market/mexc/klines');
    expect(seen.some((u) => u.includes('api.mexc.com'))).toBe(false);
  });

  it('skipWorkerProxy goes direct', async () => {
    const seen: string[] = [];
    restoreFetch = mockFetch(async (input) => {
      seen.push(String(input));
      return jsonResponse([[1, '1', '2', '0.5', '1.5', '10']]);
    });
    await fetchMexcJson({
      path: 'klines',
      query: 'symbol=BTCUSDT&interval=60m',
      skipWorkerProxy: true,
    });
    expect(seen[0]).toContain(MEXC_REST_HOSTS[0]);
    expect(seen.every((u) => !u.includes('/api/market/mexc/'))).toBe(true);
  });

  it('abort does not try the next host', async () => {
    const ac = new AbortController();
    ac.abort();
    const seen: string[] = [];
    restoreFetch = mockFetch(async (input, init) => {
      seen.push(String(input));
      if (init?.signal?.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }
      throw new Error('should not fetch');
    });
    await expect(
      fetchMexcJson({
        path: 'klines',
        query: 'symbol=BTCUSDT&interval=60m',
        signal: ac.signal,
      }),
    ).rejects.toThrow(/Abort/);
    expect(seen.some((u) => u.includes('api.mexc.com'))).toBe(false);
  });

  it('Worker 400 does not call api.mexc.com', async () => {
    const seen: string[] = [];
    restoreFetch = mockFetch(async (input) => {
      seen.push(String(input));
      if (String(input).includes('/api/market/mexc/')) {
        return jsonResponse(
          { status: 'error', code: 'BAD_REQUEST', message: 'invalid interval' },
          400,
        );
      }
      return jsonResponse([[1, '1', '2', '0.5', '1.5', '10']]);
    });
    await expect(
      fetchMexcJson({
        path: 'klines',
        query: 'symbol=BTCUSDT&interval=1h',
      }),
    ).rejects.toThrow(/invalid interval/);
    expect(seen.some((u) => u.includes('api.mexc.com'))).toBe(false);
  });

  it('Worker 5xx falls through to direct host', async () => {
    const seen: string[] = [];
    restoreFetch = mockFetch(async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.includes('/api/market/mexc/')) {
        return jsonResponse(
          { status: 'error', code: 'UPSTREAM_NETWORK', message: 'down' },
          502,
        );
      }
      if (url.includes('api.mexc.com')) {
        return jsonResponse([[1, '1', '2', '0.5', '1.5', '10']]);
      }
      throw new Error(`unexpected ${url}`);
    });
    const data = await fetchMexcJson({
      path: 'klines',
      query: 'symbol=BTCUSDT&interval=60m',
    });
    expect(Array.isArray(data)).toBe(true);
    expect(seen.some((u) => u.includes('/api/market/mexc/'))).toBe(true);
    expect(seen.some((u) => u.includes('api.mexc.com'))).toBe(true);
  });
});

describe('fetchWatchlistTickers mexc', () => {
  it('sends symbol= for a small list', async () => {
    const seen: string[] = [];
    restoreFetch = mockFetch(async (input) => {
      seen.push(String(input));
      return jsonResponse({
        symbol: 'BTCUSDT',
        lastPrice: '1',
        priceChangePercent: '2',
        openPrice: '0.9',
      });
    });
    const next = await fetchWatchlistTickers(['BTCUSDT'], 'mexc-rest');
    expect(next.BTCUSDT?.price).toBe(1);
    expect(seen[0]).toContain('/api/market/mexc/ticker/24hr?symbol=BTCUSDT');
  });

  it('uses the full book when the list is large', async () => {
    const seen: string[] = [];
    const symbols = [
      'BTCUSDT',
      'ETHUSDT',
      'SOLUSDT',
      'XRPUSDT',
      'DOGEUSDT',
      'ADAUSDT',
      'AVAXUSDT',
      'LINKUSDT',
      'DOTUSDT',
    ];
    restoreFetch = mockFetch(async (input) => {
      seen.push(String(input));
      return jsonResponse(
        symbols.map((symbol) => ({
          symbol,
          lastPrice: '1',
          priceChangePercent: '0',
        })),
      );
    });
    const next = await fetchWatchlistTickers(symbols, 'mexc-rest');
    expect(Object.keys(next)).toHaveLength(9);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('/api/market/mexc/ticker/24hr');
    expect(seen[0]).not.toContain('symbol=');
  });
});
