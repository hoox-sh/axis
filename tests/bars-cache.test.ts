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
});
