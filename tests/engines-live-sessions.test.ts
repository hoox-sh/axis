/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Unit: PYNE live evaluation sessions (`engines/live-sessions`).
 * create → tick → append continuity, tick-then-append order, recreate on
 * reload/expiry, negative caching for backends without session routes.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import {
  tryLiveSessionTick,
  invalidateLiveSessionsForSeries,
  noteRunMode,
  runModeAllowsSessions,
  getSessionStatus,
  refreshLiveSessionTelemetry,
  _resetLiveSessionsForTests,
  _liveSessionStateForTests,
  type LiveSessionTickOpts,
} from '../src/engines/live-sessions';
import type { Bar } from '../src/store/types';

const ENDPOINT = 'http://127.0.0.1:5002';
const SCRIPT = 'indicator("s")\nplot(close)';
const SYMBOL = 'BTCUSDT';
const INTERVAL = '1d';

function pineBars(n: number, startMs = 1_700_000_000_000, stepMs = 86_400_000): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) {
    const close = 100 + i;
    out.push({
      time: startMs + i * stepMs,
      open: close - 1,
      high: close + 1,
      low: close - 2,
      close,
      volume: 10 + i,
    });
  }
  return out;
}

function opts(bars: Bar[], script = SCRIPT): LiveSessionTickOpts {
  return {
    endpoint: ENDPOINT,
    script,
    pineBars: bars,
    symbol: SYMBOL,
    interval: INTERVAL,
  };
}

function envelope(sessionId: string, count: number, extra: Record<string, unknown> = {}) {
  return {
    status: 'success',
    session_id: sessionId,
    plots: [],
    series: {},
    plot_meta: {},
    events: [],
    drawings: [],
    alerts: [],
    inputs: [],
    count,
    mode: 'interpret',
    overlay: true,
    script_name: 'plot',
    logs: [],
    meta: {},
    ...extra,
  };
}

interface Call {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string> | null;
}

function installBackend(handlers: {
  onCreate?: (body: Record<string, unknown>) => unknown;
  onTick?: (id: string, body: Record<string, unknown>) => unknown;
  onAppend?: (id: string, body: Record<string, unknown>) => unknown;
  onDelete?: (id: string) => void;
  createStatus?: number;
  createCode?: string;
}): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  let nextId = 1;
  const counts = new Map<string, number>();
  const restore = mockFetch(async (input, init) => {
    const url = String(input);
    const path = url.slice(ENDPOINT.length);
    const method = String(init?.method || 'GET').toUpperCase();
    let body: unknown = null;
    try {
      body = init?.body ? JSON.parse(String(init.body)) : null;
    } catch {
      body = null;
    }
    const rawHeaders = init?.headers as unknown;
    const headers =
      rawHeaders && typeof rawHeaders === 'object' && !(rawHeaders instanceof Headers)
        ? (rawHeaders as Record<string, string>)
        : null;
    calls.push({ method, path, body, headers });
    if (method === 'POST' && path === '/session') {
      if (handlers.createStatus && handlers.createStatus !== 200) {
        return jsonResponse(
          { status: 'error', code: handlers.createCode || 'NOPE' },
          handlers.createStatus,
        );
      }
      const id = `s${nextId++}`;
      const data = (body as { data?: unknown[] } | null)?.data || [];
      counts.set(id, data.length);
      const payload =
        handlers.onCreate?.((body as Record<string, unknown>) || {}) ?? envelope(id, data.length);
      return jsonResponse(payload);
    }
    const tick = /^\/session\/([^/]+)\/tick$/.exec(path);
    if (method === 'POST' && tick) {
      const out = handlers.onTick?.(tick[1]!, (body as Record<string, unknown>) || {});
      if (out instanceof Response) return out;
      const payload = out ?? envelope(tick[1]!, counts.get(tick[1]!) ?? 0);
      return jsonResponse(payload);
    }
    const append = /^\/session\/([^/]+)\/append$/.exec(path);
    if (method === 'POST' && append) {
      const incoming = ((body as { bars?: unknown[] } | null)?.bars || []).length;
      counts.set(append[1]!, (counts.get(append[1]!) ?? 0) + incoming);
      const payload =
        handlers.onAppend?.(append[1]!, (body as Record<string, unknown>) || {}) ??
        envelope(append[1]!, counts.get(append[1]!) ?? 0, { appended: incoming });
      return jsonResponse(payload);
    }
    const del = /^\/session\/([^/]+)$/.exec(path);
    if (method === 'DELETE' && del) {
      handlers.onDelete?.(del[1]!);
      counts.delete(del[1]!);
      return jsonResponse({ status: 'success', session_id: del[1], released: true });
    }
    return jsonResponse({ status: 'error', code: 'NOT_FOUND' }, 404);
  });
  return { calls, restore };
}

let restore: (() => void) | null = null;

beforeEach(() => {
  _resetLiveSessionsForTests();
});

afterEach(() => {
  restore?.();
  restore = null;
  _resetLiveSessionsForTests();
});

describe('live-sessions', () => {
  it('creates a session on the first tick', async () => {
    const backend = installBackend({});
    restore = backend.restore;
    const hit = await tryLiveSessionTick(opts(pineBars(8)));
    expect(hit).not.toBeNull();
    expect(hit!.via).toBe('session-create');
    expect(hit!.sessionId).toBe('s1');
    expect(backend.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /session']);
    const createBody = backend.calls[0]!.body as Record<string, unknown>;
    expect(createBody.script).toBe(SCRIPT);
    expect((createBody.data as unknown[]).length).toBe(8);
    expect(createBody.mode).toBe('interpret');
  });

  it('re-ticks the forming bar and skips unchanged tips', async () => {
    const backend = installBackend({});
    restore = backend.restore;
    const bars = pineBars(8);
    await tryLiveSessionTick(opts(bars));
    // Same tip, revised close → tick
    const moved = bars.map((b) => ({ ...b }));
    moved[moved.length - 1] = { ...moved[moved.length - 1]!, close: 999 };
    const hit = await tryLiveSessionTick(opts(moved));
    expect(hit?.via).toBe('session-tick');
    const tickCall = backend.calls.find((c) => c.path.endsWith('/tick'))!;
    expect((tickCall.body as { bar: Bar }).bar.close).toBe(999);
    // Same tip, identical OHLCV → cached, no new fetch
    const before = backend.calls.length;
    const cached = await tryLiveSessionTick(opts(moved));
    expect(cached?.via).toBe('session-cached');
    expect(backend.calls.length).toBe(before);
  });

  it('merges delta tick tails onto the cached full result', async () => {
    const series = (n: number) => Array.from({ length: n }, (_, i) => 100 + i);
    const backend = installBackend({
      onCreate: () => envelope('s1', 8, { plots: series(8), series: { a: series(8) } }),
      onTick: (_id, body) => {
        if ((body as { delta?: boolean }).delta !== true) return undefined;
        return envelope('s1', 8, {
          plots: [108],
          series: { a: [108] },
          delta: { base_index: 7, count: 8, tail_len: 1 },
        });
      },
    });
    restore = backend.restore;
    const bars = pineBars(8);
    await tryLiveSessionTick(opts(bars));
    const moved = bars.map((b) => ({ ...b }));
    moved[moved.length - 1] = { ...moved[moved.length - 1]!, close: 999 };
    const hit = await tryLiveSessionTick(opts(moved));
    expect(hit?.via).toBe('session-tick');
    // One cell traveled; the hit carries the merged full window.
    const payload = hit?.payload as { plots: number[]; series: { a: number[] }; count: number };
    expect(payload.count).toBe(8);
    expect(payload.plots).toEqual([100, 101, 102, 103, 104, 105, 106, 108]);
    expect(payload.series.a).toEqual([100, 101, 102, 103, 104, 105, 106, 108]);
    const tickCall = backend.calls.find((c) => c.path.endsWith('/tick'))!;
    expect((tickCall.body as { delta?: boolean }).delta).toBe(true);
  });

  it('retries plain when the backend rejects the delta flag', async () => {
    const seen: unknown[] = [];
    const backend = installBackend({
      onTick: (_id, body) => {
        seen.push((body as { delta?: boolean }).delta === true);
        if ((body as { delta?: boolean }).delta === true) {
          return new Response(
            JSON.stringify({ status: 'error', code: 'UNKNOWN_FIELDS', message: 'nope' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return undefined;
      },
    });
    restore = backend.restore;
    const bars = pineBars(8);
    await tryLiveSessionTick(opts(bars));
    const moved = bars.map((b) => ({ ...b }));
    moved[moved.length - 1] = { ...moved[moved.length - 1]!, close: 999 };
    const hit = await tryLiveSessionTick(opts(moved));
    expect(hit?.via).toBe('session-tick');
    expect(seen).toEqual([true, false]);
    // Remembered: the next new tip goes plain immediately.
    const moved2 = moved.map((b) => ({ ...b }));
    moved2[moved2.length - 1] = { ...moved2[moved2.length - 1]!, close: 1000 };
    await tryLiveSessionTick(opts(moved2));
    expect(seen).toEqual([true, false, false]);
  });

  it('tick-then-appends when a bar closes (no duplication)', async () => {
    const backend = installBackend({});
    restore = backend.restore;
    const bars = pineBars(8);
    await tryLiveSessionTick(opts(bars));
    // Bar 8 closes @ 500, bar 9 forms @ 501
    const next = bars.map((b) => ({ ...b }));
    next[next.length - 1] = { ...next[next.length - 1]!, close: 500 };
    const ninth = next[next.length - 1]!.time + 86_400_000;
    next.push({ time: ninth, open: 500, high: 502, low: 499, close: 501, volume: 5 });
    const hit = await tryLiveSessionTick(opts(next));
    expect(hit?.via).toBe('session-append');
    const seq = backend.calls.map((c) => `${c.method} ${c.path}`);
    const tickIdx = seq.findIndex((s) => s.endsWith('/tick'));
    const appendIdx = seq.findIndex((s) => s.endsWith('/append'));
    expect(tickIdx).toBeGreaterThanOrEqual(0);
    expect(appendIdx).toBeGreaterThan(tickIdx);
    // Tick finalizes the closed base with its close values…
    const tickBody = backend.calls[tickIdx]!.body as { bar: Bar };
    expect(tickBody.bar.time).toBe(bars[bars.length - 1]!.time);
    expect(tickBody.bar.close).toBe(500);
    // …append carries only strictly newer bars (no duplicate of the base)
    const appendBody = backend.calls[appendIdx]!.body as { bars: Bar[] };
    expect(appendBody.bars.length).toBe(1);
    expect(appendBody.bars[0]!.time).toBe(ninth);
  });

  it('rebases when a closed bar is rewritten at a stable count', async () => {
    const deleted: string[] = [];
    const backend = installBackend({ onDelete: (id) => void deleted.push(id) });
    restore = backend.restore;
    await tryLiveSessionTick(opts(pineBars(8)));
    // Same count, same tip time — but bar 3 was revised in place (gap fill).
    const revised = pineBars(8);
    revised[3] = { ...revised[3]!, close: 12345, high: 12345 };
    const hit = await tryLiveSessionTick(opts(revised));
    expect(hit?.via).toBe('session-create');
    expect(hit?.sessionId).toBe('s2');
    expect(deleted).toContain('s1');
  });

  it('rebases when older bars are prepended', async () => {
    const deleted: string[] = [];
    const backend = installBackend({ onDelete: (id) => void deleted.push(id) });
    restore = backend.restore;
    const bars = pineBars(8);
    await tryLiveSessionTick(opts(bars));
    // One older bar appears before the session's first bar (window grew back).
    const older = { ...bars[0]!, time: bars[0]!.time - 86_400_000 };
    const grown = [older, ...bars];
    const hit = await tryLiveSessionTick(opts(grown));
    expect(hit?.via).toBe('session-create');
    expect(hit?.sessionId).toBe('s2');
    expect(deleted).toContain('s1');
  });

  it('recreates after a history reload (tip not found)', async () => {
    const deleted: string[] = [];
    const backend = installBackend({ onDelete: (id) => void deleted.push(id) });
    restore = backend.restore;
    await tryLiveSessionTick(opts(pineBars(8)));
    // Entirely different window — old tip absent
    const hit = await tryLiveSessionTick(opts(pineBars(6, 1_900_000_000_000)));
    expect(hit?.via).toBe('session-create');
    expect(hit?.sessionId).toBe('s2');
    expect(deleted).toContain('s1');
  });

  it('recreates once when the server reports NO_SESSION', async () => {
    let ticks = 0;
    const backend = installBackend({
      onTick: (id) => {
        ticks += 1;
        if (ticks === 1) return jsonResponse({ status: 'error', code: 'NO_SESSION' }, 404);
        return envelope(id, 8);
      },
    });
    restore = backend.restore;
    const bars = pineBars(8);
    await tryLiveSessionTick(opts(bars));
    const moved = bars.map((b) => ({ ...b }));
    moved[moved.length - 1] = { ...moved[moved.length - 1]!, close: 4242 };
    const hit = await tryLiveSessionTick(opts(moved));
    expect(hit?.via).toBe('session-create');
    expect(hit?.sessionId).toBe('s2');
  });

  it('falls back (null) on backends without session routes, once per endpoint', async () => {
    const backend = installBackend({ createStatus: 404, createCode: 'NOT_FOUND' });
    restore = backend.restore;
    expect(await tryLiveSessionTick(opts(pineBars(8)))).toBeNull();
    const callsAfterFirst = backend.calls.length;
    expect(await tryLiveSessionTick(opts(pineBars(8)))).toBeNull();
    // Negative cache: no second probe
    expect(backend.calls.length).toBe(callsAfterFirst);
  });

  it('backs off after SESSIONS_FULL', async () => {
    const backend = installBackend({ createStatus: 503, createCode: 'SESSIONS_FULL' });
    restore = backend.restore;
    expect(await tryLiveSessionTick(opts(pineBars(8)))).toBeNull();
    const callsAfterFirst = backend.calls.length;
    expect(await tryLiveSessionTick(opts(pineBars(8)))).toBeNull();
    expect(backend.calls.length).toBe(callsAfterFirst);
  });

  it('releases the previous instance session when its script changes', async () => {
    const deleted: string[] = [];
    const backend = installBackend({ onDelete: (id) => void deleted.push(id) });
    restore = backend.restore;
    // Same instance (ownerId) running a new revision → the old session is
    // released so it does not linger until the idle TTL.
    await tryLiveSessionTick({ ...opts(pineBars(8), SCRIPT), ownerId: 'ind-1' });
    await tryLiveSessionTick({
      ...opts(pineBars(8), 'indicator("other")\nplot(open)'),
      ownerId: 'ind-1',
    });
    expect(deleted).toContain('s1');
  });

  it('keeps one session per instance so sibling indicators do not evict', async () => {
    const deleted: string[] = [];
    const backend = installBackend({ onDelete: (id) => void deleted.push(id) });
    restore = backend.restore;
    const bars = pineBars(8);
    const a = { ...opts(bars, SCRIPT), ownerId: 'ind-a' };
    const b = { ...opts(bars, 'indicator("b")\nplot(open)'), ownerId: 'ind-b' };
    expect((await tryLiveSessionTick(a))?.via).toBe('session-create');
    expect((await tryLiveSessionTick(b))?.via).toBe('session-create');
    // Second pass over each sibling reuses its own session (no /session, no
    // DELETE) — this is what makes multi-indicator charts O(delta).
    expect((await tryLiveSessionTick(a))?.via).toBe('session-cached');
    expect((await tryLiveSessionTick(b))?.via).toBe('session-cached');
    expect(deleted).toEqual([]);
    expect(backend.calls.filter((c) => c.path === '/session').length).toBe(2);
  });

  it('treats an error body as a miss, never an empty result', async () => {
    let ticks = 0;
    const deleted: string[] = [];
    const backend = installBackend({
      onDelete: (id) => void deleted.push(id),
      onTick: () => {
        ticks += 1;
        // `/run`-shaped failures arrive as `status: 'error'`, sometimes with 200.
        return jsonResponse({ status: 'error', message: 'boom' });
      },
    });
    restore = backend.restore;
    const bars = pineBars(8);
    await tryLiveSessionTick(opts(bars));
    const moved = bars.map((b) => ({ ...b }));
    moved[moved.length - 1] = { ...moved[moved.length - 1]!, close: 4242 };
    expect(await tryLiveSessionTick(opts(moved))).toBeNull();
    expect(ticks).toBe(1);
    expect(deleted).toContain('s1');
    // An unusable answer cools the key down: no create + full eval next tick.
    const callsAfter = backend.calls.length;
    expect(await tryLiveSessionTick(opts(moved))).toBeNull();
    expect(backend.calls.length).toBe(callsAfter);
  });

  it('releases sessions with the API key so an authenticated DELETE lands', async () => {
    const deleted: string[] = [];
    const backend = installBackend({ onDelete: (id) => void deleted.push(id) });
    restore = backend.restore;
    await tryLiveSessionTick({ ...opts(pineBars(8)), apiKey: 'pn_test' });
    // Closed bar rewritten in place → rebase (release + recreate).
    const revised = pineBars(8);
    revised[2] = { ...revised[2]!, close: 777, high: 777 };
    expect((await tryLiveSessionTick({ ...opts(revised), apiKey: 'pn_test' }))?.via).toBe(
      'session-create',
    );
    expect(deleted).toContain('s1');
    const del = backend.calls.find((c) => c.method === 'DELETE')!;
    expect(del.headers?.['X-API-Key']).toBe('pn_test');
    expect(del.headers?.Authorization).toBe('Bearer pn_test');
  });

  it('cools the key down when the server disagrees about the series shape', async () => {
    const backend = installBackend({ onTick: (id) => envelope(id, 999) });
    restore = backend.restore;
    const bars = pineBars(8);
    await tryLiveSessionTick(opts(bars));
    const moved = bars.map((b) => ({ ...b }));
    moved[moved.length - 1] = { ...moved[moved.length - 1]!, close: 4242 };
    expect(await tryLiveSessionTick(opts(moved))).toBeNull();
    // Unusable shape → the next tick must not re-pay a full-window create.
    const callsAfter = backend.calls.length;
    expect(await tryLiveSessionTick(opts(moved))).toBeNull();
    expect(backend.calls.length).toBe(callsAfter);
  });

  it('only allows sessions after a run the backend resolved to interpret', () => {
    const fields = { endpoint: ENDPOINT, script: SCRIPT, mode: 'auto' };
    expect(runModeAllowsSessions(fields)).toBe(false);
    noteRunMode(fields, 'compile');
    expect(runModeAllowsSessions(fields)).toBe(false);
    noteRunMode(fields, 'interpret');
    expect(runModeAllowsSessions(fields)).toBe(true);
    // The mode *sent* is part of the key — a mode switch cannot inherit it.
    expect(runModeAllowsSessions({ ...fields, mode: 'interpret' })).toBe(false);
  });

  it('rebases a session that outgrew the chart window', async () => {
    const backend = installBackend({});
    restore = backend.restore;
    let bars = pineBars(8);
    const first = await tryLiveSessionTick(opts(bars));
    expect(first?.via).toBe('session-create');
    // Grow far past the window in batches (tick base + append tail each).
    for (let batch = 0; batch < 42; batch++) {
      const grown = bars.map((b) => ({ ...b }));
      grown[grown.length - 1] = { ...grown[grown.length - 1]!, close: 700 + batch };
      for (let k = 0; k < 50; k++) {
        const t = grown[grown.length - 1]!.time + 86_400_000;
        grown.push({ time: t, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 });
      }
      bars = grown;
      const hit = await tryLiveSessionTick(opts(bars));
      expect(hit).not.toBeNull();
    }
    // Session now holds 8 + 42*50 bars while the window is that large too…
    // shrink the window back to 8 bars with the newest tip: rebase expected.
    const rebased = bars.slice(bars.length - 8);
    const hit = await tryLiveSessionTick(opts(rebased));
    expect(hit?.via).toBe('session-create');
  });
});

describe('getSessionStatus', () => {
  let restore: (() => void) | null = null;

  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('parses the PYNE status blob', async () => {
    restore = mockFetch(() =>
      jsonResponse({
        status: 'success',
        session_id: 's7',
        bars: 123,
        idle_seconds: 1.25,
        ttl_seconds: 900,
      }),
    );
    const r = await getSessionStatus(ENDPOINT, undefined, 's7');
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.status).toEqual({
      sessionId: 's7',
      bars: 123,
      idleSeconds: 1.25,
      ttlSeconds: 900,
    });
  });

  it('reports gone on 404 and on a NO_SESSION envelope', async () => {
    restore = mockFetch(() => jsonResponse({ status: 'error', code: 'NO_SESSION' }, 404));
    expect((await getSessionStatus(ENDPOINT, undefined, 's1')).kind).toBe('gone');
    restore();
    restore = mockFetch(() =>
      jsonResponse({ status: 'error', code: 'NO_SESSION', message: 'gone' }),
    );
    expect((await getSessionStatus(ENDPOINT, undefined, 's1')).kind).toBe('gone');
  });

  it('reports unknown for transport failures and non-JSON bodies', async () => {
    restore = mockFetch(() => jsonResponse({ status: 'error' }, 500));
    expect((await getSessionStatus(ENDPOINT, undefined, 's1')).kind).toBe('unknown');
    restore();
    restore = mockFetch(() => new Response('<html>nginx</html>', { status: 200 }));
    expect((await getSessionStatus(ENDPOINT, undefined, 's1')).kind).toBe('unknown');
    restore();
    restore = mockFetch(() => {
      throw new Error('offline');
    });
    expect((await getSessionStatus(ENDPOINT, undefined, 's1')).kind).toBe('unknown');
  });

  it('is a no-op without an endpoint or session id', async () => {
    restore = mockFetch(() => {
      throw new Error('fetch must not be called');
    });
    expect((await getSessionStatus('', undefined, 's1')).kind).toBe('unknown');
    expect((await getSessionStatus(ENDPOINT, undefined, '')).kind).toBe('unknown');
  });
});

describe('idle session reconciliation', () => {
  let restore: (() => void) | null = null;

  beforeEach(() => {
    _resetLiveSessionsForTests();
  });

  afterEach(() => {
    restore?.();
    restore = null;
    _resetLiveSessionsForTests();
  });

  const keyFields = { endpoint: ENDPOINT, script: SCRIPT, symbol: SYMBOL, interval: INTERVAL };

  /** Force the session past the idle threshold so the next call reconciles. */
  function makeIdle(): void {
    const st = _liveSessionStateForTests(keyFields);
    expect(st).not.toBeNull();
    if (!st) return;
    st.lastUsedAt = 0;
    st.lastReconciledAt = 0;
  }

  it('does not reconcile a freshly used session', async () => {
    const backend = installBackend({});
    restore = backend.restore;
    const bars = pineBars(6);
    await tryLiveSessionTick(opts(bars));
    const before = backend.calls.filter((c) => c.method === 'GET').length;
    await tryLiveSessionTick(opts(bars));
    const after = backend.calls.filter((c) => c.method === 'GET').length;
    expect(after).toBe(before);
  });

  it('recreates a session the engine has reclaimed', async () => {
    const backend = installBackend({});
    restore = backend.restore;
    const bars = pineBars(6);
    await tryLiveSessionTick(opts(bars));
    makeIdle();
    // The engine no longer holds it.
    restore();
    restore = mockFetch(async (input, init) => {
      const path = String(input).slice(ENDPOINT.length);
      const method = String(init?.method || 'GET').toUpperCase();
      backend.calls.push({ method, path, body: null, headers: null });
      if (method === 'GET') return jsonResponse({ status: 'error', code: 'NO_SESSION' }, 404);
      if (method === 'POST' && path === '/session') {
        return jsonResponse(envelope('recreated', bars.length));
      }
      return jsonResponse({ status: 'error' }, 404);
    });
    const hit = await tryLiveSessionTick(opts(bars));
    expect(hit?.via).toBe('session-create');
    expect(hit?.sessionId).toBe('recreated');
  });

  it('recreates when the engine reports a different bar count', async () => {
    const backend = installBackend({});
    restore = backend.restore;
    const bars = pineBars(6);
    await tryLiveSessionTick(opts(bars));
    makeIdle();
    restore();
    restore = mockFetch(async (input, init) => {
      const path = String(input).slice(ENDPOINT.length);
      const method = String(init?.method || 'GET').toUpperCase();
      backend.calls.push({ method, path, body: null, headers: null });
      if (method === 'GET') {
        return jsonResponse({
          status: 'success',
          session_id: 's1',
          bars: 999,
          idle_seconds: 1,
          ttl_seconds: 900,
        });
      }
      if (method === 'POST' && path === '/session') {
        return jsonResponse(envelope('rebased', bars.length));
      }
      return jsonResponse({ status: 'error' }, 404);
    });
    const hit = await tryLiveSessionTick(opts(bars));
    expect(hit?.via).toBe('session-create');
    expect(hit?.sessionId).toBe('rebased');
  });

  it('keeps ticking when the engine agrees about the session', async () => {
    const backend = installBackend({});
    restore = backend.restore;
    const bars = pineBars(6);
    await tryLiveSessionTick(opts(bars));
    makeIdle();
    // Move the forming tip so the tick path runs (not the cached shortcut).
    const moved = bars.map((b) => ({ ...b }));
    moved[moved.length - 1] = { ...moved[moved.length - 1]!, close: 777 };
    const orig = backend.restore;
    restore = mockFetch(async (input, init) => {
      const path = String(input).slice(ENDPOINT.length);
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'GET') {
        return jsonResponse({
          status: 'success',
          session_id: 's1',
          bars: 6,
          idle_seconds: 21,
          ttl_seconds: 900,
        });
      }
      return jsonResponse(envelope('s1', 6));
    });
    const hit = await tryLiveSessionTick(opts(moved));
    expect(hit?.via).toBe('session-tick');
    orig();
  });
});

describe('refreshLiveSessionTelemetry', () => {
  let restore: (() => void) | null = null;
  let gets = 0;

  beforeEach(() => {
    _resetLiveSessionsForTests();
    gets = 0;
  });

  afterEach(() => {
    restore?.();
    restore = null;
    _resetLiveSessionsForTests();
  });

  const keyFields = { endpoint: ENDPOINT, script: SCRIPT, symbol: SYMBOL, interval: INTERVAL };

  function installStatusBackend(status: Record<string, unknown> | null, code = 200) {
    restore = mockFetch((input, init) => {
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'GET') {
        gets++;
        return status
          ? jsonResponse(status, code)
          : jsonResponse({ status: 'error', code: 'NO_SESSION' }, 404);
      }
      const path = String(input).slice(ENDPOINT.length);
      if (method === 'POST' && path === '/session') {
        return jsonResponse(envelope('s1', pineBars(6).length));
      }
      return jsonResponse(envelope('s1', pineBars(6).length));
    });
  }

  it('returns null when no session is cached', async () => {
    installStatusBackend({ status: 'success', session_id: 's1', bars: 6 });
    expect(await refreshLiveSessionTelemetry()).toBeNull();
    expect(gets).toBe(0);
  });

  it('fetches once, then reuses the cached status inside the throttle window', async () => {
    installStatusBackend({
      status: 'success',
      session_id: 's1',
      bars: 6,
      idle_seconds: 2,
      ttl_seconds: 900,
    });
    await tryLiveSessionTick(opts(pineBars(6)));
    const st = _liveSessionStateForTests(keyFields);
    expect(st).not.toBeNull();
    if (!st) return;
    st.lastReconciledAt = 0;
    const first = await refreshLiveSessionTelemetry();
    expect(first?.bars).toBe(6);
    expect(gets).toBe(1);
    const second = await refreshLiveSessionTelemetry();
    expect(second?.bars).toBe(6);
    expect(gets).toBe(1);
  });

  it('keeps the last known status when the engine cannot answer', async () => {
    // First a healthy status…
    installStatusBackend({
      status: 'success',
      session_id: 's1',
      bars: 6,
      idle_seconds: 2,
      ttl_seconds: 900,
    });
    await tryLiveSessionTick(opts(pineBars(6)));
    const st = _liveSessionStateForTests(keyFields);
    expect(st).not.toBeNull();
    if (!st) return;
    st.lastReconciledAt = 0;
    expect((await refreshLiveSessionTelemetry())?.bars).toBe(6);
    // …then the endpoint breaks: the stale value is better than nothing.
    restore?.();
    restore = mockFetch(() => jsonResponse({ status: 'error' }, 500));
    st.lastReconciledAt = 0;
    expect((await refreshLiveSessionTelemetry())?.bars).toBe(6);
    expect(gets).toBe(1);
  });

  it('drops a session the engine has reclaimed', async () => {
    installStatusBackend(null);
    await tryLiveSessionTick(opts(pineBars(6)));
    const st = _liveSessionStateForTests(keyFields);
    if (!st) return;
    st.lastReconciledAt = 0;
    expect(await refreshLiveSessionTelemetry()).toBeNull();
    expect(_liveSessionStateForTests(keyFields)).toBeNull();
  });
});

describe('invalidateLiveSessionsForSeries (repair hook)', () => {
  it('drops the script session and forces a recreate on the next tick', async () => {
    const deleted: string[] = [];
    const backend = installBackend({
      onDelete: (id) => {
        deleted.push(id);
      },
    });
    restore = backend.restore;
    const first = await tryLiveSessionTick(opts(pineBars(8)));
    expect(first?.sessionId).toBe('s1');
    const creates = () =>
      backend.calls.filter((c) => c.method === 'POST' && c.path === '/session').length;
    expect(creates()).toBe(1);
    // Repair keys carry the pair form (`BTC/USDT`); session keys carry the
    // caller spelling (`BTCUSDT`). The repair must still match.
    expect(invalidateLiveSessionsForSeries(ENDPOINT, 'BTC/USDT', INTERVAL)).toBe(1);
    expect(deleted).toEqual(['s1']);
    const second = await tryLiveSessionTick(opts(pineBars(8)));
    expect(second?.sessionId).toBe('s2');
    expect(creates()).toBe(2);
    // Dropping is idempotent: the recreated session drops the same way.
    expect(invalidateLiveSessionsForSeries(ENDPOINT, 'BTC/USDT', INTERVAL)).toBe(1);
    expect(deleted).toEqual(['s1', 's2']);
  });

  it('leaves other symbols, intervals and endpoints alone', async () => {
    const backend = installBackend({});
    restore = backend.restore;
    await tryLiveSessionTick(opts(pineBars(8)));
    expect(invalidateLiveSessionsForSeries(ENDPOINT, 'ETH/USDT', INTERVAL)).toBe(0);
    expect(invalidateLiveSessionsForSeries(ENDPOINT, 'BTCUSDT', '1h')).toBe(0);
    expect(invalidateLiveSessionsForSeries('http://other.test:5002', 'BTC/USDT', INTERVAL)).toBe(0);
    expect(backend.calls.filter((c) => c.method === 'POST' && c.path === '/session').length).toBe(
      1,
    );
  });
});
