/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Worker market allowlisted Binance proxy (`src/market.ts`).
 */

import { describe, expect, it, afterEach, mock } from 'bun:test';
import { handleMarket } from '../src/market';
import type { Env } from '../src/index';

const origin = 'http://localhost:3000';
const env = {} as Env;

function req(path: string, method = 'GET'): Request {
  return new Request(`https://worker.example${path}`, { method });
}

afterEach(() => {
  mock.restore();
});

describe('handleMarket routing', () => {
  it('returns null for non-market paths', async () => {
    expect(await handleMarket(req('/api/run'), env, origin, '/api/run')).toBeNull();
  });

  it('serves health', async () => {
    const res = await handleMarket(req('/api/market/health'), env, origin, '/api/market/health');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as {
      status: string;
      providers: { binance: { paths: string[] } };
    };
    expect(body.status).toBe('healthy');
    expect(body.providers.binance.paths).toContain('klines');
  });

  it('rejects non-GET', async () => {
    const res = await handleMarket(
      req('/api/market/health', 'POST'),
      env,
      origin,
      '/api/market/health',
    );
    expect(res!.status).toBe(405);
  });

  it('rejects invalid kline symbol', async () => {
    const res = await handleMarket(
      req('/api/market/binance/klines?symbol=bad!&interval=1d'),
      env,
      origin,
      '/api/market/binance/klines',
    );
    expect(res!.status).toBe(400);
  });
});

describe('handleMarket binance proxy', () => {
  it('proxies klines', async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls += 1;
      const url = String(input);
      expect(url).toMatch(/\/api\/v3\/klines\?/);
      expect(url).toContain('symbol=BTCUSDT');
      return new Response(
        JSON.stringify([[1_700_000_000_000, '1', '2', '0.5', '1.5', '10']]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const res = await handleMarket(
        req('/api/market/binance/klines?symbol=BTCUSDT&interval=1d&limit=2'),
        env,
        origin,
        '/api/market/binance/klines',
      );
      expect(res!.status).toBe(200);
      expect(res!.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      const body = (await res!.json()) as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(1);
      expect(calls).toBe(1);

      // Cache hit — no second upstream call
      const res2 = await handleMarket(
        req('/api/market/binance/klines?symbol=BTCUSDT&interval=1d&limit=2'),
        env,
        origin,
        '/api/market/binance/klines',
      );
      expect(res2!.headers.get('X-Axis-Market-Cache')).toBe('HIT');
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('proxies ticker batch', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/api/v3/ticker/24hr');
      expect(url).toContain('BTCUSDT');
      return new Response(
        JSON.stringify([{ symbol: 'BTCUSDT', lastPrice: '1', priceChangePercent: '2' }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const qs = encodeURIComponent(JSON.stringify(['BTCUSDT']));
      const res = await handleMarket(
        req(`/api/market/binance/ticker/24hr?symbols=${qs}`),
        env,
        origin,
        '/api/market/binance/ticker/24hr',
      );
      expect(res!.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
