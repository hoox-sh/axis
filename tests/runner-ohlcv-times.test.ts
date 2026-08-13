/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  getOhlcvTimesForApply,
  _resetOhlcvTimesCacheForTests,
} from '../src/indicators/runner';
import { loadBars, appendBar, setStore } from '../src/store';
import type { Bar } from '../src/store/types';

function bar(t: number, close = 1): Bar {
  return { time: t, open: close, high: close, low: close, close, volume: 1 };
}

beforeEach(() => {
  _resetOhlcvTimesCacheForTests();
  setStore('bars', []);
  setStore('chartDataGen', 0);
});

describe('getOhlcvTimesForApply', () => {
  it('returns times for loaded bars and reuses cache on same-tip update', () => {
    loadBars([bar(1), bar(2), bar(3)], 'BTCUSDT', '1m', 't');
    const a = getOhlcvTimesForApply();
    expect(a).toEqual([1, 2, 3]);
    const b = getOhlcvTimesForApply();
    expect(b).toBe(a); // same array reference

    appendBar(bar(3, 9)); // same time tip
    const c = getOhlcvTimesForApply();
    expect(c).toBe(a);
    expect(c).toEqual([1, 2, 3]);
  });

  it('appends time on new bar without full rebuild identity (new array)', () => {
    loadBars([bar(1), bar(2)], 'BTCUSDT', '1m', 't');
    const a = getOhlcvTimesForApply();
    appendBar(bar(3, 2));
    const b = getOhlcvTimesForApply();
    expect(b).toEqual([1, 2, 3]);
    expect(b).not.toBe(a);
  });

  it('rebuilds when chartDataGen bumps (full history replace)', () => {
    loadBars([bar(1), bar(2)], 'BTCUSDT', '1m', 't');
    const a = getOhlcvTimesForApply();
    loadBars([bar(10), bar(20), bar(30)], 'ETHUSDT', '5m', 't');
    const b = getOhlcvTimesForApply();
    expect(b).toEqual([10, 20, 30]);
    expect(b).not.toBe(a);
  });
});
