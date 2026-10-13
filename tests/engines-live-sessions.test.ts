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
  _resetLiveSessionsForTests,
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
    calls.push({ method, path, body });
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
        handlers.onCreate?.((body as Record<string, unknown>) || {}) ??
        envelope(id, data.length);
      return jsonResponse(payload);
    }
    const tick = /^\/session\/([^/]+)\/tick$/.exec(path);
    if (method === 'POST' && tick) {
      const out = handlers.onTick?.(tick[1]!, (body as Record<string, unknown>) || {});
      if (out instanceof Response) return out;
      const payload =
        out ?? envelope(tick[1]!, counts.get(tick[1]!) ?? 0);
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
    expect(backend.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /session',
    ]);
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
        if (ticks === 1)
          return jsonResponse({ status: 'error', code: 'NO_SESSION' }, 404);
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

  it('releases the previous script session when the script changes', async () => {
    const deleted: string[] = [];
    const backend = installBackend({ onDelete: (id) => void deleted.push(id) });
    restore = backend.restore;
    await tryLiveSessionTick(opts(pineBars(8), SCRIPT));
    await tryLiveSessionTick(opts(pineBars(8), 'indicator("other")\nplot(open)'));
    expect(deleted).toContain('s1');
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
