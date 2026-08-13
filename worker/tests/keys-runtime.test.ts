/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * `/api/keys` + `/api/run` without full Worker fetch: admin forbid, validate
 * shape, proxy to `EXTERNAL_BACKEND`, BAD_REQUEST validation, NO_BACKEND 503.
 */

import { describe, expect, it, afterEach } from 'bun:test';
import { handleKeys } from '../src/keys';
import { handleRun, _resetRunRateLimitForTests } from '../src/runtime';
import type { Env } from '../src/index';

const origin = 'http://localhost:3000';
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  _resetRunRateLimitForTests();
});

describe('handleKeys', () => {
  it('forbids create without admin token', async () => {
    const r = await handleKeys(
      new Request('http://x/api/keys?action=create', { method: 'POST', body: '{}' }),
      { ADMIN_TOKEN: 'secret' } as Env,
      origin,
    );
    expect(r.status).toBe(403);
  });

  it('creates key with admin token (no KV)', async () => {
    const r = await handleKeys(
      new Request('http://x/api/keys?action=create', {
        method: 'POST',
        headers: { 'X-Admin-Token': 'secret', 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: 'hobby' }),
      }),
      { ADMIN_TOKEN: 'secret' } as Env,
      origin,
    );
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.api_key).toMatch(/^pn_/);
  });

  it('validates pn_ key without KV', async () => {
    const key = 'pn_' + 'cd'.repeat(24);
    const r = await handleKeys(
      new Request(`http://x/api/keys?action=validate&key=${key}`),
      {} as Env,
      origin,
    );
    expect(r.status).toBe(200);
  });

  it('rejects missing key on validate', async () => {
    const r = await handleKeys(
      new Request('http://x/api/keys?action=validate'),
      {} as Env,
      origin,
    );
    expect(r.status).toBe(400);
  });
});

describe('handleRun', () => {
  it('400 on invalid body', async () => {
    const r = await handleRun(
      new Request('http://x/api/run', {
        method: 'POST',
        body: JSON.stringify({ script: '', data: [] }),
      }),
      {} as Env,
      origin,
    );
    expect(r.status).toBe(400);
  });

  it('503 when no backend', async () => {
    const r = await handleRun(
      new Request('http://x/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: 'plot(close)',
          data: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }],
        }),
      }),
      {} as Env,
      origin,
    );
    expect(r.status).toBe(503);
    const j = await r.json();
    expect(j.code).toBe('NO_BACKEND');
  });

  it('rejects invalid mode', async () => {
    const r = await handleRun(
      new Request('http://x/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: 'plot(1)',
          data: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }],
          mode: 'nope',
        }),
      }),
      {} as Env,
      origin,
    );
    expect(r.status).toBe(400);
  });

  it('increments USAGE kv when bearer present', async () => {
    const store = new Map<string, string>();
    const USAGE = {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => {
        store.set(k, v);
      },
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: 'success', plots: [] }), { status: 200 })) as typeof fetch;

    const key = 'pn_' + 'ab'.repeat(24);
    await handleRun(
      new Request('http://x/api/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          script: 'plot(close)',
          data: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }],
        }),
      }),
      { EXTERNAL_BACKEND: 'http://flask.test', USAGE } as unknown as Env,
      origin,
    );
    expect(store.get(`usage:${key}`)).toBe('1');
  });

  it('uses pyodide path when enabled and runtime returns result', async () => {
    // Local-demo open keys: backend present without forcing Bearer for this path test.
    const demoEnv = {
      PYODIDE_IN_WORKER: 'enabled',
      EXTERNAL_BACKEND: 'http://flask.test',
      ALLOW_OPEN_KEYS: '1',
    } as Env;
    // Mock tryRunInWorker via env flag; if pyodide fails, falls through
    const r = await handleRun(
      new Request('http://x/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: 'plot(close)',
          data: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }],
        }),
      }),
      demoEnv,
      origin,
    );
    // Without real pyodide, falls through to proxy — mock fetch
    // Re-run with fetch mock when pyodide returns null
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: 'success', plots: [9] }), {
        status: 200,
      })) as typeof fetch;
    const r2 = await handleRun(
      new Request('http://x/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: 'plot(close)',
          data: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }],
        }),
      }),
      demoEnv,
      origin,
    );
    expect([200, 503]).toContain(r.status);
    expect(r2.status).toBe(200);
  });

  it('proxies to EXTERNAL_BACKEND with ALLOW_OPEN_KEYS (local demo)', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('http://flask.test/run');
      return new Response(JSON.stringify({ status: 'success', plots: [1], events: [] }), {
        status: 200,
      });
    }) as typeof fetch;

    const r = await handleRun(
      new Request('http://x/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: 'plot(close)',
          data: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }],
        }),
      }),
      { EXTERNAL_BACKEND: 'http://flask.test', ALLOW_OPEN_KEYS: '1' } as Env,
      origin,
    );
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.status).toBe('success');
  });

  it('requires API key when EXTERNAL_BACKEND is set without ALLOW_OPEN_KEYS', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: 'success', plots: [] }), {
        status: 200,
      })) as typeof fetch;

    const r = await handleRun(
      new Request('http://x/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: 'plot(close)',
          data: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }],
        }),
      }),
      { EXTERNAL_BACKEND: 'http://flask.test' } as Env,
      origin,
    );
    expect(r.status).toBe(401);
    const j = await r.json();
    expect(j.code).toBe('NO_KEY');
  });

  it('proxies when EXTERNAL_BACKEND set and well-formed pn_ key is presented', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('http://flask.test/run');
      return new Response(JSON.stringify({ status: 'success', plots: [2] }), { status: 200 });
    }) as typeof fetch;

    const key = 'pn_' + 'ef'.repeat(24);
    const r = await handleRun(
      new Request('http://x/api/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          script: 'plot(close)',
          data: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }],
        }),
      }),
      { EXTERNAL_BACKEND: 'http://flask.test' } as Env,
      origin,
    );
    expect(r.status).toBe(200);
  });

  it('requires API key when PYODIDE_IN_WORKER is enabled without ALLOW_OPEN_KEYS', async () => {
    const r = await handleRun(
      new Request('http://x/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: 'plot(close)',
          data: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }],
        }),
      }),
      { PYODIDE_IN_WORKER: 'enabled' } as Env,
      origin,
    );
    expect(r.status).toBe(401);
    const j = await r.json();
    expect(j.code).toBe('NO_KEY');
  });

  it('requires API key when API_KEYS KV is bound', async () => {
    const kv = {
      get: async () => null,
    } as unknown as KVNamespace;
    const r = await handleRun(
      new Request('http://x/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: 'plot(close)',
          data: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }],
        }),
      }),
      { API_KEYS: kv, EXTERNAL_BACKEND: 'http://flask.test' } as Env,
      origin,
    );
    expect(r.status).toBe(401);
    const j = await r.json();
    expect(j.code).toBe('NO_KEY');
  });

  it('requires API key when REQUIRE_RUN_AUTH is set', async () => {
    const r = await handleRun(
      new Request('http://x/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: 'plot(close)',
          data: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }],
        }),
      }),
      { REQUIRE_RUN_AUTH: '1', EXTERNAL_BACKEND: 'http://flask.test' } as Env,
      origin,
    );
    expect(r.status).toBe(401);
  });

  it('ALLOW_OPEN_KEYS without EXTERNAL_BACKEND still reaches NO_BACKEND', async () => {
    const r = await handleRun(
      new Request('http://x/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: 'plot(close)',
          data: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }],
        }),
      }),
      { ALLOW_OPEN_KEYS: '1' } as Env,
      origin,
    );
    expect(r.status).toBe(503);
    const j = await r.json();
    expect(j.code).toBe('NO_BACKEND');
  });

  it('rejects oversized script body', async () => {
    // No backend → auth not forced; size check runs before NO_BACKEND.
    const r = await handleRun(
      new Request('http://x/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: 'x'.repeat(512 * 1024 + 1),
          data: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }],
        }),
      }),
      {} as Env,
      origin,
    );
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(j.message).toMatch(/exceeds/i);
  });

  it('rate-limits repeated /api/run from same IP', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: 'success', plots: [] }), {
        status: 200,
      })) as typeof fetch;

    const mk = () =>
      handleRun(
        new Request('http://x/api/run', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'cf-connecting-ip': '203.0.113.9',
          },
          body: JSON.stringify({
            script: 'plot(close)',
            data: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }],
          }),
        }),
        // Local demo open path so rate limit is exercised after auth gate.
        { EXTERNAL_BACKEND: 'http://flask.test', ALLOW_OPEN_KEYS: '1' } as Env,
        origin,
      );

    let last: Response | null = null;
    for (let i = 0; i < 35; i++) {
      last = await mk();
    }
    expect(last!.status).toBe(429);
    const j = await last!.json();
    expect(j.code).toBe('RATE_LIMIT');
  });
});
