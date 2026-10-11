/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Boundary guard for chart-library setData payloads: poisoned rows are
 * dropped + reported instead of throwing a bare library assertion on
 * every redraw.
 */

import { describe, expect, it } from 'bun:test';
import { sanitizeSeriesDataForSetData } from '../src/chart/manager-access.ts';

describe('sanitizeSeriesDataForSetData', () => {
  it('passes clean OHLC data through untouched', () => {
    const data = [
      { time: 100, open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: 200, open: 1.5, high: 2.5, low: 1, close: 2 },
    ];
    const r = sanitizeSeriesDataForSetData(data, { requireOhlc: true });
    expect(r.clean).toEqual(data);
    expect(r.dropped).toBe(0);
    expect(r.nonIntegerTimes).toBe(0);
  });

  it('drops non-finite times and NaN OHLC', () => {
    const data = [
      { time: 100, open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: NaN, open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: 200, open: 1, high: NaN, low: 1, close: 2 },
      { time: 300, open: 2, high: 3, low: 1.5, close: 2.5 },
    ];
    const r = sanitizeSeriesDataForSetData(data, { requireOhlc: true });
    expect(r.clean.map((d) => d.time)).toEqual([100, 300]);
    expect(r.dropped).toBe(2);
    expect(r.firstBadIndex).toBe(1);
    expect(r.firstBadReason).toContain('bad-time');
  });

  it('drops duplicate and out-of-order times', () => {
    const row = (time: number) => ({ time, open: 1, high: 2, low: 0.5, close: 1 });
    const r = sanitizeSeriesDataForSetData(
      [row(100), row(200), row(200), row(150), row(300)],
      { requireOhlc: true },
    );
    expect(r.clean.map((d) => d.time)).toEqual([100, 200, 300]);
    expect(r.dropped).toBe(2);
    expect(r.firstBadReason).toContain('non-ascending-time');
  });

  it('checks value field for non-OHLC payloads (volume)', () => {
    const data = [
      { time: 100, value: 10, color: 'a' },
      { time: 200, value: NaN, color: 'a' },
      { time: 300, value: 5, color: 'b' },
    ];
    const r = sanitizeSeriesDataForSetData(data);
    expect(r.clean.map((d) => d.time)).toEqual([100, 300]);
    expect(r.dropped).toBe(1);
    expect(r.firstBadReason).toBe('bad-value');
  });

  it('counts non-integer times for diagnostics without dropping', () => {
    const data = [
      { time: 100.5, open: 1, high: 2, low: 0.5, close: 1 },
      { time: 200, open: 1, high: 2, low: 0.5, close: 1 },
    ];
    const r = sanitizeSeriesDataForSetData(data, { requireOhlc: true });
    expect(r.nonIntegerTimes).toBe(1);
    expect(r.clean.length).toBe(2);
  });

  it('handles empty input', () => {
    const r = sanitizeSeriesDataForSetData([], { requireOhlc: true });
    expect(r.clean).toEqual([]);
    expect(r.dropped).toBe(0);
    expect(r.firstBadIndex).toBe(-1);
  });
});
