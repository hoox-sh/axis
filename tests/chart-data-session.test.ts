// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Chart-level engine-owned data session: creation, ticking, identity
 * mismatch handling, and release. The multiplex uses this to advance the
 * engine's store and keep the chart aligned with indicator evaluation.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import {
  ensureChartDataSession,
  tickChartDataSession,
  releaseChartDataSession,
  _resetChartDataSessionForTests,
} from '../src/engines/chart-data-session';

const ENDPOINT = 'http://pro.test';
const KEY = { exchange: 'binance', symbol: 'BTC/USDT', interval: '1h' };

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

function recorder(
  respond: (call: Call) => Response | Promise<Response>,
): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const restore = mockFetch(async (input, init) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    };
    calls.push(call);
    return respond(call);
  });
  return { calls, restore };
}

let restore: (() => void) | null = null;

beforeEach(() => {
  _resetChartDataSessionForTests();
});

afterEach(() => {
  restore?.();
  restore = null;
  _resetChartDataSessionForTests();
});

describe('ensureChartDataSession', () => {
  it('creates a session bound to the series and reuses it', async () => {
    let creates = 0;
    const rec = recorder((c) => {
      if (c.path === '/data/session') {
        creates++;
        return jsonResponse({ status: 'success', session_id: 'chart1', cache: 'hit' });
      }
      return jsonResponse({ status: 'success', added: 0, fetched: 0, count: 0 });
    });
    restore = rec.restore;

    const id1 = await ensureChartDataSession(ENDPOINT, '', KEY);
    const id2 = await ensureChartDataSession(ENDPOINT, '', KEY);
    expect(id1).toBe('chart1');
    expect(id2).toBe('chart1');
    expect(creates).toBe(1);
    const body = rec.calls[0]?.body;
    expect(body).toMatchObject({ exchange: 'binance', symbol: 'BTC/USDT', interval: '1h' });
    // The chart session script is a minimal indicator, never a user script.
    expect(String(body?.script)).toContain('indicator');
  });

  it('recreates when the identity changes', async () => {
    let n = 0;
    const rec = recorder((c) => {
      if (c.path === '/data/session') {
        n++;
        return jsonResponse({ status: 'success', session_id: `s${n}` });
      }
      return jsonResponse({ status: 'success' });
    });
    restore = rec.restore;

    await ensureChartDataSession(ENDPOINT, '', KEY);
    await ensureChartDataSession(ENDPOINT, '', { ...KEY, interval: '4h' });
    expect(n).toBe(2);
  });

  it('returns null when the engine cannot provide the series', async () => {
    restore = recorder(() => jsonResponse({ status: 'error', message: 'down' }, 502)).restore;
    const id = await ensureChartDataSession(ENDPOINT, '', KEY);
    expect(id).toBeNull();
  });
});

describe('tickChartDataSession', () => {
  it('ticks the chart session with identity only', async () => {
    const rec = recorder((c) => {
      if (c.path === '/data/session') {
        return jsonResponse({ status: 'success', session_id: 'chart1' });
      }
      return jsonResponse({ status: 'success', session_id: 'chart1', appended: 1 });
    });
    restore = rec.restore;

    const r = await tickChartDataSession(ENDPOINT, '', KEY);
    expect(r.ok).toBe(true);
    const tick = rec.calls.find((c) => c.path.endsWith('/tick'));
    expect(tick?.body).toEqual({ exchange: 'binance', symbol: 'BTC/USDT' });
  });

  it('drops an expired session so the next call recreates it', async () => {
    let creates = 0;
    const rec = recorder((c) => {
      if (c.path === '/data/session') {
        creates++;
        return jsonResponse({ status: 'success', session_id: `chart${creates}` });
      }
      return jsonResponse({ status: 'error', code: 'NO_SESSION', message: 'gone' }, 404);
    });
    restore = rec.restore;

    const first = await tickChartDataSession(ENDPOINT, '', KEY);
    expect(first.ok).toBe(false);
    const second = await tickChartDataSession(ENDPOINT, '', KEY);
    expect(second.ok).toBe(false);
    expect(creates).toBe(2); // recreated after the 404
  });

  it('drops a session bound to a different series key so the next tick recreates it', async () => {
    let creates = 0;
    const rec = recorder((c) => {
      if (c.path === '/data/session' && !c.path.includes('/tick')) {
        creates++;
        return jsonResponse({ status: 'success', session_id: `chart${creates}` });
      }
      if (String(c.path).endsWith('/tick')) {
        return jsonResponse({ status: 'error', code: 'SESSION_KEY_MISMATCH', message: 'key' }, 409);
      }
      return jsonResponse({ status: 'success' });
    });
    restore = rec.restore;

    const first = await tickChartDataSession(ENDPOINT, '', KEY);
    expect(first.ok).toBe(false);
    const second = await tickChartDataSession(ENDPOINT, '', KEY);
    expect(second.ok).toBe(false);
    expect(creates).toBe(2);
  });
});

describe('releaseChartDataSession', () => {
  it('releases the engine session on the best-effort DELETE route', async () => {
    const rec = recorder((c) => {
      if (c.path === '/data/session') {
        return jsonResponse({ status: 'success', session_id: 'chart1' });
      }
      return jsonResponse({ status: 'success' });
    });
    restore = rec.restore;

    await ensureChartDataSession(ENDPOINT, '', KEY);
    releaseChartDataSession();
    await new Promise((r) => setTimeout(r, 10));
    expect(rec.calls.some((c) => c.method === 'DELETE' && c.path === '/session/chart1')).toBe(true);
    expect(rec.calls.some((c) => c.path === '/data/session')).toBe(true);
  });
});
