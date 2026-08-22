/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  gatewayBase,
  gatewayFetch,
  gatewayPutSession,
  isRemotePageOrigin,
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

describe('isRemotePageOrigin', () => {
  it('loopback origins are not remote', () => {
    expect(isRemotePageOrigin('http://localhost:3000')).toBe(false);
    expect(isRemotePageOrigin('http://127.0.0.1:3000')).toBe(false);
    expect(isRemotePageOrigin(undefined)).toBe(false);
    expect(isRemotePageOrigin('not-a-url')).toBe(false);
  });

  it('non-loopback origins are remote', () => {
    expect(isRemotePageOrigin('https://axis.hoox.sh')).toBe(true);
    expect(isRemotePageOrigin('https://abc.pynescript-axis.pages.dev')).toBe(true);
  });
});

describe('gatewayBase remote-page resolution (hardened VPS)', () => {
  it('pyne on product same-origin host → same-origin /datafeed', () => {
    expect(gatewayBase('pyne', undefined, 'https://axis.hoox.sh')).toBe(
      'https://axis.hoox.sh/datafeed',
    );
  });

  it('pyne on Pages preview → product API origin cross-origin', () => {
    expect(gatewayBase('pyne', undefined, 'https://abc.pynescript-axis.pages.dev')).toBe(
      'https://axis.hoox.sh/datafeed',
    );
  });

  it('pyne on loopback page keeps loopback default', () => {
    expect(gatewayBase('pyne', undefined, 'http://localhost:3000')).toBe(
      'http://127.0.0.1:5002/datafeed',
    );
    expect(gatewayBase('pyne', undefined, undefined)).toBe('http://127.0.0.1:5002/datafeed');
  });

  it('explicit endpoint wins over remote-page resolution', () => {
    expect(gatewayBase('pyne', 'http://myhost:9999', 'https://axis.hoox.sh')).toBe(
      'http://myhost:9999/datafeed',
    );
    expect(gatewayBase('auto', 'http://myhost:9999', 'https://axis.hoox.sh')).toBe(
      'http://myhost:9999/datafeed',
    );
  });

  it('auto on remote page skips sidecar probe entirely', () => {
    expect(gatewayBase('auto', undefined, 'https://axis.hoox.sh')).toBe(
      'https://axis.hoox.sh/datafeed',
    );
  });

  it('sidecar stays loopback regardless of page origin', () => {
    expect(gatewayBase('sidecar', undefined, 'https://axis.hoox.sh')).toBe(
      `http://127.0.0.1:${DATAFEED_DEFAULT_PORT}`,
    );
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

describe('gatewayPutSession', () => {
  it('POSTs JSON to /session and never puts secrets on the URL', async () => {
    const origFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = typeof url === 'string' ? url : String(url);
      capturedInit = init;
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch;
    try {
      await gatewayPutSession('pyne', {
        exchange: 'bybit',
        credentialId: 'ccxt:bybit',
        apiKey: 'AK',
        secret: 'SK',
        password: 'pp',
      });
      expect(capturedUrl).toContain('/datafeed/session');
      expect(capturedUrl).not.toContain('AK');
      expect(capturedUrl).not.toContain('SK');
      expect(capturedInit?.method).toBe('POST');
      expect(String(capturedInit?.body)).toContain('"apiKey":"AK"');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
