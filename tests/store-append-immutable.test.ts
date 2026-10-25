/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * The immutable candle — what a live tick may and may not do to a bar series.
 *
 * Three invariants live in `store.appendBar`:
 *
 * 1. **History behind the tip is immutable.** A late or out-of-order tick for
 *    an older bar is dropped instead of being appended behind the tip (which
 *    would put the series out of order and break every index-based zip).
 * 2. **A closed tip is never reopened.** A forming tick cannot rewrite a
 *    candle the venue already reported as closed.
 * 3. **The chart window slides, it does not grow.** A new bar at the cap
 *    drops the head — the chart never holds more bars than the Rolling
 *    window says.
 *
 * The verdict is returned so the paint layer (and the caller) knows whether
 * anything changed at all.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  appendBar,
  chartWindowLimit,
  loadBars,
  setStore,
  store,
} from '../src/store';
import type { Bar } from '../src/store/types';
import {
  _resetSyncSampleForTests,
  closedBarHash,
} from '../src/chart/v1/invariants';

function bar(t: number, close = 100, extra: Partial<Bar> = {}): Bar {
  return { time: t, open: close, high: close + 1, low: close - 1, close, volume: 1, ...extra };
}

function series(n: number, start = 1_700_000_000, step = 60): Bar[] {
  return Array.from({ length: n }, (_, i) => bar(start + i * step, 100 + i));
}

const DEFAULT_WINDOW = 10_000;

beforeEach(() => {
  setStore('bars', []);
  setStore('rollingWindowBars', DEFAULT_WINDOW);
  setStore('live', {
    active: true,
    needsRerun: false,
    lastBarTime: 0,
    streamId: 'mock',
    preferAfterLoad: false,
    rerunOn: 'every-tick',
  });
});

// The store is shared across the test files in one process: a leaked rolling
// window (or bar series) would slice the bars of every later test.
afterEach(() => {
  setStore('bars', []);
  setStore('rollingWindowBars', DEFAULT_WINDOW);
  setStore('live', {
    active: false,
    needsRerun: false,
    lastBarTime: 0,
    streamId: '',
    preferAfterLoad: false,
    rerunOn: 'every-tick',
  });
});

describe('appendBar — immutable history', () => {
  it('rejects a late tick for a bar behind the tip', () => {
    loadBars(series(3), 'BTCUSDT', '1m', 'test');
    const before = store.bars.length;
    const verdict = appendBar(bar(1_700_000_000, 999));
    expect(verdict).toBe('ignored');
    // The series is untouched — the stale bar was not appended behind the tip.
    expect(store.bars).toHaveLength(before);
    expect(store.bars[store.bars.length - 1]!.time).toBe(1_700_000_000 + 120);
  });

  it('rejects a bar with a non-finite time', () => {
    loadBars(series(2), 'BTCUSDT', '1m', 'test');
    expect(appendBar(bar(Number.NaN))).toBe('ignored');
    expect(store.bars).toHaveLength(2);
  });

  it('does not reopen a closed candle with a forming tick', () => {
    loadBars([bar(1_700_000_000, 100, { closed: true })], 'BTCUSDT', '1m', 'test');
    const verdict = appendBar(bar(1_700_000_000, 101, { closed: false }));
    expect(verdict).toBe('ignored');
    expect(store.bars[0]!.close).toBe(100);
  });

  it('accepts a closed restatement of the closed tip', () => {
    loadBars([bar(1_700_000_000, 100, { closed: true })], 'BTCUSDT', '1m', 'test');
    const verdict = appendBar(bar(1_700_000_000, 101, { closed: true }));
    expect(verdict).toBe('updated');
    expect(store.bars[0]!.close).toBe(101);
  });

  it('a forming tick on a new tip does not change the last N closed-bar hash', () => {
    const start = 1_700_000_000;
    loadBars(
      Array.from({ length: 8 }, (_, i) => bar(start + i * 60, 100 + i, { closed: true })),
      'BTCUSDT',
      '1m',
      'test',
    );
    const hash = closedBarHash(store.bars, 8);
    expect(appendBar(bar(start + 8 * 60, 200, { closed: false }))).toBe('appended');
    expect(closedBarHash(store.bars, 8)).toBe(hash);
    expect(appendBar(bar(start + 8 * 60, 201, { closed: false }))).toBe('updated');
    expect(closedBarHash(store.bars, 8)).toBe(hash);
  });

  it('closing the forming tip changes the last N closed-bar hash', () => {
    const start = 1_700_000_000;
    loadBars(
      Array.from({ length: 8 }, (_, i) => bar(start + i * 60, 100 + i, { closed: true })),
      'BTCUSDT',
      '1m',
      'test',
    );
    const hash = closedBarHash(store.bars, 8);
    appendBar(bar(start + 8 * 60, 200, { closed: false }));
    expect(closedBarHash(store.bars, 8)).toBe(hash);
    expect(appendBar(bar(start + 8 * 60, 200, { closed: true }))).toBe('updated');
    expect(closedBarHash(store.bars, 8)).not.toBe(hash);
  });

  it('rewriting a closed tip still stores the correction and changes the hash', () => {
    loadBars([bar(1_700_000_000, 100, { closed: true })], 'BTCUSDT', '1m', 'test');
    const hash = closedBarHash(store.bars, 8);
    _resetSyncSampleForTests();
    const messages: string[] = [];
    const origWarn = console.warn;
    const origRand = Math.random;
    console.warn = ((message?: unknown) => {
      messages.push(String(message));
    }) as typeof console.warn;
    Math.random = () => 0;
    try {
      expect(appendBar(bar(1_700_000_000, 101, { closed: true }))).toBe('updated');
    } finally {
      console.warn = origWarn;
      Math.random = origRand;
    }
    expect(store.bars[0]!.close).toBe(101);
    expect(closedBarHash(store.bars, 8)).not.toBe(hash);
    expect(messages).toContain('[axis] closed bar 1700000000 changed after commit');
  });

  it('replaces the tip payload instead of merging into it', () => {
    // Solid merges an object into the existing store node, so a tick without a
    // volume would keep the previous volume and draw a stale histogram.
    loadBars([bar(1_700_000_000, 100)], 'BTCUSDT', '1m', 'test');
    appendBar({ time: 1_700_000_000, open: 1, high: 2, low: 0, close: 2 });
    expect(store.bars[0]!.volume).toBe(0);
    expect(store.bars[0]!.close).toBe(2);
  });
});

describe('appendBar — the chart window slides', () => {
  it('keeps the newest N bars when the window is at its cap', () => {
    setStore('rollingWindowBars', 5);
    loadBars(series(5), 'BTCUSDT', '1m', 'test');
    const verdict = appendBar(bar(1_700_000_000 + 5 * 60, 999));
    expect(verdict).toBe('slid');
    expect(store.bars).toHaveLength(5);
    // The head slid, the live bar is the tail.
    expect(store.bars[0]!.time).toBe(1_700_000_000 + 60);
    expect(store.bars[store.bars.length - 1]!.time).toBe(1_700_000_000 + 5 * 60);
  });

  it('appends while the window still has room', () => {
    setStore('rollingWindowBars', 5);
    loadBars(series(3), 'BTCUSDT', '1m', 'test');
    const verdict = appendBar(bar(1_700_000_000 + 3 * 60, 999));
    expect(verdict).toBe('appended');
    expect(store.bars).toHaveLength(4);
  });

  it('never exceeds the window over many ticks', () => {
    setStore('rollingWindowBars', 5);
    loadBars(series(5), 'BTCUSDT', '1m', 'test');
    for (let i = 5; i < 40; i++) {
      appendBar(bar(1_700_000_000 + i * 60, 100 + i));
      expect(store.bars.length).toBeLessThanOrEqual(5);
    }
    expect(store.bars[store.bars.length - 1]!.time).toBe(1_700_000_000 + 39 * 60);
  });
});

describe('chart window helpers', () => {
  it('caps loadBars and setBarsQuiet at the window', async () => {
    const { setBarsQuiet, sliceToChartWindow } = await import('../src/store');
    setStore('rollingWindowBars', 3);
    loadBars(series(10), 'BTCUSDT', '1m', 'test');
    expect(store.bars).toHaveLength(3);
    setBarsQuiet(series(10));
    expect(store.bars).toHaveLength(3);
    expect(sliceToChartWindow(series(2))).toHaveLength(2);
  });

  it('falls back to the default for a zero window', () => {
    // The persisted setting clamps 0 to the default, so an unbounded chart
    // window is never reachable from the UI.
    setStore('rollingWindowBars', 0);
    expect(chartWindowLimit()).toBe(10_000);
  });

  it('falls back to the default for junk', () => {
    setStore('rollingWindowBars', Number.NaN);
    expect(chartWindowLimit()).toBe(10_000);
  });
});
