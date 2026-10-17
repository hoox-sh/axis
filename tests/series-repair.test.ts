/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Stale-engine-series glue: the shared classifier the two engine-owned paint
 * paths consult (`engineSeriesStale`) and the notice + repair entry point
 * (`noteStaleEngineSeries`) — throttled log, plane/feed telemetry, and the
 * broker repair call.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import {
  ENGINE_STALE_LOG_MIN_MS,
  _resetEngineStaleNoticeForTests,
  engineSeriesStale,
  noteStaleEngineSeries,
} from '../src/engines/series-repair';
import {
  _resetDataSessionMemo,
  _resetSeriesRepairCooldownForTests,
} from '../src/engines/data-sessions';
import { clearLogs, setStore, store } from '../src/store';
import type { Bar } from '../src/store/types';

const HOUR = 3600;
const b = (time: number): Bar => ({
  time,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 10,
});
const barsEnding = (end: number, count = 5): Bar[] =>
  Array.from({ length: count }, (_, i) => b(end - (count - 1 - i) * HOUR));

let restoreFetch: (() => void) | null = null;

beforeEach(() => {
  _resetEngineStaleNoticeForTests();
  _resetSeriesRepairCooldownForTests();
  _resetDataSessionMemo();
  clearLogs();
  setStore('source', 'binance-rest');
  setStore('symbol', 'BTCUSDT');
  setStore('interval', '1h');
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
});

describe('engineSeriesStale', () => {
  const chart = barsEnding(1_800_000_000);

  it('is quiet for an aligned / deeper engine window', () => {
    expect(
      engineSeriesStale({ chartBars: chart, engineBars: barsEnding(1_800_000_000), interval: '1h' }),
    ).toBeNull();
    // A one-slot lag is normal (forming bar / trigger jitter).
    expect(
      engineSeriesStale({
        chartBars: chart,
        engineBars: barsEnding(1_800_000_000 - HOUR),
        interval: '1h',
      }),
    ).toBeNull();
    // An engine window ahead of the chart is not stale either.
    expect(
      engineSeriesStale({
        chartBars: chart,
        engineBars: barsEnding(1_800_000_000 + HOUR),
        interval: '1h',
      }),
    ).toBeNull();
    expect(engineSeriesStale({ chartBars: [], engineBars: [], interval: '1h' })).toBeNull();
  });

  it('reports the engine window behind the chart tail', () => {
    const reason = engineSeriesStale({
      chartBars: chart,
      engineBars: barsEnding(1_800_000_000 - 10 * HOUR),
      interval: '1h',
    });
    expect(reason).toBe('behind the chart tail by 10 bars');
  });

  it('reports the engine window behind a supplied venue clock', () => {
    const reason = engineSeriesStale({
      chartBars: chart,
      engineBars: barsEnding(1_800_000_000),
      interval: '1h',
      marketNow: 1_800_000_000 + 6 * HOUR,
    });
    expect(reason).toBe('behind the market by 6 bars');
  });

  it('skips the market-clock test when it is unknown (session venues)', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const lastClose = barsEnding(nowSec - 4 * 24 * HOUR);
    // A weekend's worth of "lag" is normal for a session venue…
    expect(engineSeriesStale({ chartBars: lastClose, engineBars: lastClose, interval: '1h' })).toBeNull();
    // …but a venue trigger clock still exposes a frozen series.
    expect(
      engineSeriesStale({
        chartBars: lastClose,
        engineBars: lastClose,
        interval: '1h',
        marketNow: nowSec,
      }),
    ).not.toBeNull();
  });
});

describe('noteStaleEngineSeries', () => {
  const notice = () => ({
    exchange: 'binance',
    symbol: 'BTCUSDT',
    interval: '1h',
    engineNewest: 1_700_000_000,
    reason: 'behind the chart tail by 10 bars',
    repair: {
      endpoint: 'http://pro.test',
      apiKey: '',
      key: { exchange: 'binance', market: 'spot', symbol: 'BTCUSDT', interval: '1h' },
      historyBars: 5,
    },
  });

  it('logs, marks the planes degraded, and repairs in the background', async () => {
    const calls: string[] = [];
    restoreFetch = mockFetch(async (input, init) => {
      const url = new URL(String(input));
      const method = String(init?.method || 'GET').toUpperCase();
      calls.push(`${method} ${url.pathname}`);
      if (url.pathname === '/data/series') {
        return jsonResponse({ status: 'success', count: 100, newest: 1, updated_at: 1 });
      }
      return jsonResponse({ status: 'success', fetched: 10, count: 110 });
    });

    noteStaleEngineSeries(notice());

    const warn = store.logs.find((l) => l.level === 'warn' && /Engine series stale/.test(l.message));
    expect(warn).toBeTruthy();
    expect(warn?.message).toContain('behind the chart tail by 10 bars');
    expect(store.telemetry?.engine?.state).toBe('degraded');
    expect(store.live.feeds['binance|spot|BTC/USDT|1h']?.status).toBe('degraded');

    // The broker repair runs async (status read → engine fetch).
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline && !calls.includes('POST /data/series/fetch')) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(calls).toContain('GET /data/series');
    expect(calls).toContain('POST /data/series/fetch');
  });

  it('throttles repeat notices and marks the series live again after a repair', async () => {
    restoreFetch = mockFetch((input) => {
      const url = new URL(String(input));
      if (url.pathname === '/data/series') {
        return jsonResponse({ status: 'success', count: 100, newest: 1, updated_at: 1 });
      }
      return jsonResponse({ status: 'success', fetched: 10, count: 110 });
    });

    noteStaleEngineSeries(notice());
    noteStaleEngineSeries(notice());
    expect(store.logs.filter((l) => /Engine series stale/.test(l.message))).toHaveLength(1);

    const deadline = Date.now() + 1000;
    while (Date.now() < deadline && store.live.feeds['binance|spot|BTC/USDT|1h']?.status !== 'live') {
      await new Promise((r) => setTimeout(r, 10));
    }
    // The repair resolution flips the feed back to live and logs the outcome.
    expect(store.live.feeds['binance|spot|BTC/USDT|1h']?.status).toBe('live');
    expect(store.logs.some((l) => /Engine series repaired/.test(l.message))).toBe(true);
  });

  it('keeps the notice but skips the repair when the engine has no endpoint', () => {
    let fetches = 0;
    restoreFetch = mockFetch(() => {
      fetches += 1;
      return jsonResponse({ status: 'success' });
    });
    expect(ENGINE_STALE_LOG_MIN_MS).toBeGreaterThan(0);
    noteStaleEngineSeries({
      ...notice(),
      repair: { ...notice().repair, endpoint: '' },
    });
    expect(store.logs.some((l) => /Engine series stale/.test(l.message))).toBe(true);
    expect(fetches).toBe(0);
  });
});
