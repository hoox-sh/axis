/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import {
  gatewayBase,
  gatewayDeleteSession,
  gatewayFetch,
  gatewayPutSession,
  gatewayWs,
  isRemotePageOrigin,
  probeSidecar,
  DATAFEED_DEFAULT_PORT,
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
    expect(gatewayBase('pyne', undefined, 'https://pynescript.online')).toBe(
      'https://pynescript.online/datafeed',
    );
  });

  it('pyne on Pages preview → product API origin cross-origin', () => {
    expect(gatewayBase('pyne', undefined, 'https://abc.pynescript-axis.pages.dev')).toBe(
      'https://pynescript.online/datafeed',
    );
  });

  it('pyne on CF Pages PWA host → product API origin cross-origin', () => {
    expect(gatewayBase('pyne', undefined, 'https://axis.hoox.sh')).toBe(
      'https://pynescript.online/datafeed',
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
      'https://pynescript.online/datafeed',
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

  it('throws for direct mode', async () => {
    let threw = false;
    try {
      await gatewayPutSession('direct', {
        exchange: 'binance',
        credentialId: 'x',
        apiKey: 'k',
        secret: 's',
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('throws on non-ok session status', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = ((..._args: unknown[]) =>
      Promise.resolve(new Response('nope', { status: 500 }))) as unknown as typeof fetch;
    try {
      let threw = false;
      try {
        await gatewayPutSession('pyne', {
          exchange: 'binance',
          credentialId: 'x',
          apiKey: 'k',
          secret: 's',
        });
      } catch (e) {
        threw = true;
        expect(String(e)).toContain('500');
      }
      expect(threw).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('accepts ok JSON responses', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = ((..._args: unknown[]) =>
      Promise.resolve(new Response('{}', { status: 200 }))) as unknown as typeof fetch;
    try {
      await gatewayPutSession('pyne', {
        exchange: 'binance',
        credentialId: 'x',
        apiKey: 'k',
        secret: 's',
      });
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe('gatewayBase edge cases', () => {
  it('strips www and matches subdomains of product hosts', () => {
    expect(gatewayBase('pyne', undefined, 'https://www.pynescript.online/x')).toBe(
      'https://www.pynescript.online/datafeed',
    );
    expect(gatewayBase('pyne', undefined, 'https://api.pynescript.online')).toBe(
      'https://api.pynescript.online/datafeed',
    );
    expect(gatewayBase('pyne', undefined, 'https://server1.pynescript.online')).toBe(
      'https://server1.pynescript.online/datafeed',
    );
  });

  it('falls back to product origin for invalid page origins', () => {
    // invalid URL → not remote → loopback default
    expect(gatewayBase('pyne', undefined, 'not-a-url')).toBe(
      'http://127.0.0.1:5002/datafeed',
    );
    // auto with explicit endpoint on invalid origin
    expect(gatewayBase('auto', 'http://h:1', 'not-a-url')).toBe('http://h:1/datafeed');
  });

  it('auto resolves explicit endpoint on remote pages', () => {
    expect(gatewayBase('auto', 'http://h:1', 'https://axis.hoox.sh')).toBe(
      'http://h:1/datafeed',
    );
    expect(gatewayBase('auto', undefined, 'not-a-url')).toBe(
      'http://127.0.0.1:5002/datafeed',
    );
  });

  it('isRemotePageOrigin covers ipv6 loopbacks and empty', () => {
    expect(isRemotePageOrigin('http://[::1]:3000')).toBe(false);
    expect(isRemotePageOrigin('http://[::1]')).toBe(false);
    expect(isRemotePageOrigin('')).toBe(false);
    expect(isRemotePageOrigin(null)).toBe(false);
  });
});

describe('probeSidecar', () => {
  it('returns true on ok, caches, and false on network failure', async () => {
    const origFetch = globalThis.fetch;
    const origNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    let calls = 0;
    try {
      globalThis.fetch = ((..._args: unknown[]) => {
        calls += 1;
        return Promise.resolve(new Response('ok', { status: 200 }));
      }) as unknown as typeof fetch;
      expect(await probeSidecar(59991)).toBe(true);
      expect(calls).toBe(1);
      // cached within TTL — no second fetch
      expect(await probeSidecar(59991)).toBe(true);
      expect(calls).toBe(1);
      // expire TTL, then fail
      now += 31_000;
      globalThis.fetch = ((..._args: unknown[]) =>
        Promise.reject(new Error('down'))) as unknown as typeof fetch;
      expect(await probeSidecar(59991)).toBe(false);
      expect(calls).toBe(1);
      // non-ok response maps to false
      now += 31_000;
      globalThis.fetch = ((..._args: unknown[]) =>
        Promise.resolve(new Response('x', { status: 500 }))) as unknown as typeof fetch;
      expect(await probeSidecar(59992)).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
      Date.now = origNow;
    }
  });
});

describe('gatewayDeleteSession', () => {
  it('no-ops for direct mode', async () => {
    await gatewayDeleteSession('direct', 'ccxt:binance');
  });

  it('sends cred + exchange params and swallows fetch errors', async () => {
    const origFetch = globalThis.fetch;
    let captured = '';
    globalThis.fetch = ((url: string | URL | Request) => {
      captured = String(url);
      return Promise.reject(new Error('down'));
    }) as typeof fetch;
    try {
      await gatewayDeleteSession('pyne', 'ccxt:binance');
      expect(captured).toContain('/datafeed/session');
      expect(captured).toContain('cred=');
      expect(captured).toContain('exchange=binance');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('keeps plain cred ids as exchange', async () => {
    const origFetch = globalThis.fetch;
    let captured = '';
    globalThis.fetch = ((url: string | URL | Request) => {
      captured = String(url);
      return Promise.resolve(new Response('ok', { status: 200 }));
    }) as typeof fetch;
    try {
      await gatewayDeleteSession('pyne', 'bybit');
      expect(captured).toContain('exchange=bybit');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe('gatewayWs', () => {
  it('throws for direct mode', () => {
    expect(() => gatewayWs('direct', '/ws')).toThrow();
  });

  it('opens ws:// for http bases and wss:// for https bases', () => {
    const origWs = (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
    const seen: string[] = [];
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = class {
      constructor(url: string) {
        seen.push(url);
      }
    };
    try {
      gatewayWs('pyne', '/ws', undefined, 'http://localhost:3000');
      expect(seen[0]).toContain('ws://127.0.0.1:5002/datafeed/ws');
      gatewayWs('pyne', '/ws', undefined, 'https://axis.hoox.sh');
      expect(seen[1]).toContain('wss://pynescript.online/datafeed/ws');
    } finally {
      (globalThis as unknown as { WebSocket?: unknown }).WebSocket = origWs;
    }
  });
});
