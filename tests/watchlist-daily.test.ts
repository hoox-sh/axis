// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Previous daily close (UTC) — the stable reference price for the watchlist.
 */
import './setup';
import { afterEach, describe, expect, it } from 'bun:test';
import {
  _resetDailyCloseCacheForTests,
  dailyCloseDayKey,
  dailyCloseSourceKey,
  fetchDailyCloses,
  previousDailyCloseFromKlines,
  sourceSupportsDailyClose,
  type KlineTuple,
} from '../src/data/watchlist-daily';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 1); // 2026-11-01T00:00:00Z

function kline(openTime: number, close: number): KlineTuple {
  return [openTime, '0', '0', '0', String(close), '0', openTime + DAY - 1];
}

afterEach(() => _resetDailyCloseCacheForTests());

describe('dailyCloseDayKey', () => {
  it('uses the UTC calendar day', () => {
    expect(dailyCloseDayKey(Date.UTC(2026, 10, 3, 23, 59, 59))).toBe('2026-11-03');
    expect(dailyCloseDayKey(Date.UTC(2026, 10, 4, 0, 0, 0))).toBe('2026-11-04');
    expect(dailyCloseDayKey(Number.NaN)).toBe('');
  });
});

describe('previousDailyCloseFromKlines', () => {
  it('takes the last completed candle, not the in-progress one', () => {
    const now = T0 + 2 * DAY + 3600_000; // 1h into the third day
    const rows = [kline(T0, 100), kline(T0 + DAY, 110), kline(T0 + 2 * DAY, 999)];
    // 999 is the live daily candle → the reference is yesterday's close.
    expect(previousDailyCloseFromKlines(rows, now)).toBe(110);
  });

  it('skips rows with a missing close time', () => {
    const now = T0 + 2 * DAY;
    const rows: KlineTuple[] = [[T0, '0', '0', '0', '100', '0'], kline(T0 + DAY, 120)];
    expect(previousDailyCloseFromKlines(rows, now)).toBe(120);
  });

  it('returns null when nothing is completed', () => {
    const now = T0 + 3600_000;
    expect(previousDailyCloseFromKlines([kline(T0, 100)], now)).toBeNull();
    expect(previousDailyCloseFromKlines([], now)).toBeNull();
    expect(previousDailyCloseFromKlines(null, now)).toBeNull();
  });

  it('ignores non-positive / non-finite closes', () => {
    const now = T0 + 3 * DAY;
    const rows: KlineTuple[] = [
      kline(T0, 0),
      kline(T0 + DAY, Number.NaN),
      kline(T0 + 2 * DAY, 130),
    ];
    expect(previousDailyCloseFromKlines(rows, now)).toBe(130);
  });
});

describe('dailyCloseSourceKey', () => {
  it('follows the resolved quote venue', () => {
    expect(dailyCloseSourceKey('binance-rest')).toBe('binance-rest');
    expect(dailyCloseSourceKey('okx-rest')).toBe('okx-rest');
    expect(dailyCloseSourceKey('data-manager')).toBeTruthy();
  });
});

describe('fetchDailyCloses caching', () => {
  it('caches a symbol with no completed daily candle for the day', async () => {
    const calls: string[] = [];
    const fetchKlines = async (args: { query: string }) => {
      calls.push(args.query);
      return [] as KlineTuple[];
    };
    const now = T0 + 3 * DAY;
    expect(await fetchDailyCloses(['NOPE'], 'binance-rest', now, { fetchKlines })).toEqual({});
    expect(calls).toHaveLength(1);
    // Same day, one minute later: no second request.
    expect(
      await fetchDailyCloses(['NOPE'], 'binance-rest', now + 60_000, { fetchKlines }),
    ).toEqual({});
    expect(calls).toHaveLength(1);
  });

  it('caches a resolved close for the day', async () => {
    const calls: string[] = [];
    const fetchKlines = async (args: { query: string }) => {
      calls.push(args.query);
      return [kline(T0, 100), kline(T0 + DAY, 110)] as KlineTuple[];
    };
    const now = T0 + 2 * DAY + 3600_000;
    expect(await fetchDailyCloses(['BTCUSDT'], 'binance-rest', now, { fetchKlines })).toEqual({
      BTCUSDT: 110,
    });
    expect(
      await fetchDailyCloses(['BTCUSDT'], 'binance-rest', now + 60_000, { fetchKlines }),
    ).toEqual({ BTCUSDT: 110 });
    expect(calls).toHaveLength(1);
  });
});

describe('sourceSupportsDailyClose', () => {
  it('is Binance-only (other venues fall back to the 24h open)', () => {
    expect(sourceSupportsDailyClose('')).toBe(true);
    expect(sourceSupportsDailyClose('binance-rest')).toBe(true);
    // data-manager resolves to its underlying venue (Binance when unset).
    expect(sourceSupportsDailyClose('data-manager')).toBe(true);
    expect(sourceSupportsDailyClose('okx-rest')).toBe(false);
    expect(sourceSupportsDailyClose('bybit-rest')).toBe(false);
  });
});
