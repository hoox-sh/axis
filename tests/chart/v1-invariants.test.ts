/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import '../setup';
import { describe, expect, test } from 'bun:test';
import {
  _resetSyncSampleForTests,
  closedBarHash,
  noteClosedRewrite,
  noteSeriesPastTip,
  noteSyncSample,
  paneAxisSkew,
  plotLengthSkew,
  plotOverhang,
  seriesPastTip,
  type ClosedBar,
} from '../../src/chart/v1/invariants';
import {
  applyChartMutations,
  type ChartMutationContext,
} from '../../src/indicators/apply-mutations';

const bar = (time: number, close: number): ClosedBar => ({
  time,
  open: 1,
  high: 2,
  low: 0.5,
  close,
});

describe('v1 sync invariants', () => {
  test('a series ahead of the price tip is a positive skew', () => {
    expect(paneAxisSkew(100, 160)).toBe(60);
    expect(seriesPastTip(100, [40, Number.NaN, 160, 120, Number.POSITIVE_INFINITY])).toBe(160);
  });

  test('a shorter series is a negative skew and has no time past the tip', () => {
    expect(paneAxisSkew(100, 40)).toBe(-60);
    expect(paneAxisSkew(100, 100)).toBe(0);
    expect(seriesPastTip(100, [40, 80, 100])).toBe(null);
  });

  test('a missing or non-finite price returns null', () => {
    expect(paneAxisSkew(null, 100)).toBe(null);
    expect(paneAxisSkew(100, null)).toBe(null);
    expect(paneAxisSkew(Number.NaN, 100)).toBe(null);
    expect(paneAxisSkew(100, Number.POSITIVE_INFINITY)).toBe(null);
    expect(seriesPastTip(null, [200])).toBe(null);
  });

  test('plot length skew is the largest absolute mismatch', () => {
    expect(plotLengthSkew(10, [10, 10, 10])).toBe(0);
    expect(plotLengthSkew(10, [10, 8, 13])).toBe(3);
    expect(plotLengthSkew(10, [])).toBe(0);
  });

  test('the closed-bar hash is stable and follows the newest bar in the window', () => {
    const bars = Array.from({ length: 10 }, (_, i) => bar((i + 1) * 60, i + 1));
    const hash = closedBarHash(bars, 8);
    expect(hash).toBe(closedBarHash(bars, 8));
    expect(hash).toBe(
      bars
        .slice(2)
        .map((row) => `${row.time}:${row.open}:${row.high}:${row.low}:${row.close}`)
        .join('|'),
    );
    expect(closedBarHash([])).toBe('');

    const newest = bars.map((row, i) => (i === bars.length - 1 ? { ...row, close: 99 } : row));
    expect(closedBarHash(newest, 8)).not.toBe(hash);

    const older = bars.map((row, i) => (i === 0 ? { ...row, close: 99 } : row));
    expect(closedBarHash(older, 8)).toBe(hash);
  });

  test('a plot column past the price axis warns once in dev and is sampled in prod', () => {
    _resetSyncSampleForTests();
    expect(plotOverhang(10, [10, 8])).toBe(0);
    expect(plotOverhang(10, [12, 15])).toBe(5);
    const messages: string[] = [];
    noteSyncSample(10, [12], { dev: true, warn: (message) => messages.push(message) });
    noteSyncSample(10, [12], { dev: true, warn: (message) => messages.push(message) });
    expect(messages).toEqual(['[axis] plot column is 2 bars past the price axis']);
    _resetSyncSampleForTests();
    messages.length = 0;
    noteSyncSample(10, [14], { dev: false, rand: 0.5, warn: (message) => messages.push(message) });
    noteSyncSample(10, [14], { dev: false, rand: 0, warn: (message) => messages.push(message) });
    expect(messages).toEqual(['[axis] plot column is 4 bars past the price axis']);
  });

  test('a rewritten closed bar warns once', () => {
    _resetSyncSampleForTests();
    const messages: string[] = [];
    noteClosedRewrite(60, { dev: true, warn: (message) => messages.push(message) });
    noteClosedRewrite(60, { dev: true, warn: (message) => messages.push(message) });
    expect(messages).toEqual(['[axis] closed bar 60 changed after commit']);
  });

  test('a series on or before the price tip does not warn', () => {
    _resetSyncSampleForTests();
    const messages: string[] = [];
    const warn = (message: string) => messages.push(message);
    noteSeriesPastTip(100, [40, 80, 100], { dev: true, warn });
    noteSeriesPastTip(100, [40, 80], { dev: true, warn });
    noteSeriesPastTip(100, [], { dev: true, warn });
    expect(messages).toEqual([]);
  });

  test('a series past the price tip warns once in dev and is sampled in prod', () => {
    _resetSyncSampleForTests();
    const messages: string[] = [];
    const warn = (message: string) => messages.push(message);
    noteSeriesPastTip(100, [40, 160], { dev: true, warn });
    noteSeriesPastTip(100, [160], { dev: true, warn });
    expect(messages).toEqual(['[axis] series time 160 is past the price tip']);
    _resetSyncSampleForTests();
    messages.length = 0;
    noteSeriesPastTip(100, [160], { dev: false, rand: 0.5, warn });
    noteSeriesPastTip(100, [160], { dev: false, rand: 0, warn });
    expect(messages).toEqual(['[axis] series time 160 is past the price tip']);
  });
});

function stubMutation(extra?: Partial<ChartMutationContext>): ChartMutationContext {
  const manager = {
    syncOverlayLines: () => {},
    syncOverlayOhlc: () => {},
    refreshBadges: () => {},
    syncBgcolorBands: () => {},
    applyBarColors: () => 0,
    getPane: () => undefined,
    auditTimeParity: () => [],
    setShapeMarkers: () => {},
  };
  return {
    manager: manager as unknown as ChartMutationContext['manager'],
    paneId: 'price',
    overlay: true,
    overlayLines: [{ name: 'plot0', data: [{ time: 100, value: 1 }] }],
    overlayOhlc: [],
    split: { lines: [], bgcolors: [], barcolors: [], shapes: [], fills: [], ohlc: [] },
    plotMeta: {},
    seriesMap: { plot0: [1] },
    ohlcvTimes: [100],
    silent: true,
    indicatorId: 'script_a',
    forceFull: false,
    skipShapeMarkers: true,
    ...extra,
  };
}

describe('applyChartMutations series-past-tip sample', () => {
  test('a plot time past the candle axis hits the sampler', () => {
    _resetSyncSampleForTests();
    const messages: string[] = [];
    applyChartMutations(
      stubMutation({
        ohlcvTimes: [60, 120],
        overlayLines: [{ name: 'plot0', data: [{ time: 60, value: 1 }, { time: 180, value: 2 }] }],
      }),
      { dev: true, warn: (message) => messages.push(message) },
    );
    expect(messages).toEqual(['[axis] series time 180 is past the price tip']);
    applyChartMutations(
      stubMutation({
        ohlcvTimes: [60, 120],
        overlayLines: [{ name: 'plot0', data: [{ time: 180, value: 2 }] }],
      }),
      { dev: true, warn: (message) => messages.push(message) },
    );
    expect(messages).toEqual(['[axis] series time 180 is past the price tip']);
  });

  test('a plot that ends with the candle axis is silent', () => {
    _resetSyncSampleForTests();
    const messages: string[] = [];
    applyChartMutations(stubMutation(), { dev: true, warn: (message) => messages.push(message) });
    expect(messages).toEqual([]);
  });
});
