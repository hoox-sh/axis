/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Live tenant verify + usage flush (`src/tenant.ts`).
 *
 * Guards: bearer classification preserved (self-host untouched), L1/KV cache
 * hit skips fetch, hash-on-wire (never the raw key), 402 entitlement shape
 * with billing URL, usage batch cap + lossy swallow, raw keys never logged.
 */

import { describe, expect, it } from 'bun:test';
import { classifyBearerToken } from '../src/auth';
import type { Env } from '../src/index';
import {
  BILLING_UPGRADE_URL,
  USAGE_BATCH_MAX,
  clearTenantCache,
  clearUsageQueue,
  flushUsage,
  gateTenantKey,
  meterTenantUsage,
  peekUsageQueue,
  queueUsage,
  sha256Hex,
  usageQueueDepth,
  verifyCacheKey,
  verifyFailureHttp,
  verifyTenant,
  type VerifyFailure,
  type VerifyFetchFn,
} from '../src/tenant';

function kvMock(store = new Map<string, string>()) {
  return {
    store,
    async get(k: string, type?: string) {
      const v = store.get(k);
      if (v === undefined) return null;
      if (type === 'json') {
        try {
          return JSON.parse(v) as unknown;
        } catch {
          return null;
        }
      }
      return v;
    },
    async put(k: string, v: string) {
      store.set(k, v);
    },
  } as unknown as KVNamespace;
}

function envWith(opts: { console?: string; kv?: KVNamespace; apiKeys?: KVNamespace } = {}): Env {
  const env = {} as Env;
  if (opts.console !== undefined) env.CONSOLE_URL = opts.console;
  if (opts.kv !== undefined) env.TENANT_KEYS = opts.kv;
  if (opts.apiKeys !== undefined) env.API_KEYS = opts.apiKeys;
  return env;
}

function okFetch(tid = 't_1', scopes = ['axis:stream', 'axis:run']): VerifyFetchFn {
  return async () =>
    new Response(JSON.stringify({ tid, plan: 'pro', scopes, limits: null }), { status: 200 });
}

describe('bearer classification (self-host preserved)', () => {
  it('hx_live_ → tenant-passthrough, pn_ → selfhost, else none', () => {
    expect(classifyBearerToken('hx_live_abc123').kind).toBe('tenant-passthrough');
    expect(classifyBearerToken('pn_' + 'ab'.repeat(24)).kind).toBe('selfhost');
    expect(classifyBearerToken('').kind).toBe('none');
    expect(classifyBearerToken('garbage').kind).toBe('none');
  });

  it('gateTenantKey returns null for non-tenant tokens (legacy path untouched)', async () => {
    clearTenantCache();
    const pn = new Request('http://x/api/run', {
      headers: { Authorization: `Bearer pn_${'ab'.repeat(24)}` },
    });
    expect(await gateTenantKey(envWith(), pn, 'axis:run')).toBeNull();
    const bare = new Request('http://x/api/run');
    expect(await gateTenantKey(envWith(), bare, 'axis:run')).toBeNull();
  });
});

describe('verifyTenant', () => {
  it('cache hit skips fetch (L1), negative 401 cached too', async () => {
    clearTenantCache();
    clearUsageQueue();
    let calls = 0;
    const counting: VerifyFetchFn = async (url, init) => {
      calls++;
      return okFetch()(url, init);
    };
    const env = envWith({ console: 'https://console.test', kv: kvMock() });
    const first = await verifyTenant(env, 'hx_live_cache_a', 'axis:stream', { fetchFn: counting });
    expect(first.ok).toBe(true);
    expect(calls).toBe(1);
    const second = await verifyTenant(env, 'hx_live_cache_a', 'axis:stream', {
      fetchFn: async () => {
        throw new Error('must not fetch on cache hit');
      },
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.cached).toBe(true);

    // Negative: console 401 → INVALID_KEY, second call served from cache.
    let negCalls = 0;
    const neg: VerifyFetchFn = async () => {
      negCalls++;
      return new Response('nope', { status: 401 });
    };
    const bad = await verifyTenant(env, 'hx_live_cache_bad', 'axis:stream', { fetchFn: neg });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('INVALID_KEY');
    const badAgain = await verifyTenant(env, 'hx_live_cache_bad', 'axis:stream', {
      fetchFn: async () => {
        throw new Error('must not fetch on negative hit');
      },
    });
    expect(badAgain.ok).toBe(false);
    expect(negCalls).toBe(1);
  });

  it('KV L2 hit skips fetch when L1 is cold', async () => {
    clearTenantCache();
    const kv = kvMock();
    const env = envWith({ console: 'https://console.test', kv });
    const first = await verifyTenant(env, 'hx_live_kv_l2', 'axis:run', { fetchFn: okFetch() });
    expect(first.ok).toBe(true);
    clearTenantCache(); // drop L1, keep KV
    let calls = 0;
    const second = await verifyTenant(env, 'hx_live_kv_l2', 'axis:run', {
      fetchFn: async () => {
        calls++;
        throw new Error('must not fetch on KV hit');
      },
    });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.cached).toBe(true);
    expect(calls).toBe(0);
  });

  it('works without TENANT_KEYS binding (L2 skipped)', async () => {
    clearTenantCache();
    const env = envWith({ console: 'https://console.test' });
    expect(env.TENANT_KEYS).toBeUndefined();
    const r = await verifyTenant(env, 'hx_live_no_kv', 'axis:run', { fetchFn: okFetch() });
    expect(r.ok).toBe(true);
  });

  it('hash on wire: Bearer sha256hex, never the raw key; scope in query', async () => {
    clearTenantCache();
    const raw = 'hx_live_wire_secret_001';
    let seenUrl = '';
    let seenAuth = '';
    const env = envWith({ console: 'https://console.test/' });
    const r = await verifyTenant(env, raw, 'axis:run', {
      fetchFn: async (url, init) => {
        seenUrl = url;
        seenAuth = String((init?.headers as Record<string, string>)?.['Authorization'] ?? '');
        return okFetch()(url, init);
      },
    });
    expect(r.ok).toBe(true);
    const expected = await sha256Hex(raw);
    expect(seenAuth).toBe(`Bearer ${expected}`);
    expect(seenAuth).not.toContain(raw);
    expect(seenUrl).toContain('/api/v1/verify?scope=axis%3Arun');
    expect(seenUrl.startsWith('https://console.test/api/v1/verify')).toBe(true);
    if (r.ok) {
      expect(r.keyHash).toBe(expected);
      expect(r.keyHash16).toBe(expected.slice(0, 16));
      expect(verifyCacheKey(expected)).toBe(`hx:${expected.slice(0, 16)}`);
    }
  });

  it('402 shape on scope miss (200 without scope, and console 403)', async () => {
    clearTenantCache();
    const env = envWith({ console: 'https://console.test', kv: kvMock() });
    const narrow = await verifyTenant(env, 'hx_live_narrow_1', 'axis:run', {
      fetchFn: okFetch('t_n', ['axis:stream']),
    });
    expect(narrow.ok).toBe(false);
    if (!narrow.ok) {
      expect(narrow.code).toBe('ENTITLEMENT_REQUIRED');
      const http = verifyFailureHttp(narrow);
      expect(http.status).toBe(402);
      expect(http.code).toBe('ENTITLEMENT_REQUIRED');
      expect(http.message).toContain(BILLING_UPGRADE_URL);
      expect(BILLING_UPGRADE_URL).toBe('https://console.hoox.sh/billing');
    }
    const forbidden = await verifyTenant(env, 'hx_live_forbid_1', 'axis:run', {
      fetchFn: async () => new Response('scope required', { status: 403 }),
    });
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) expect(verifyFailureHttp(forbidden).status).toBe(402);
  });

  it('console 429 passes through with Retry-After', async () => {
    clearTenantCache();
    const env = envWith({ console: 'https://console.test' });
    const r = await verifyTenant(env, 'hx_live_rl_1', 'axis:run', {
      fetchFn: async () =>
        new Response('slow down', { status: 429, headers: { 'Retry-After': '7' } }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('RATE_LIMITED');
      const http = verifyFailureHttp(r as VerifyFailure);
      expect(http.status).toBe(429);
      expect(http.retryAfter).toBe(7);
    }
  });

  it('fail-closed 503 without console (unreachable + no legacy)', async () => {
    clearTenantCache();
    const r = await verifyTenant(envWith(), 'hx_live_noconsole', 'axis:stream', {
      fetchFn: async () => {
        throw new Error('must not fetch without console');
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('VERIFY_UNAVAILABLE');
      expect(verifyFailureHttp(r).status).toBe(503);
    }
    // No legacy match (API_KEYS KV bound, key unknown) → fail-closed deny.
    const gate = await gateTenantKey(envWith({ apiKeys: kvMock() }), new Request('http://x/api/stream', {
      headers: { Authorization: 'Bearer hx_live_noconsole' },
    }), 'axis:stream');
    expect(gate?.decision).toBe('deny');
    if (gate?.decision === 'deny') expect(gate.status).toBe(503);
    // Legacy match (open dev shape) → degraded allow instead.
    const openGate = await gateTenantKey(envWith(), new Request('http://x/api/stream', {
      headers: { Authorization: 'Bearer hx_live_noconsole' },
    }), 'axis:stream');
    expect(openGate?.decision).toBe('allow');
    if (openGate?.decision === 'allow') expect(openGate.degraded).toBe(true);
  });

  it('degraded allow when console is down but legacy key matches', async () => {
    clearTenantCache();
    const env = envWith({ ALLOW_OPEN_KEYS: '1' } as Env);
    const gate = await gateTenantKey(
      env,
      new Request('http://x/api/stream', {
        headers: { Authorization: 'Bearer hx_live_degraded_1' },
      }),
      'axis:stream',
    );
    expect(gate?.decision).toBe('allow');
    if (gate?.decision === 'allow') expect(gate.degraded).toBe(true);
  });

  it('empty scope fails closed without fetching', async () => {
    clearTenantCache();
    const env = envWith({ console: 'https://console.test' });
    const r = await verifyTenant(env, 'hx_live_empty_scope', '' as never, {
      fetchFn: async () => {
        throw new Error('must not fetch on empty scope');
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ENTITLEMENT_REQUIRED');
  });

  it('meterTenantUsage flushes via ctx.waitUntil; degraded gates schedule nothing', async () => {
    clearUsageQueue();
    type Ctx = NonNullable<Parameters<typeof meterTenantUsage>[4]>;
    const seen: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => {
        seen.push(p);
      },
    } as unknown as Ctx;
    meterTenantUsage(
      envWith(),
      {
        decision: 'allow', userId: 'hx:test', tid: 't_ctx',
        degraded: false, keyHash: 'h', keyHash16: 'abcd',
      },
      'axis:run',
      { runs: 1 },
      ctx,
    );
    expect(seen.length).toBe(1);
    await seen[0];
    // No CONSOLE_URL: lossy-drained, never retained.
    expect(usageQueueDepth()).toBe(0);

    const idle: Promise<unknown>[] = [];
    const idleCtx = {
      waitUntil: (p: Promise<unknown>) => {
        idle.push(p);
      },
    } as unknown as Ctx;
    meterTenantUsage(
      envWith(),
      {
        decision: 'allow', userId: 'legacy', tid: '',
        degraded: true, keyHash: '', keyHash16: '',
      },
      'axis:run',
      { runs: 1 },
      idleCtx,
    );
    expect(idle.length).toBe(0);
    expect(usageQueueDepth()).toBe(0);
  });
});

describe('usage queue + flush', () => {
  it('batch cap 50, lossy swallow on transport failure and non-2xx', async () => {
    clearUsageQueue();
    const env = envWith({ console: 'https://console.test' });
    for (let i = 0; i < 55; i++) {
      const e = queueUsage(env, { tid: 't_1', scope: 'axis:run', units: { runs: 1 }, keyHash16: 'abcd' });
      expect(e).not.toBeNull();
    }
    expect(usageQueueDepth()).toBe(55);
    const sent: number[] = [];
    const capture: VerifyFetchFn = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { events?: unknown[] };
      sent.push(body.events?.length ?? 0);
      return new Response('{}', { status: 200 });
    };
    const first = await flushUsage(env, 'hash-token', { fetchFn: capture });
    expect(first).toBe(USAGE_BATCH_MAX);
    expect(sent[0]).toBe(USAGE_BATCH_MAX);
    expect(usageQueueDepth()).toBe(5);

    // Transport failure: dropped, resolved 0, never throws.
    const dropped = await flushUsage(env, 'hash-token', {
      fetchFn: async () => {
        throw new Error('console down');
      },
    });
    expect(dropped).toBe(0);
    expect(usageQueueDepth()).toBe(0);

    // Non-2xx: same lossy behavior.
    queueUsage(env, { tid: 't_1', scope: 'axis:stream', units: { streams: 1 } });
    const rejected = await flushUsage(env, 'hash-token', {
      fetchFn: async () => new Response('{}', { status: 500 }),
    });
    expect(rejected).toBe(0);
    expect(usageQueueDepth()).toBe(0);
    expect(peekUsageQueue()).toEqual([]);
  });

  it('idem key shape day:hash16:ctr; unknown tid dropped', async () => {
    clearUsageQueue();
    const env = envWith();
    expect(queueUsage(env, { tid: '', scope: 'axis:run', units: { runs: 1 } })).toBeNull();
    expect(queueUsage(env, { tid: 'unknown', scope: 'axis:run', units: { runs: 1 } })).toBeNull();
    const e = queueUsage(env, { tid: 't_9', scope: 'axis:run', units: { runs: 1 }, keyHash16: '0123456789abcdef' });
    expect(e?.idem).toMatch(/^\d{4}-\d{2}-\d{2}:0123456789abcdef:\d+$/);
    expect(usageQueueDepth()).toBe(1);
    clearUsageQueue();
  });
});

describe('raw keys are never logged', () => {
  it('no warn output contains the raw key', async () => {
    clearTenantCache();
    clearUsageQueue();
    const raw = 'hx_live_supersecret_neverlog_zz';
    const seen: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      seen.push(args.map((a) => String(a)).join(' '));
    };
    try {
      await verifyTenant(envWith(), raw, 'axis:stream', {
        fetchFn: async () => {
          throw new Error('boom');
        },
      });
      await verifyTenant(envWith({ console: 'https://console.test' }), raw, 'axis:stream', {
        fetchFn: async () => new Response('{}', { status: 500 }),
      });
      queueUsage(envWith(), { tid: 't_1', scope: 'axis:run', units: { runs: 1 } });
      await flushUsage(envWith(), raw, {
        fetchFn: async () => {
          throw new Error('boom');
        },
      });
    } finally {
      console.warn = origWarn;
    }
    expect(seen.length).toBeGreaterThan(0);
    for (const line of seen) expect(line).not.toContain(raw);
  });
});
