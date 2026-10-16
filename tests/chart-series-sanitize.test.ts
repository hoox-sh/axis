/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Boundary guard for chart-library setData payloads.
 *
 * LWC 5.2 asserts **asynchronously** during render (`Value is null` /
 * `Value is undefined`) when a stored candle row is missing OHLC or two rows
 * share an open time, so a `try/catch` around `setData` cannot contain it. The
 * guard repairs the payload — dedupe last-wins, fill missing OHLC from a
 * neighbour, coerce null values — and only drops what cannot be repaired.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  clampPointsToPaintedRange,
  extendPaintedRange,
  looksLikeOhlcData,
  notePaintedCandleRange,
  resetPaintedCandleRangeForTests,
  sanitizeSeriesDataForSetData,
} from '../src/chart/series-sanitize.ts';

const ohlc = (time: number, base = 1) => ({
  time,
  open: base,
  high: base + 1,
  low: base - 0.5,
  close: base + 0.5,
});

describe('sanitizeSeriesDataForSetData', () => {
  it('passes clean OHLC data through untouched', () => {
    const data = [ohlc(100), ohlc(200, 2)];
    const r = sanitizeSeriesDataForSetData(data, { requireOhlc: true });
    expect(r.clean).toEqual(data);
    expect(r.dropped).toBe(0);
    expect(r.merged).toBe(0);
    expect(r.filled).toBe(0);
    expect(r.nonIntegerTimes).toBe(0);
  });

  it('drops non-finite times', () => {
    const r = sanitizeSeriesDataForSetData(
      [ohlc(100), { ...ohlc(0), time: NaN }, ohlc(300)],
      { requireOhlc: true },
    );
    expect(r.clean.map((d) => d.time)).toEqual([100, 300]);
    expect(r.dropped).toBe(1);
    expect(r.firstBadIndex).toBe(1);
    expect(r.firstBadReason).toContain('bad-time');
  });

  it('collapses duplicate times keeping the LAST write (merged, not dropped)', () => {
    const r = sanitizeSeriesDataForSetData(
      [ohlc(100), ohlc(200), ohlc(200, 9), ohlc(300)],
      { requireOhlc: true },
    );
    expect(r.clean.map((d) => d.time)).toEqual([100, 200, 300]);
    expect(r.merged).toBe(1);
    expect(r.dropped).toBe(0);
    // Last write wins — same rule as DatasetStore conflict resolution.
    expect(r.clean[1]!.open).toBe(9);
  });

  it('re-sorts after a poisoned leading row so times stay ascending', () => {
    const r = sanitizeSeriesDataForSetData(
      [ohlc(300), ohlc(100), ohlc(200)],
      { requireOhlc: true },
    );
    expect(r.clean.map((d) => d.time)).toEqual([100, 200, 300]);
  });

  it('fills null OHLC from the previous bar (LWC render-time null)', () => {
    const data = [
      ohlc(100, 5),
      { time: 200, open: null, high: null, low: null, close: null },
      ohlc(300, 7),
    ];
    const r = sanitizeSeriesDataForSetData(data, { requireOhlc: true });
    expect(r.dropped).toBe(0);
    expect(r.filled).toBe(1);
    expect(r.clean[1]).toEqual({ time: 200, open: 5, high: 6, low: 4.5, close: 5.5 });
  });

  it('fills a missing field from the NEXT bar when it leads the series', () => {
    const data = [
      { time: 100, open: 1, high: 2, low: 0.5, close: null },
      ohlc(200, 8),
    ];
    const r = sanitizeSeriesDataForSetData(data, { requireOhlc: true });
    expect(r.filled).toBe(1);
    expect(r.clean[0]).toEqual({ time: 100, open: 8, high: 9, low: 7.5, close: 8.5 });
  });

  it('drops all-null OHLC when no donor exists', () => {
    const r = sanitizeSeriesDataForSetData(
      [{ time: 100, open: null, high: null, low: null, close: null }],
      { requireOhlc: true },
    );
    expect(r.clean).toEqual([]);
    expect(r.dropped).toBe(1);
  });

  it('coerces null / NaN volume values to 0 but keeps real ones', () => {
    const data = [
      { time: 100, value: 10, color: 'a' },
      { time: 200, value: null, color: 'a' },
      { time: 300, value: NaN, color: 'b' },
      { time: 400, value: 5, color: 'b' },
    ];
    const r = sanitizeSeriesDataForSetData(data);
    expect(r.clean.map((d) => d.value)).toEqual([10, 0, 0, 5]);
    expect(r.dropped).toBe(0);
    expect(r.filled).toBe(2);
  });

  it('leaves an omitted value alone (Pine na whitespace gap)', () => {
    const r = sanitizeSeriesDataForSetData([
      { time: 100, value: 10 },
      { time: 200 },
    ]);
    expect(r.filled).toBe(0);
    expect('value' in r.clean[1]!).toBe(false);
  });

  it('counts non-integer times for diagnostics without dropping', () => {
    const r = sanitizeSeriesDataForSetData([ohlc(100.5), ohlc(200)], { requireOhlc: true });
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

describe('looksLikeOhlcData', () => {
  it('detects OHLC rows and ignores value rows', () => {
    expect(looksLikeOhlcData([{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5 }])).toBe(true);
    expect(looksLikeOhlcData([{ time: 1, value: 10 }])).toBe(false);
    expect(looksLikeOhlcData([])).toBe(false);
  });
});

describe('clampPointsToPaintedRange', () => {
  afterEach(() => {
    // Module state is shared across test files in one bun process.
    resetPaintedCandleRangeForTests();
  });

  const pt = (time: number, value = 1) => ({ time, value });

  it('is a no-op until the first candle paint', () => {
    const pts = [pt(1), pt(2), pt(3)];
    expect(clampPointsToPaintedRange(pts)).toEqual(pts);
  });

  it('keeps in-range points including whitespace rows', () => {
    notePaintedCandleRange(100, 300);
    const pts = [{ time: 100 }, pt(200), { time: 300, value: undefined as unknown as number }];
    expect(clampPointsToPaintedRange(pts)).toEqual(pts);
  });

  it('drops points outside the painted candle range on both ends', () => {
    notePaintedCandleRange(100, 300);
    const pts = [pt(50), pt(100), pt(200), pt(300), pt(350)];
    expect(clampPointsToPaintedRange(pts)).toEqual([pt(100), pt(200), pt(300)]);
  });

  it('drops rows with non-finite times', () => {
    notePaintedCandleRange(100, 300);
    const pts = [pt(200), { time: NaN, value: 1 }, { time: 'x' as unknown as number, value: 1 }];
    expect(clampPointsToPaintedRange(pts)).toEqual([pt(200)]);
  });

  it('ignores degenerate ranges', () => {
    notePaintedCandleRange(Number.NaN, 300);
    expect(clampPointsToPaintedRange([pt(1)])).toEqual([pt(1)]);
    notePaintedCandleRange(300, 100);
    expect(clampPointsToPaintedRange([pt(200)])).toEqual([pt(200)]);
  });

  it('handles empty input', () => {
    notePaintedCandleRange(100, 300);
    expect(clampPointsToPaintedRange([])).toEqual([]);
  });

  it('scopes clamping per chart: an explicit range wins over the global', () => {
    // Slot A painted 100..300 (legacy global path); slot B owns 1000..1200.
    notePaintedCandleRange(100, 300);
    const slotB = { first: 1000, last: 1200 };
    // Slot B keeps its own window — slot A's paint does not bleed across.
    expect(clampPointsToPaintedRange([pt(50), pt(1100), pt(1300)], slotB)).toEqual([pt(1100)]);
    // Slot A (legacy global callers) is unaffected by slot B's window.
    expect(clampPointsToPaintedRange([pt(50), pt(200), pt(1100)])).toEqual([pt(200)]);
  });

  it('two charts with different windows do not interfere', () => {
    const slotA = { first: 100, last: 300 };
    const slotB = { first: 1000, last: 1200 };
    const mixed = [pt(200), pt(1100)];
    expect(clampPointsToPaintedRange(mixed, slotA)).toEqual([pt(200)]);
    expect(clampPointsToPaintedRange(mixed, slotB)).toEqual([pt(1100)]);
  });

  it('explicit null is a no-op even when another chart painted', () => {
    // A chart that never painted must not inherit another chart's window.
    notePaintedCandleRange(100, 300);
    const pts = [pt(1), pt(50), pt(500)];
    expect(clampPointsToPaintedRange(pts, null)).toEqual(pts);
  });
});

describe('extendPaintedRange', () => {
  it('extends the last edge for newer live ticks (no full repaint)', () => {
    expect(extendPaintedRange({ first: 100, last: 300 }, 350)).toEqual({
      first: 100,
      last: 350,
    });
  });

  it('extends the first edge for older ticks', () => {
    expect(extendPaintedRange({ first: 100, last: 300 }, 50)).toEqual({
      first: 50,
      last: 300,
    });
  });

  it('keeps the range when the tick is already inside', () => {
    const range = { first: 100, last: 300 };
    expect(extendPaintedRange(range, 200)).toBe(range);
  });

  it('never creates a range — clamp stays a no-op before the first paint', () => {
    expect(extendPaintedRange(null, 200)).toBeNull();
  });

  it('ignores non-finite times', () => {
    const range = { first: 100, last: 300 };
    expect(extendPaintedRange(range, Number.NaN)).toBe(range);
    expect(extendPaintedRange(null, Number.NaN)).toBeNull();
  });

  it('appended bars extend the painted range without full repaint', () => {
    // Full paint, then two live ticks: the newest tips stay clamp-visible.
    let range = extendPaintedRange({ first: 100, last: 300 }, 350);
    range = extendPaintedRange(range, 400);
    expect(range).toEqual({ first: 100, last: 400 });
    const tips = [{ time: 350 }, { time: 400 }, { time: 450 }];
    expect(clampPointsToPaintedRange(tips, range).map((p) => p.time)).toEqual([350, 400]);
  });
});
