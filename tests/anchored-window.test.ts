/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Chart window: exactly `rollingWindowBars`. A new bar on a full window drops
 * the head; there is no period anchoring, no growth ceiling, and no auto-grow.
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

describe('fixed chart window', () => {
  it('paints exactly the configured window', () => {
    expect(chartWindowLimit()).toBe(BASE);
    expect(store.bars.length).toBe(BASE);
    expect(chartWindowCeiling()).toBe(BASE);
  });

  it('drops the head on every new bar once the window is full', () => {
    const before = tipTime();
    appendBar(tick(before + STEP));
    expect(store.bars.length).toBe(BASE);
    expect(tipTime()).toBe(before + STEP);
    expect(headTime()).toBe(START + STEP);
  });

  it('never grows past the window, even after many bars', () => {
    let t = tipTime();
    for (let i = 0; i < 25; i++) {
      t += STEP;
      appendBar(tick(t));
    }
    expect(store.bars.length).toBe(BASE);
    expect(chartWindowLimit()).toBe(BASE);
  });

  it('follows a rolling-window change on the next load', () => {
    setStore('rollingWindowBars', 300);
    loadBars(makeBars(BASE, START, STEP), 'BTCUSDT', '1m', 'binance');
    expect(chartWindowLimit()).toBe(300);
    expect(store.bars.length).toBe(300);
    expect(tipTime()).toBe(START + (BASE - 1) * STEP);
  });
});

describe('engine window', () => {
  it('is exactly the chart window', () => {
    expect(chartWindowEngineBars()).toBe(BASE);
    setStore('rollingWindowBars', 1040);
    loadBars(makeBars(1040, START, STEP), 'BTCUSDT', '1m', 'binance');
    expect(chartWindowEngineBars()).toBe(1040);
  });
});
