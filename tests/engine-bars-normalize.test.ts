/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Engine bars normalization: `getDataSeriesBars` must return chart-safe `Bar[]`
 * in unix seconds — ms timestamps converted, duplicates collapsed (last wins),
 * unsorted input sorted ascending, null/NaN OHLC rows dropped — so
 * `setBarsQuiet` / `setDataToChart` never see ms times or poison rows.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import { getDataSeriesBars, _resetDataSessionMemo } from '../src/engines/data-sessions';

const ENDPOINT = 'http://pro.test';
const KEY = { exchange: 'binance', symbol: 'BTCUSDT', interval: '1h' };

let restore: (() => void) | null = null;

beforeEach(() => {
  _resetDataSessionMemo();
});

afterEach(() => {
  restore?.();
  restore = null;
});

/** Serve `bars` from `GET /data/series/bars`. */
function serveBars(bars: unknown): void {
  restore = mockFetch(async (input, init) => {
    const url = new URL(String(input));
    if (String(init?.method || 'GET').toUpperCase() === 'GET' && url.pathname === '/data/series/bars') {
      return jsonResponse({ status: 'success', bars });
    }
    return jsonResponse({ status: 'error', code: 'NOT_FOUND' }, 404);
  });
}

describe('getDataSeriesBars normalization', () => {
  it('converts ms timestamps to unix seconds', async () => {
    serveBars([
      { time: 1_700_000_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { time: 1_700_003_600_000, open: 2, high: 3, low: 1, close: 2.5, volume: 11 },
    ]);
    const bars = await getDataSeriesBars(ENDPOINT, '', KEY, 100);
    expect(bars).toHaveLength(2);
    expect(bars[0]!.time).toBe(1_700_000_000);
    expect(bars[1]!.time).toBe(1_700_003_600);
    expect(bars.every((b) => b.time < 1e12)).toBe(true);
  });

  it('sorts unsorted input ascending', async () => {
    serveBars([
      { time: 1_700_003_600, open: 3, high: 4, low: 2, close: 3.5 },
      { time: 1_700_000_000, open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: 1_700_001_800, open: 2, high: 3, low: 1, close: 2.5 },
    ]);
    const bars = await getDataSeriesBars(ENDPOINT, '', KEY, 100);
    expect(bars.map((b) => b.time)).toEqual([1_700_000_000, 1_700_001_800, 1_700_003_600]);
  });

  it('dedupes by time with last wins (mixed ms/seconds stamps)', async () => {
    serveBars([
      { time: 1_700_000_000, open: 1, high: 2, low: 0.5, close: 1.5 },
      // Same bar in Pine ms — normalizes to the same stamp, last write wins.
      { time: 1_700_000_000_000, open: 9, high: 10, low: 8, close: 9.5 },
    ]);
    const bars = await getDataSeriesBars(ENDPOINT, '', KEY, 100);
    expect(bars).toHaveLength(1);
    expect(bars[0]!.time).toBe(1_700_000_000);
    expect(bars[0]!.close).toBe(9.5);
  });

  it('drops null/NaN OHLC rows instead of passing them to setData', async () => {
    serveBars([
      { time: 1_700_000_000, open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: 1_700_001_800, open: 1, high: null, low: 0.5, close: 1.5 },
      { time: 1_700_003_600, open: NaN, high: 2, low: 0.5, close: 1.5 },
      { time: 1_700_005_400, open: 1, high: 2, low: 0.5 }, // no close
      { time: 'nope', open: 1, high: 2, low: 0.5, close: 1 },
    ]);
    const bars = await getDataSeriesBars(ENDPOINT, '', KEY, 100);
    expect(bars).toHaveLength(1);
    expect(bars[0]!.time).toBe(1_700_000_000);
  });

  it('repairs mild high/low inversion instead of dropping', async () => {
    serveBars([
      { time: 1_700_000_000, open: 10, high: 9, low: 11, close: 10.5 },
    ]);
    const bars = await getDataSeriesBars(ENDPOINT, '', KEY, 100);
    expect(bars).toHaveLength(1);
    expect(bars[0]!.high).toBeGreaterThanOrEqual(bars[0]!.close);
    expect(bars[0]!.low).toBeLessThanOrEqual(bars[0]!.close);
  });

  it('returns [] for missing / non-array payloads without throwing', async () => {
    serveBars(undefined);
    expect(await getDataSeriesBars(ENDPOINT, '', KEY, 100)).toEqual([]);
  });
});
