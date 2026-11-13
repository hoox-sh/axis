/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Commit-once: a bar behind the tip keeps the value the chart painted.
 *
 * Invariant: only the forming tip is mutable. A later run cannot change, drop,
 * or re-index a sealed value; the guard counts every attempt.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import {
  _resetCommitStoreForTests,
  commitBoundary,
  commitSeriesColumn,
  commitSeriesMap,
  commitTipTime,
  isSealed,
  resetCommitStore,
  sealedWriteCount,
} from '../src/chart/commit-store';

const times = [100, 200, 300];

beforeEach(() => {
  _resetCommitStoreForTests();
});

describe('boundary', () => {
  it('opens the newest run bar as the mutable tip', () => {
    const tip = commitBoundary(times);
    expect(tip).toBe(300);
    expect(isSealed(200, tip)).toBe(true);
    expect(isSealed(300, tip)).toBe(false);
  });

  it('never moves the tip backwards for a stale run', () => {
    commitBoundary([100, 200, 300]);
    expect(commitBoundary([100, 200])).toBe(300);
    expect(commitTipTime()).toBe(300);
  });
});

describe('commitSeriesColumn', () => {
  it('keeps the first painted value for a sealed bar', () => {
    const first = commitSeriesColumn('s1', 'close', times, [10, 20, 30], 300);
    expect(first).toEqual([10, 20, 30]);
    // A re-run with different history must not rewrite bars 100 / 200.
    const second = commitSeriesColumn('s1', 'close', times, [11, 22, 33], 300);
    expect(second).toEqual([10, 20, 33]);
    expect(sealedWriteCount()).toBe(2);
  });

  it('takes the tip value on every run', () => {
    commitSeriesColumn('s1', 'close', times, [10, 20, 30], 300);
    const next = commitSeriesColumn('s1', 'close', times, [10, 20, 31], 300);
    expect(next[2]).toBe(31);
    expect(sealedWriteCount()).toBe(0);
  });

  it('adds a sealed bar it has never seen once, then freezes it', () => {
    commitSeriesColumn('s1', 'close', [300], [30], 300);
    // Window grew backwards: 100 / 200 are new sealed bars.
    const grown = commitSeriesColumn('s1', 'close', times, [10, 20, 31], 300);
    expect(grown).toEqual([10, 20, 31]);
    const again = commitSeriesColumn('s1', 'close', times, [99, 99, 32], 300);
    expect(again).toEqual([10, 20, 32]);
  });

  it('keeps owners independent', () => {
    commitSeriesColumn('a', 'p', times, [1, 2, 3], 300);
    const b = commitSeriesColumn('b', 'p', times, [7, 8, 9], 300);
    expect(b).toEqual([7, 8, 9]);
  });

  it('keeps values verbatim (numbers, objects, strings)', () => {
    const candle = { open: 1, high: 2, low: 0.5, close: 1.5 };
    const out = commitSeriesColumn('s1', 'p', times, [Number.NaN, null, candle], 300);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeNull();
    expect(out[2]).toBe(candle);
  });
});

describe('commitSeriesMap', () => {
  it('merges every array column and passes non-arrays through', () => {
    const first = commitSeriesMap('s1', { a: [1, 2, 3], b: 'meta' }, times);
    expect(first.a).toEqual([1, 2, 3]);
    expect(first.b).toBe('meta');
    const second = commitSeriesMap('s1', { a: [9, 9, 9] }, times);
    expect(second.a).toEqual([1, 2, 9]);
  });
});

describe('reset', () => {
  it('drops every committed value on a full load', () => {
    commitSeriesColumn('s1', 'p', times, [1, 2, 3], 300);
    resetCommitStore();
    expect(commitTipTime()).toBe(0);
    expect(sealedWriteCount()).toBe(0);
    const after = commitSeriesColumn('s1', 'p', times, [4, 5, 6], 300);
    expect(after).toEqual([4, 5, 6]);
  });
});
