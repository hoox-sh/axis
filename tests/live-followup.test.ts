/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Follow-ups from the 5-minute preview of PR #6:
 * bar-close engines must not re-arm on a forming tick, a learned guest bar
 * cap is sent first, and badges drop values from the previous symbol.
 */

import './setup';
import { describe, expect, it } from 'bun:test';
import { badgeValueText, rerunHoldoffMs, shouldMarkNeedsRerun } from '../src/chart/live-guards';
import {
  _resetGuestBarCapForTests,
  barsWithinGuestCap,
  rememberGuestBarCap,
} from '../src/engines/free-tier';
import {
  appendBar,
  indicatorSeriesMatchesChart,
  loadBars,
  setIndicatorSeries,
  setLiveRerunModeReader,
  setStore,
  store,
} from '../src/store';
import type { Bar } from '../src/store/types';

function bar(time: number, close = 10): Bar {
  return { time, open: close, high: close, low: close, close, volume: 1 };
}

describe('bar-close re-run gate', () => {
  it('does not dirty scripts on a forming tick', () => {
    expect(
      shouldMarkNeedsRerun({ mode: 'bar-close', formingUpdate: true, closed: false }),
    ).toBe(false);
    expect(shouldMarkNeedsRerun({ mode: 'every-tick', formingUpdate: true, closed: false })).toBe(
      true,
    );
    expect(shouldMarkNeedsRerun({ mode: 'bar-close', formingUpdate: false, closed: false })).toBe(
      true,
    );
    expect(shouldMarkNeedsRerun({ mode: 'bar-close', formingUpdate: true, closed: true })).toBe(
      true,
    );
  });

  it('waits out the last run before the next bar-close run', () => {
    expect(rerunHoldoffMs('bar-close', 800, 0)).toBe(800);
    expect(rerunHoldoffMs('bar-close', 800, 500)).toBe(300);
    expect(rerunHoldoffMs('bar-close', 800, 800)).toBe(0);
    expect(rerunHoldoffMs('every-tick', 800, 0)).toBe(0);
  });

  it('appendBar leaves needsRerun clear on a forming tick when the reader is bar-close', () => {
    setLiveRerunModeReader(() => 'bar-close');
    const first = bar(1_700_000_000, 20);
    loadBars([first], 'BTCUSDT', '1m', 'binance');
    setStore('live', 'needsRerun', false);
    appendBar({ ...first, close: 21 });
    expect(store.bars[0]!.close).toBe(21);
    expect(store.live.needsRerun).toBe(false);
    appendBar({ ...first, close: 22, closed: true });
    expect(store.live.needsRerun).toBe(true);
    setLiveRerunModeReader(() => 'every-tick');
  });
});

describe('guest bar cap', () => {
  it('sends the remembered cap first and skips it when a key is present', () => {
    _resetGuestBarCapForTests();
    const bars = Array.from({ length: 10_000 }, (_, i) => i);
    expect(barsWithinGuestCap('https://pynescript.online', bars, false).bars).toHaveLength(10_000);
    rememberGuestBarCap('https://pynescript.online/', 5_000);
    const guest = barsWithinGuestCap('https://pynescript.online', bars, false);
    expect(guest.cap).toBe(5_000);
    expect(guest.bars).toHaveLength(5_000);
    expect(guest.bars[0]).toBe(5_000);
    expect(barsWithinGuestCap('https://pynescript.online', bars, true).bars).toHaveLength(10_000);
    _resetGuestBarCapForTests();
  });
});

describe('badge values across a symbol change', () => {
  it('drops the previous symbol and refuses a late write', () => {
    const btc = [bar(1_700_000_000, 70_000)];
    loadBars(btc, 'BTCUSDT', '1m', 'binance');
    setIndicatorSeries(
      'sma',
      { name: 'SMA', series: { SMA: [73934] } },
      { symbol: 'BTCUSDT', interval: '1m' },
    );
    expect(indicatorSeriesMatchesChart()).toBe(true);
    expect(store.indicatorSeries['sma']?.series?.['SMA']).toEqual([73934]);

    loadBars([bar(1_700_000_060, 2015)], 'ETHUSDT', '1m', 'binance');
    expect(store.indicatorSeries['sma']).toBeUndefined();
    expect(indicatorSeriesMatchesChart()).toBe(false);

    setIndicatorSeries(
      'sma',
      { name: 'SMA', series: { SMA: [73934] } },
      { symbol: 'BTCUSDT', interval: '1m' },
    );
    expect(store.indicatorSeries['sma']).toBeUndefined();
    expect(
      badgeValueText({ values: '73934.00', marketMatch: false, atLastClose: true }),
    ).toBeNull();
    expect(badgeValueText({ values: '55.50', marketMatch: true, atLastClose: true })).toBe(
      '55.50 @ last close',
    );
    expect(badgeValueText({ values: null, marketMatch: true, atLastClose: false })).toBeNull();
  });
});
