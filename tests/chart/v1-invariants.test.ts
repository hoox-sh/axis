/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import {
  _resetSyncSampleForTests,
  closedBarHash,
  noteSyncSample,
  paneAxisSkew,
  plotLengthSkew,
  plotOverhang,
  seriesPastTip,
  type ClosedBar,
} from '../../src/chart/v1/invariants';

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
});
