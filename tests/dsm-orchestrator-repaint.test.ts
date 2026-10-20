/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Dataset-driven repaint — the dataset must never paint *older* than the chart.
 *
 * The dataset store only learns about a live bar when the Data Manager source
 * is active. A background backfill slice landing in between would therefore
 * repaint the chart from a series that is one bar behind, and the forming
 * candle would vanish — the "last bars unset after a new live candle" symptom.
 *
 * The repaint merges the chart's live tail back in and re-caps the result to
 * the chart window.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { setStore, store } from '../src/store';
import {
  _resetDsmOrchestratorForTests,
  chartDisplayCap,
  repaintViewForTests,
  sliceForChart,
} from '../src/data/dsm-orchestrator';
import { putDatasetBars, _resetDatasetStoreForTests } from '../src/data/dataset-store';
import type { Bar } from '../src/store/types';

function bar(t: number, close = 100): Bar {
  return { time: t, open: close, high: close + 1, low: close - 1, close, volume: 1 };
}

const DEFAULT_WINDOW = 10_000;

beforeEach(() => {
  _resetDsmOrchestratorForTests();
  _resetDatasetStoreForTests();
  setStore('bars', []);
  setStore('symbol', 'BTCUSDT');
  setStore('interval', '1m');
  setStore('rollingWindowBars', DEFAULT_WINDOW);
});

// The store is shared across the test files in one process: a leaked rolling
// window (or symbol) would change the bars of every later test.
afterEach(() => {
  setStore('bars', []);
  setStore('rollingWindowBars', DEFAULT_WINDOW);
});

describe('dsm-orchestrator · chart window', () => {
  it('exposes the rolling window as the chart cap', () => {
    setStore('rollingWindowBars', 500);
    expect(chartDisplayCap()).toBe(500);
  });

  it('slices a dataset down to the newest N bars', () => {
    setStore('rollingWindowBars', 3);
    const view = sliceForChart([bar(60), bar(120), bar(180), bar(240)]);
    expect(view.map((b) => b.time)).toEqual([120, 180, 240]);
  });
});

describe('dsm-orchestrator · repaint view keeps the live tail', () => {
  it('merges the chart tail that the dataset does not have yet', () => {
    // The dataset knows up to t=120; the chart already shows the forming bar
    // at t=180 (the live tick wrote it to the store, not to the dataset).
    setStore('bars', [bar(60), bar(120), bar(180)]);
    const view = repaintViewForTests([bar(60), bar(120)], 'BTCUSDT', '1m');
    expect(view.map((b) => b.time)).toEqual([60, 120, 180]);
  });

  it('does not graft another symbol onto the chart', () => {
    setStore('symbol', 'ETHUSDT');
    setStore('bars', [bar(60), bar(120), bar(180)]);
    const view = repaintViewForTests([bar(60), bar(120)], 'BTCUSDT', '1m');
    expect(view.map((b) => b.time)).toEqual([60, 120]);
  });

  it('keeps a chart bar the dataset is missing inside the window', () => {
    setStore('bars', [bar(60), bar(120, 7), bar(180)]);
    const view = repaintViewForTests([bar(60), bar(180)], 'BTCUSDT', '1m');
    expect(view.map((b) => b.time)).toEqual([60, 120, 180]);
    expect(view.find((b) => b.time === 120)?.close).toBe(7);
  });

  it('a closed dataset bar at the tip beats a forming chart tick', () => {
    setStore('bars', [bar(60), { ...bar(120, 5), closed: false }]);
    const view = repaintViewForTests(
      [bar(60), { ...bar(120, 9), closed: true }],
      'BTCUSDT',
      '1m',
    );
    expect(view.map((b) => b.time)).toEqual([60, 120]);
    expect(view[1]!.close).toBe(9);
    expect(view[1]!.closed).toBe(true);
  });

  it('keeps the chart bar when the same-time dataset bar is not closed', () => {
    setStore('bars', [bar(60), { ...bar(120, 5), closed: false }]);
    const view = repaintViewForTests(
      [bar(60), { ...bar(120, 9), closed: false }],
      'BTCUSDT',
      '1m',
    );
    expect(view[1]!.close).toBe(5);
  });

  it('keeps the window cap when the live tail is merged in', () => {
    setStore('rollingWindowBars', 3);
    setStore('bars', [bar(60), bar(120), bar(180), bar(240)]);
    const view = repaintViewForTests([bar(60), bar(120), bar(180)], 'BTCUSDT', '1m');
    expect(view).toHaveLength(3);
    // The newest bar survives; the head slid out of the window.
    expect(view[view.length - 1]!.time).toBe(240);
  });
});
