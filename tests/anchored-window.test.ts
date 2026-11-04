/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Anchored live window: the chart grows past the base rolling window to keep
 * the dataset start (and the first strategy event) stable, then resets once at
 * the ceiling. This is the TV-like alternative to sliding every candle.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import {
  appendBar,
  chartWindowCeiling,
  chartWindowEngineBars,
  chartWindowLimit,
  loadBars,
  setStore,
  store,
} from '../src/store';
import type { Bar } from '../src/store/types';
import { makeBars } from './fixtures/bars';

const START = 1_700_000_000;
const STEP = 60;
const BASE = 1000;
const CEILING = 1200;

function tick(time: number): Bar {
  return { time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 };
}

function tipTime(): number {
  const bar = store.bars[store.bars.length - 1];
  if (!bar) throw new Error('expected a chart tip');
  return bar.time;
}

function headTime(): number {
  const bar = store.bars[0];
  if (!bar) throw new Error('expected a chart head');
  return bar.time;
}

beforeEach(() => {
  setStore('bars', []);
  setStore('rollingWindowBars', BASE);
  loadBars(makeBars(BASE, START, STEP), 'BTCUSDT', '1m', 'binance');
});

describe('anchored chart window', () => {
  it('grows on a new bar instead of sliding the head', () => {
    const first = headTime();
    const last = tipTime();
    expect(chartWindowLimit()).toBe(BASE);

    expect(appendBar(tick(last + STEP))).toBe('appended');
    expect(store.bars).toHaveLength(BASE + 1);
    expect(store.bars[0]?.time).toBe(first);
    expect(chartWindowLimit()).toBe(CEILING);
    // Engine depth is chunked so a live subscription does not bounce every bar.
    expect(chartWindowEngineBars()).toBe(1100);
  });

  it('keeps the first bar until the ceiling, then resets once', () => {
    const first = headTime();
    let last = tipTime();

    for (let i = 0; i < CEILING - BASE; i++) {
      last += STEP;
      expect(appendBar(tick(last))).toBe('appended');
    }
    expect(store.bars).toHaveLength(CEILING);
    expect(store.bars[0]?.time).toBe(first);
    expect(chartWindowLimit()).toBe(CEILING);

    last += STEP;
    expect(appendBar(tick(last))).toBe('slid');
    expect(store.bars).toHaveLength(BASE);
    // 1200 raw bars + the new tip -> keep the newest 1000; the head moves 201.
    expect(store.bars[0]?.time).toBe(first + (CEILING - BASE + 1) * STEP);
    expect(store.bars[store.bars.length - 1]?.time).toBe(last);
    expect(chartWindowLimit()).toBe(BASE);
    expect(chartWindowEngineBars()).toBe(BASE);
  });

  it('grows engine depth in 100-bar chunks', () => {
    let last = tipTime();
    last += STEP;
    appendBar(tick(last));
    expect(chartWindowEngineBars()).toBe(1100);

    for (let i = 0; i < 99; i++) {
      last += STEP;
      appendBar(tick(last));
    }
    // 1100 chart bars: still on the 1100 chunk.
    expect(store.bars).toHaveLength(1100);
    expect(chartWindowEngineBars()).toBe(1100);

    last += STEP;
    appendBar(tick(last));
    expect(store.bars).toHaveLength(1101);
    expect(chartWindowEngineBars()).toBe(1200);
  });

  it('caps growth at the engine free-tier max', () => {
    setStore('bars', []);
    setStore('rollingWindowBars', 4500);
    loadBars(makeBars(4500, START, STEP), 'BTCUSDT', '1m', 'binance');
    expect(chartWindowLimit()).toBe(4500);
    expect(chartWindowCeiling()).toBe(5000);

    const last = tipTime();
    expect(appendBar(tick(last + STEP))).toBe('appended');
    expect(chartWindowLimit()).toBe(5000);
    expect(chartWindowEngineBars()).toBe(4600);
  });

  it('anchors the load at the start of the week for intraday charts', () => {
    const sunday = Date.UTC(2023, 10, 12, 0, 0, 0) / 1000; // Sun 12 Nov 2023 UTC
    const monday = sunday + 1440 * 60;
    setStore('bars', []);
    setStore('rollingWindowBars', 1000);
    // 2580 one-minute bars -> newest Monday 18:59; Monday 00:00 is 1140 bars back.
    loadBars(makeBars(2580, sunday, 60), 'BTCUSDT', '1m', 'binance');
    expect(store.bars).toHaveLength(1140);
    expect(store.bars[0]?.time).toBe(monday);
    expect(chartWindowLimit()).toBe(1140);
    expect(chartWindowEngineBars()).toBe(1140);
  });

  it('falls back to the base window when the period start is beyond the cap', () => {
    const sunday = Date.UTC(2023, 10, 12, 0, 0, 0) / 1000;
    setStore('bars', []);
    setStore('rollingWindowBars', 1000);
    // Newest Monday 20:00 -> week start is 1200 bars back, at the ceiling.
    loadBars(makeBars(2641, sunday, 60), 'BTCUSDT', '1m', 'binance');
    expect(store.bars).toHaveLength(1000);
    expect(chartWindowLimit()).toBe(1000);
  });

  it('does not grow small windows (tests / tiny charts keep the slide)', () => {
    setStore('bars', []);
    setStore('rollingWindowBars', 5);
    loadBars(makeBars(4, START, STEP), 'BTCUSDT', '1m', 'binance');
    let last = tipTime();
    last += STEP;
    expect(appendBar(tick(last))).toBe('appended');
    last += STEP;
    expect(appendBar(tick(last))).toBe('slid');
    expect(store.bars).toHaveLength(5);
  });
});
