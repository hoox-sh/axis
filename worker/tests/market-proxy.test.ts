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

function req(path: string, method = 'GET', headers?: HeadersInit): Request {
  return new Request(`https://worker.example${path}`, { method, headers });
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
      signed: { binance: string[] };
    };
    expect(body.status).toBe('healthy');
    expect(body.providers.binance.paths).toContain('klines');
    expect(body.signed.binance).toContain('klines');
  });

  it('allows exchange credential headers on OPTIONS', async () => {
    const res = await handleMarket(
      req('/api/market/health', 'OPTIONS'),
      env,
      origin,
      '/api/market/health',
    );
    expect(res!.status).toBe(204);
    const allow = res!.headers.get('Access-Control-Allow-Headers') || '';
    expect(allow).toContain('X-Exchange-Key');
    expect(allow).toContain('X-Exchange-Secret');
    expect(allow).toContain('X-Exchange-Passphrase');
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

describe('handleMarket binance signed klines', () => {
  const apiKey = 'test-api-key';
  const apiSecret = 'supersecret_do_not_leak';
  const credHeaders = {
    'X-Exchange-Key': apiKey,
    'X-Exchange-Secret': apiSecret,
  };

  it('returns 401 without exchange headers', async () => {
    const res = await handleMarket(
      req('/api/market/binance/signed/klines?symbol=BTCUSDT&interval=1d'),
      env,
      origin,
      '/api/market/binance/signed/klines',
    );
    expect(res!.status).toBe(401);
    const body = (await res!.json()) as { code: string; message: string };
    expect(body.code).toBe('AUTH');
    expect(body.message).toContain('X-Exchange-Key');
    expect(JSON.stringify(body)).not.toContain(apiSecret);
  });

  it('rejects invalid symbol with 400', async () => {
    const res = await handleMarket(
      req('/api/market/binance/signed/klines?symbol=bad!&interval=1d', 'GET', credHeaders),
      env,
      origin,
      '/api/market/binance/signed/klines',
    );
    expect(res!.status).toBe(400);
    const body = (await res!.json()) as { code: string; message: string };
    expect(body.message).toBe('invalid symbol');
  });

  it('signs upstream klines and does not cache', async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = request.url;
      expect(url.startsWith('https://api.binance.com/api/v3/klines?')).toBe(true);
      expect(url).toContain('symbol=BTCUSDT');
      expect(url).toContain('timestamp=');
      expect(url).toContain('recvWindow=5000');
      expect(url).toContain('signature=');
      expect(url).not.toContain(apiSecret);
      expect(request.headers.get('X-MBX-APIKEY')).toBe(apiKey);
      return new Response(
        JSON.stringify([[1_700_000_000_000, '1', '2', '0.5', '1.5', '10']]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const path = '/api/market/binance/signed/klines?symbol=BTCUSDT&interval=1d&limit=2';
      const res = await handleMarket(req(path, 'GET', credHeaders), env, origin, '/api/market/binance/signed/klines');
      expect(res!.status).toBe(200);
      expect(res!.headers.get('X-Axis-Market-Cache')).toBe('BYPASS');
      expect(res!.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      const text = await res!.text();
      expect(text).not.toContain(apiSecret);
      expect(calls).toBe(1);

      const res2 = await handleMarket(req(path, 'GET', credHeaders), env, origin, '/api/market/binance/signed/klines');
      expect(res2!.headers.get('X-Axis-Market-Cache')).toBe('BYPASS');
      expect(calls).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
