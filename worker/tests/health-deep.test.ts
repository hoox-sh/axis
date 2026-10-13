/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * `/health` plane — shallow vs deep.
 *
 * Regression: `/health` reported `market: true, onchain: true` from route
 * registration alone while every proxied call 502'd. `?deep=1` now pays for one
 * real egress probe per peer and reports a degraded status.
 */

import { describe, expect, it, afterEach, beforeEach, mock } from 'bun:test';
import worker, { type Env } from '../src/index';
import { _resetRateLimitsForTests } from '../src/rate-limit';
import { _resetUpstreamHealthForTests } from '../src/http';

const env = {
  DB: undefined,
  API_KEYS: undefined,
  MCP_BRIDGE: undefined,
} as unknown as Env;

function ctx(): ExecutionContext {
  return { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
}

function call(path: string): Promise<Response> {
  return worker.fetch(new Request(`https://worker.example${path}`), env, ctx());
}

beforeEach(() => {
  _resetRateLimitsForTests();
  _resetUpstreamHealthForTests();
});

afterEach(() => {
  mock.restore();
});

describe('/health shallow (default)', () => {
  it('stays cheap and omits the upstream block', async () => {
    let fetches = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetches += 1;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    try {
      const res = await call('/health');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        features: Record<string, boolean>;
        upstream?: unknown;
      };
      expect(body.status).toBe('healthy');
      expect(body.features.market).toBe(true);
      expect(body.features.onchain).toBe(true);
      expect(body.upstream).toBeUndefined();
      expect(fetches).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('/health?deep=1', () => {
  it('reports healthy and per-host verdicts when every peer answers', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
    try {
      const res = await call('/health?deep=1');
      const body = (await res.json()) as {
        status: string;
        features: Record<string, boolean>;
        upstream: Record<string, { ok: boolean }>;
      };
      expect(body.status).toBe('healthy');
      expect(Object.keys(body.upstream).sort()).toEqual(['binance', 'defillama', 'geckoterminal', 'mexc']);
      expect(body.features.market).toBe(true);
      expect(body.features.onchain).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('degrades and downgrades the dead plane instead of reporting green', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes('llama.fi') || url.includes('geckoterminal')) {
        throw new Error('connection reset');
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    try {
      const res = await call('/health?deep=1');
      // Still 200 — a third-party outage must not flap the uptime probe.
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        features: Record<string, boolean>;
        upstream: Record<string, { ok: boolean; detail: string }>;
      };
      expect(body.status).toBe('degraded');
      expect(body.features.onchain).toBe(false);
      expect(body.features.market).toBe(true);
      expect(body.upstream['defillama']?.ok).toBe(false);
      expect(body.upstream['geckoterminal']?.ok).toBe(false);
      expect(body.upstream['binance']?.ok).toBe(true);
      // No raw runtime text in the detail field either.
      expect(body.upstream['defillama']?.detail).not.toContain('connection reset');
    } finally {
      globalThis.fetch = original;
    }
  });
});
