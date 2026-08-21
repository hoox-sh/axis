/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  gatewayBase,
  gatewayFetch,
  probeSidecar,
  DATAFEED_DEFAULT_PORT,
  type GatewayMode,
} from '../src/data/gateway';

describe('gatewayBase', () => {
  it('returns null for direct mode', () => {
    expect(gatewayBase('direct')).toBeNull();
  });

  it('builds pyne URL from default endpoint', () => {
    const base = gatewayBase('pyne');
    expect(base).toBe('http://127.0.0.1:5002/datafeed');
  });

  it('builds pyne URL from custom endpoint', () => {
    const base = gatewayBase('pyne', 'http://myhost:9999');
    expect(base).toBe('http://myhost:9999/datafeed');
  });

  it('builds sidecar URL', () => {
    const base = gatewayBase('sidecar');
    expect(base).toBe(`http://127.0.0.1:${DATAFEED_DEFAULT_PORT}`);
  });

  it('auto falls back to pyne when sidecar not probed', () => {
    const base = gatewayBase('auto');
    expect(base).toBe('http://127.0.0.1:5002/datafeed');
  });
});

describe('gatewayFetch', () => {
  it('throws for direct mode', async () => {
    let threw = false;
    try {
      await gatewayFetch('direct', '/ohlcv');
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('builds correct URL with params', async () => {
    // Mock global fetch
    const origFetch = globalThis.fetch;
    let capturedUrl = '';
    globalThis.fetch = ((url: string | URL | Request) => {
      capturedUrl = typeof url === 'string' ? url : String(url);
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    }) as typeof fetch;

    try {
      const res = await gatewayFetch('pyne', '/ohlcv', {
        exchange: 'binance',
        symbol: 'BTC/USDT',
      });
      expect(res.ok).toBe(true);
      expect(capturedUrl).toContain('/datafeed/ohlcv?');
      expect(capturedUrl).toContain('exchange=binance');
      expect(capturedUrl).toContain('symbol=BTC%2FUSDT');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
