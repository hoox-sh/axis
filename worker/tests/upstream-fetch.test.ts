/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Upstream fetch helper (`src/http.ts`) — the workerd-parity guard.
 *
 * Regression: both proxies passed `redirect: 'error'`, which undici supports but
 * **workerd rejects**. Every `/api/market/*` and `/api/onchain/*` call returned
 * 502 `UPSTREAM_NETWORK` in production while the Bun suite stayed green. These
 * cases pin the runtime-safe mode and the behaviors that replace it, so a
 * Bun-only oracle cannot hide the same class of bug again.
 */

import { describe, expect, it, afterEach, mock } from 'bun:test';
import {
  UpstreamError,
  fetchUpstreamJson,
  probeUpstream,
  upstreamDetail,
  upstreamHealth,
  upstreamReason,
  _resetUpstreamHealthForTests,
} from '../src/http';
import { handleMarket } from '../src/market';
import { handleOnchain } from '../src/onchain';
import { _resetMarketCacheForTests } from '../src/market';
import { _resetRateLimitsForTests } from '../src/rate-limit';
import type { Env } from '../src/index';

const env = {} as Env;
const origin = 'http://localhost:3000';

function req(path: string): Request {
  return new Request(`https://worker.example${path}`, { method: 'GET' });
}

afterEach(() => {
  mock.restore();
  _resetUpstreamHealthForTests();
});

describe('fetchUpstreamJson redirect handling', () => {
  it('uses a workerd-safe redirect mode, never "error"', async () => {
    let seen: RequestInit | undefined;
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      seen = init;
      return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    try {
      await fetchUpstreamJson('https://example.test/ping', { timeoutMs: 1000 });
    } finally {
      globalThis.fetch = original;
    }

    // workerd accepts only "follow" | "manual"; "error" throws at the edge.
    expect(seen?.redirect).toBe('manual');
    expect(seen?.redirect).not.toBe('error');
  });

  it('returns status + body for a normal 200', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('{"pong":true}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    try {
      const out = await fetchUpstreamJson('https://example.test/ping', { timeoutMs: 1000 });
      expect(out.status).toBe(200);
      expect(out.text).toBe('{"pong":true}');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('refuses a 3xx instead of following it', async () => {
    const original = globalThis.fetch;
    let followed = false;
    globalThis.fetch = (async () => {
      if (followed) throw new Error('redirect was followed');
      followed = true;
      return new Response(null, { status: 302, headers: { Location: 'https://evil.test/' } });
    }) as typeof fetch;
    try {
      await expect(fetchUpstreamJson('https://example.test/ping', { timeoutMs: 1000 })).rejects.toBeInstanceOf(
        UpstreamError,
      );
      expect(followed).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('refuses an opaque redirect (browser-style runtime)', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      const res = new Response(null, { status: 0 });
      Object.defineProperty(res, 'type', { value: 'opaqueredirect' });
      return res;
    }) as typeof fetch;
    try {
      await expect(fetchUpstreamJson('https://example.test/ping', { timeoutMs: 1000 })).rejects.toBeInstanceOf(
        UpstreamError,
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  it('classifies an aborted request as a timeout', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }) as typeof fetch;
    try {
      await expect(fetchUpstreamJson('https://example.test/ping', { timeoutMs: 1000 })).rejects.toBeInstanceOf(
        UpstreamError,
      );
      expect(upstreamDetail(new UpstreamError('timeout'))).toContain('timed out');
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('client-safe error text', () => {
  it('never returns raw runtime or undici messages', () => {
    const leaky = new TypeError(
      'Invalid redirect value, must be one of "follow" or "manual" ("error" won\'t be implemented since it does not make sense at the edge; use "manual" and check the response status code).',
    );
    const detail = upstreamDetail(leaky);
    expect(detail).not.toContain('redirect value');
    expect(detail).not.toContain('workerd');
    expect(detail).not.toContain('edge');
    expect(detail).toBe('upstream unreachable');
  });

  it('maps reasons to short phrases', () => {
    expect(upstreamReason(new UpstreamError('redirect'))).toBe('redirect');
    expect(upstreamReason(new UpstreamError('timeout'))).toBe('timeout');
    expect(upstreamReason('a string')).toBe('network');
  });
});

describe('proxy error envelopes stay sanitized', () => {
  it('market 502 does not echo the raw runtime message', async () => {
    _resetMarketCacheForTests();
    _resetRateLimitsForTests();
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      const err = new TypeError(
        'Invalid redirect value, must be one of "follow" or "manual" ("error" won\'t be implemented…)',
      );
      throw err;
    }) as typeof fetch;
    try {
      const res = await handleMarket(
        req('/api/market/binance/klines?symbol=BTCUSDT&interval=1h&limit=5'),
        env,
        origin,
        '/api/market/binance/klines',
      );
      expect(res?.status).toBe(502);
      const body = (await res?.json()) as { code: string; message: string };
      expect(body.code).toBe('UPSTREAM_NETWORK');
      expect(body.message).not.toContain('redirect value');
      expect(body.message).toContain('upstream unreachable');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('on-chain 502 does not echo the raw runtime message', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
    }) as typeof fetch;
    try {
      const res = await handleOnchain(
        req('/api/onchain/llama/protocols'),
        env,
        origin,
        '/api/onchain/llama/protocols',
      );
      expect(res?.status).toBe(502);
      const body = (await res?.json()) as { code: string; message: string };
      expect(body.code).toBe('UPSTREAM_NETWORK');
      expect(body.message).not.toContain('redirect value');
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('probeUpstream', () => {
  it('records a reachable upstream', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
    try {
      const r = await probeUpstream('binance', 'https://example.test/ping');
      expect(r.ok).toBe(true);
      expect(upstreamHealth()['binance']?.ok).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('records an unreachable upstream so health cannot read green', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('connection reset');
    }) as typeof fetch;
    try {
      const r = await probeUpstream('defillama', 'https://example.test/ping');
      expect(r.ok).toBe(false);
      expect(upstreamHealth()['defillama']?.ok).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('does not buffer the body (DefiLlama protocol lists are ~9 MB)', async () => {
    const original = globalThis.fetch;
    let cancelled = false;
    globalThis.fetch = (async () => {
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('x'.repeat(1024)));
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(stream, { status: 200 });
    }) as typeof fetch;
    try {
      const out = await fetchUpstreamJson('https://example.test/protocols', {
        timeoutMs: 1000,
        headOnly: true,
      });
      expect(out.status).toBe(200);
      expect(out.text).toBe('');
      expect(cancelled).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('treats a 4xx as reachable but a 5xx as down', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('nope', { status: 404 })) as typeof fetch;
    try {
      expect((await probeUpstream('binance', 'https://example.test/x')).ok).toBe(true);
      globalThis.fetch = (async () => new Response('boom', { status: 503 })) as typeof fetch;
      expect((await probeUpstream('binance', 'https://example.test/x')).ok).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });
});
