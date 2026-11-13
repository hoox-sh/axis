/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Store → price object wiring.
 *
 * Invariant: the price is committed in the same batch as the tip bar, so it
 * always equals the candle close the chart is showing. A forming tick reaches
 * the object on the frame flush, never before the candle.
 */

import './setup';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { appendBar, loadBars, setStore } from '../src/store';
import { _setLiveFrameSchedulerForTests } from '../src/store/live-frame';
import { _resetPriceForTests, priceView } from '../src/market/price-object';
import type { Bar } from '../src/store/types';

const bar = (time: number, close: number): Bar => ({
  time,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume: 10,
});

beforeEach(() => {
  _resetPriceForTests();
  setStore('bars', []);
});

afterEach(() => {
  _setLiveFrameSchedulerForTests(null);
});

describe('loadBars → price object', () => {
  it('commits the painted close and the previous close', () => {
    loadBars([bar(60, 100), bar(120, 104)], 'BTCUSDT', '1m', 'binance');
    const v = priceView();
    expect(v.symbol).toBe('BTCUSDT');
    expect(v.value).toBe(104);
    expect(v.prevClose).toBe(100);
    expect(v.changePct).toBeCloseTo(4, 10);
    expect(v.direction).toBe('up');
    expect(v.barTime).toBe(120);
    // The newest loaded bar is the forming tip, so it is live.
    expect(v.live).toBe(true);
    expect(v.decimals).toBe(2);
  });

  it('clears the value when the load is empty', () => {
    loadBars([], 'ETHUSDT', '1h', 'binance');
    expect(priceView().symbol).toBe('ETHUSDT');
    expect(Number.isFinite(priceView().value)).toBe(false);
  });
});

describe('appendBar → price object', () => {
  it('moves the previous close when a new candle opens', () => {
    loadBars([bar(60, 100), bar(120, 104)], 'BTCUSDT', '1m', 'binance');
    appendBar(bar(180, 110));
    const v = priceView();
    expect(v.value).toBe(110);
    expect(v.prevClose).toBe(104);
    expect(v.barTime).toBe(180);
  });

  it('updates the forming close on the frame flush', () => {
    loadBars([bar(60, 100), bar(120, 104)], 'BTCUSDT', '1m', 'binance');
    const kicks: Array<() => void> = [];
    _setLiveFrameSchedulerForTests((kick) => {
      kicks.push(kick);
    });
    appendBar({ ...bar(120, 108), open: 100 });
    // The bar is written immediately, the price object waits for the frame.
    expect(priceView().value).toBe(104);
    kicks[0]?.();
    expect(priceView().value).toBe(108);
    expect(priceView().live).toBe(true);
  });
});
