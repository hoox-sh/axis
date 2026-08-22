/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, afterEach } from 'bun:test';
import { ccxtRest } from '../src/sources/catalog';
import { _resetSourceRegistrationFlag } from '../src/sources/catalog';
import { ensureSourcesRegistered } from '../src/sources/catalog';

afterEach(() => {
  _resetSourceRegistrationFlag();
});

describe('ccxt-rest source plugin', () => {
  it('has correct metadata', () => {
    expect(ccxtRest.id).toBe('ccxt-rest');
    expect(ccxtRest.kind).toBe('source');
    expect(ccxtRest.builtIn).toBe(true);
    expect(ccxtRest.capabilities?.needsNetwork).toBe(true);
    expect(ccxtRest.capabilities?.transport).toBe('rest');
  });

  it('is registered in BUILTIN_SOURCES', () => {
    ensureSourcesRegistered();
    const { listSources } = require('../src/sources/catalog');
    const ids = listSources().map((s: { id: string }) => s.id);
    expect(ids).toContain('ccxt-rest');
  });

  it('fetchHistorical calls gatewayFetch with correct params', async () => {
    const origFetch = globalThis.fetch;
    let capturedUrl = '';
    globalThis.fetch = ((url: string | URL | Request) => {
      capturedUrl = typeof url === 'string' ? url : String(url);
      return Promise.resolve(
        new Response(
          JSON.stringify([
            { time: 1700000000, open: 100, high: 105, low: 95, close: 102, volume: 1000 },
          ]),
          { status: 200 },
        ),
      );
    }) as typeof fetch;

    try {
      const bars = await ccxtRest.fetchHistorical({
        symbol: 'BTC/USDT',
        interval: '1h',
        limit: 100,
        config: { exchange: 'bybit', gateway: 'pyne' },
      });
      expect(bars.length).toBe(1);
      expect(bars[0].open).toBe(100);
      expect(capturedUrl).toContain('/datafeed/ohlcv?');
      expect(capturedUrl).toContain('exchange=bybit');
      expect(capturedUrl).toContain('symbol=BTC%2FUSDT');
      expect(capturedUrl).toContain('timeframe=1h');
      expect(capturedUrl).toContain('limit=100');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('fetchHistorical derives since from endTime for walk-back (window ends at endTime)', async () => {
    const origFetch = globalThis.fetch;
    let capturedUrl = '';
    globalThis.fetch = ((url: string | URL | Request) => {
      capturedUrl = typeof url === 'string' ? url : String(url);
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    }) as typeof fetch;

    try {
      // No explicit limit → sourcePageLimit('ccxt-rest') = 500; 1d = 86_400_000ms
      // since = 1_700_000_000_000 − 500 × 86_400_000 = 1_656_800_000_000
      await ccxtRest.fetchHistorical({
        symbol: 'ETH/USDT',
        interval: '1d',
        endTime: 1700000000,
        config: { exchange: 'okx' },
      });
      expect(capturedUrl).toContain('since=1656800000000');

      // Explicit limit=100; 1h = 3_600_000ms
      // since = 1_700_000_000_000 − 100 × 3_600_000 = 1_699_640_000_000
      capturedUrl = '';
      await ccxtRest.fetchHistorical({
        symbol: 'ETH/USDT',
        interval: '1h',
        limit: 100,
        endTime: 1700000000,
        config: { exchange: 'okx' },
      });
      expect(capturedUrl).toContain('since=1699640000000');
      expect(capturedUrl).toContain('limit=100');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('fetchHistorical binds a vault key then passes only cred= on the OHLCV URL', async () => {
    const { putCcxtCredential, clearCredentials } = await import('../src/data/credentials');
    putCcxtCredential({ exchange: 'bybit', apiKey: 'AK-live', secret: 'SK-live' });
    const origFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : String(url);
      urls.push(u);
      if (init?.method === 'POST') return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(
        new Response(
          JSON.stringify([
            { time: 1700000000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
          ]),
          { status: 200 },
        ),
      );
    }) as typeof fetch;
    try {
      await ccxtRest.fetchHistorical({
        symbol: 'BTC/USDT',
        interval: '1h',
        limit: 10,
        config: { exchange: 'bybit', gateway: 'pyne' },
      });
      expect(urls.some((u) => u.includes('/datafeed/session'))).toBe(true);
      const ohlcv = urls.find((u) => u.includes('/ohlcv'));
      expect(ohlcv).toContain('cred=ccxt%3Abybit');
      expect(ohlcv).not.toContain('AK-live');
      expect(ohlcv).not.toContain('SK-live');
    } finally {
      globalThis.fetch = origFetch;
      clearCredentials();
    }
  });

  it('fetchHistorical throws a clear error when exchange is not configured', async () => {
    let threw = false;
    let message = '';
    try {
      await ccxtRest.fetchHistorical({
        symbol: 'ETH/USDT',
        interval: '1d',
        config: { exchange: '', gateway: 'pyne' },
      });
    } catch (e) {
      threw = true;
      message = e instanceof Error ? e.message : String(e);
    }
    expect(threw).toBe(true);
    expect(message).toMatch(/exchange id not configured/i);
  });

  it('fetchHistorical throws on non-ok response', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      return Promise.resolve(new Response('error', { status: 502 }));
    }) as unknown as typeof fetch;

    try {
      let threw = false;
      try {
        await ccxtRest.fetchHistorical({
          symbol: 'BTC/USDT',
          interval: '1h',
          config: { exchange: 'binance' },
        });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
