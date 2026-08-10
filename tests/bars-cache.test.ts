// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  barsCacheKey,
  mergeBars,
  mergeAndCap,
  getCachedBars,
  putCachedBars,
  clearCachedBars,
  listCachedSeries,
  getCachedRecord,
  sliceBarsForLoad,
  countBarsForLoad,
  _resetBarsCacheForTests,
  BARS_CACHE_MAX,
} from '../src/data/bars-cache';
import type { Bar } from '../src/store/types';

function bar(t: number, c = 100): Bar {
  return { time: t, open: c, high: c + 1, low: c - 1, close: c, volume: 1 };
}

describe('bars-cache', () => {
  beforeEach(async () => {
    await _resetBarsCacheForTests();
  });

  it('builds stable keys', () => {
    expect(barsCacheKey('binance-rest', 'btcusdt', '1h')).toBe('binance-rest|BTCUSDT|1h');
  });

  it('mergeBars prepends older sorted page without Map rebuild', () => {
    const base = [
      { time: 300, open: 1, high: 1, low: 1, close: 1 },
      { time: 400, open: 1, high: 1, low: 1, close: 1 },
    ];
    const older = [
      { time: 100, open: 1, high: 1, low: 1, close: 1 },
      { time: 200, open: 1, high: 1, low: 1, close: 1 },
    ];
    const merged = mergeBars(base as never, older as never);
    expect(merged.map((b) => b.time)).toEqual([100, 200, 300, 400]);
  });

  it('mergeBars sorts and dedupes by time (last wins)', () => {
    const a = [bar(1, 10), bar(2, 20)];
    const b = [bar(2, 99), bar(3, 30)];
    const m = mergeBars(a, b);
    expect(m.map((x) => x.time)).toEqual([1, 2, 3]);
    expect(m[1]!.close).toBe(99);
  });

  it('mergeAndCap trims to max keeping newest', () => {
    const existing = Array.from({ length: 5 }, (_, i) => bar(i + 1, i));
    const incoming = [bar(6, 6), bar(7, 7)];
    const m = mergeAndCap(existing, incoming, 4);
    expect(m).toHaveLength(4);
    expect(m[0]!.time).toBe(4);
    expect(m[3]!.time).toBe(7);
  });

  it('mergeAndCap single-bar hot path updates last / appends / drops junk', () => {
    const existing = [bar(1, 10), bar(2, 20)];
    const updated = mergeAndCap(existing, [bar(2, 99)]);
    expect(updated).toHaveLength(2);
    expect(updated[1]!.close).toBe(99);
    // must not mutate input
    expect(existing[1]!.close).toBe(20);

    const appended = mergeAndCap(existing, [bar(3, 30)], 100);
    expect(appended.map((b) => b.time)).toEqual([1, 2, 3]);

    const junk = mergeAndCap(existing, [{ time: NaN, open: 1, high: 1, low: 1, close: 1 } as never]);
    expect(junk).toHaveLength(2);
    expect(junk[1]!.close).toBe(20);

    expect(mergeAndCap(existing, null as never)).toHaveLength(2);
  });

  it('put/get/clear round-trip in memory', async () => {
    await putCachedBars('mock-walk', 'TEST', '1d', [bar(100), bar(200)]);
    const got = await getCachedBars('mock-walk', 'TEST', '1d');
    expect(got).toHaveLength(2);
    expect(got[0]!.time).toBe(100);

    await putCachedBars('mock-walk', 'TEST', '1d', [bar(150, 50)]);
    const merged = await getCachedBars('mock-walk', 'TEST', '1d');
    expect(merged.map((b) => b.time)).toEqual([100, 150, 200]);

    await clearCachedBars('mock-walk', 'TEST', '1d');
    expect(await getCachedBars('mock-walk', 'TEST', '1d')).toEqual([]);
  });

  it('exposes a finite max constant', () => {
    expect(BARS_CACHE_MAX).toBeGreaterThan(1000);
  });

  it('listCachedSeries returns metadata for stored series', async () => {
    await putCachedBars('binance-rest', 'BTCUSDT', '1h', [bar(100), bar(200), bar(300)]);
    await putCachedBars('mock-walk', 'ETHUSDT', '1d', [bar(50)]);
    const list = await listCachedSeries();
    expect(list.length).toBeGreaterThanOrEqual(2);
    const btc = list.find((r) => r.symbol === 'BTCUSDT' && r.interval === '1h');
    expect(btc?.count).toBe(3);
    expect(btc?.oldestSec).toBe(100);
    expect(btc?.newestSec).toBe(300);
    expect(btc?.sourceId).toBe('binance-rest');

    const rec = await getCachedRecord('binance-rest', 'BTCUSDT', '1h');
    expect(rec?.bars).toHaveLength(3);
  });

  it('sliceBarsForLoad filters by date range and maxBars', () => {
    const bars = [bar(100), bar(200), bar(300), bar(400), bar(500)];
    expect(sliceBarsForLoad(bars, { fromSec: 200, toSec: 400 }).map((b) => b.time)).toEqual([
      200, 300, 400,
    ]);
    expect(sliceBarsForLoad(bars, { maxBars: 2 }).map((b) => b.time)).toEqual([400, 500]);
    expect(
      sliceBarsForLoad(bars, { fromSec: 100, toSec: 500, maxBars: 2 }).map((b) => b.time),
    ).toEqual([400, 500]);
    expect(sliceBarsForLoad(bars, null)).toHaveLength(5);
    expect(countBarsForLoad(bars, { fromSec: 250, toSec: 450 })).toBe(2);
    expect(countBarsForLoad(bars, { maxBars: 3 })).toBe(3);
  });
});
