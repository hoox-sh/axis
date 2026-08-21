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
