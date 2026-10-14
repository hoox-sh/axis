// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PYNE Pro surfaces: `/preview/chart`, `/preview/indicator`, `/backtest/quick`,
 * `/auth/usage`. Focus is the degradation contract — a Pro route the host does
 * not offer must come back as `unavailable`, never as an exception, and a key
 * is only ever sent with consent.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import {
  fetchUsage,
  renderChartPreview,
  renderIndicatorPreview,
  runQuickBacktest,
  PREVIEW_MAX_BARS,
} from '../src/engines/pro';
import { setActivePlugin, setStore } from '../src/store';

const ENDPOINT = 'http://pro.test:5002';

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

let restore: (() => void) | null = null;
let calls: Call[] = [];

function install(handler: (call: Call) => Response | Promise<Response>): void {
  restore = mockFetch(async (input, init) => {
    const url = new URL(String(input));
    const call: Call = {
      method: String(init?.method || 'GET').toUpperCase(),
      path: url.pathname,
      headers: (init?.headers as Record<string, string>) || {},
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    };
    calls.push(call);
    return handler(call);
  });
}

const closes = Array.from({ length: 20 }, (_, i) => 100 + i);

beforeEach(() => {
  calls = [];
  setStore('endpoint', ENDPOINT);
  setStore('pluginsConfig', { 'engine:server': { mode: 'auto' } });
  setActivePlugin('engine', 'server');
});

afterEach(() => {
  restore?.();
  restore = null;
});

describe('renderChartPreview', () => {
  it('posts the script + close series and returns the PNG', async () => {
    install(() => jsonResponse({ status: 'success', chart: 'AAA', meta: { bars: 20, last_value: 119 } }));
    const r = await renderChartPreview('indicator("x")\nplot(close)', closes, { color: '#2196F3' });
    expect(calls[0]!.path).toBe('/preview/chart');
    expect(calls[0]!.body?.script).toContain('indicator("x")');
    expect((calls[0]!.body!.data as { close: number[] }).close.length).toBe(20);
    expect(r.ok).toBe(true);
    expect(r.chart).toBe('AAA');
    expect(r.lastValue).toBe(119);
    expect(r.unavailable).toBe(false);
  });

  it('caps the close series at the preview budget', async () => {
    install(() => jsonResponse({ status: 'success', chart: 'AAA', meta: {} }));
    const long = Array.from({ length: PREVIEW_MAX_BARS + 50 }, (_, i) => i);
    await renderChartPreview('indicator("x")', long);
    const sent = (calls[0]!.body!.data as { close: number[] }).close;
    expect(sent.length).toBe(PREVIEW_MAX_BARS);
    expect(sent[sent.length - 1]).toBe(PREVIEW_MAX_BARS + 49);
  });

  it('reports a Pro-only route as unavailable rather than an error', async () => {
    install(() => jsonResponse({ status: 'error', message: 'pro required' }, 403));
    const r = await renderChartPreview('indicator("x")', closes);
    expect(r.ok).toBe(false);
    expect(r.unavailable).toBe(true);
  });

  it('never throws on transport failure or a non-JSON body', async () => {
    install(() => {
      throw new Error('offline');
    });
    expect((await renderChartPreview('indicator("x")', closes)).error).toBe('offline');
    restore?.();
    install(() => new Response('<html>', { status: 200 }));
    const r = await renderChartPreview('indicator("x")', closes);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('HTTP 200');
  });

  it('refuses an empty script or series without a request', async () => {
    install(() => jsonResponse({ status: 'success', chart: 'AAA' }));
    expect((await renderChartPreview('', closes)).ok).toBe(false);
    expect((await renderChartPreview('indicator("x")', [])).ok).toBe(false);
    expect(calls.length).toBe(0);
  });
});

describe('renderIndicatorPreview', () => {
  it('posts the expression and parses the response', async () => {
    install(() =>
      jsonResponse({ status: 'success', chart: 'BBB', meta: { bars: 20, last_value: 5 } }),
    );
    const r = await renderIndicatorPreview('ta.sma(close, 14)', closes);
    expect(calls[0]!.path).toBe('/preview/indicator');
    expect(calls[0]!.body?.expression).toBe('ta.sma(close, 14)');
    expect(r.ok).toBe(true);
    expect(r.chart).toBe('BBB');
  });
});

describe('runQuickBacktest', () => {
  const ohlcv = {
    open: closes.map((c) => c - 1),
    high: closes.map((c) => c + 1),
    low: closes.map((c) => c - 2),
    close: closes,
    volume: closes.map(() => 10),
  };

  it('maps the equity curve, trades and summary', async () => {
    install(() =>
      jsonResponse({
        status: 'success',
        result: {
          equity_curve: [10_000, 10_100, 10_050],
          trades: [{ side: 'long', pnl: 100 }],
          summary: { total_pnl: 100, sharpe_ratio: 1.2 },
          equity_chart: 'ZZZ',
        },
        meta: { bars: 20, initial_capital: 10_000 },
      }),
    );
    const r = await runQuickBacktest('strategy("s")', ohlcv);
    expect(calls[0]!.path).toBe('/backtest/quick');
    expect(calls[0]!.body?.initial_capital).toBe(10_000);
    expect((calls[0]!.body!.data as { close: number[] }).close.length).toBe(20);
    expect(r.ok).toBe(true);
    expect(r.equityCurve).toEqual([10_000, 10_100, 10_050]);
    expect(r.trades.length).toBe(1);
    expect(r.summary.sharpe_ratio).toBe(1.2);
    expect(r.equityChart).toBe('ZZZ');
    expect(r.initialCapital).toBe(10_000);
  });

  it('falls back to mock data when no OHLCV is available', async () => {
    install(() => jsonResponse({ status: 'success', result: { summary: {} } }));
    await runQuickBacktest('strategy("s")', {
      open: [],
      high: [],
      low: [],
      close: [],
      volume: [],
    });
    expect(calls[0]!.body?.mock_data).toBe(true);
    expect(calls[0]!.body).not.toHaveProperty('data');
  });

  it('reports a Pro-only route as unavailable', async () => {
    install(() => jsonResponse({ status: 'error' }, 404));
    const r = await runQuickBacktest('strategy("s")', ohlcv);
    expect(r.unavailable).toBe(true);
    expect(r.ok).toBe(false);
  });
});

describe('fetchUsage', () => {
  it('reads tier and call budget for the configured key', async () => {
    install(() =>
      jsonResponse({
        status: 'success',
        key_id: 'k1',
        tier: 'pro',
        usage: {
          calls_used: 42,
          calls_limit: 10_000,
          calls_remaining: 9_958,
          last_used: 1_770_000_000,
        },
      }),
    );
    setStore('pluginsConfig', { 'engine:server': { mode: 'auto', apiKey: 'pn_key' } });
    const r = await fetchUsage();
    expect(calls[0]!.path).toBe('/auth/usage');
    expect(calls[0]!.headers['X-API-Key']).toBe('pn_key');
    expect(r.ok).toBe(true);
    expect(r.tier).toBe('pro');
    expect(r.callsRemaining).toBe(9_958);
  });

  it('skips the request without a key', async () => {
    install(() => jsonResponse({ status: 'success' }));
    const r = await fetchUsage();
    expect(calls.length).toBe(0);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('No API key');
  });

  it('maps 401 to a key message and 404 to unavailable', async () => {
    setStore('pluginsConfig', { 'engine:server': { mode: 'auto', apiKey: 'pn_key' } });
    install(() => jsonResponse({ status: 'error' }, 401));
    expect((await fetchUsage()).error).toContain('not recognised');
    restore?.();
    install(() => jsonResponse({ status: 'error' }, 404));
    expect((await fetchUsage()).unavailable).toBe(true);
  });
});
