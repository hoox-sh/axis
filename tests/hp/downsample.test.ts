/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Cold-viewport downsampling (HP PR 5 follow-up, §9.2 conflation).
 *
 * The contract: one bin per pixel column over `[fromIdx, fromIdx + count)`
 * with no gaps — `open` is the first open, `high`/`low` the column extremes,
 * `close` the last close, `volume` the column sum, `x` the bin center in
 * viewport-relative slots (fractional when a bin spans several slots), and
 * the forming flag comes from the bin's last bar. The clip keeps the
 * viewport inside the chart (LWC's right margin holds no bars).
 */

import '../setup';
import { describe, expect, it } from 'bun:test';
import { BAR_FLAG_CLOSED, BAR_FLAG_FORMING } from '../../src/hp/paint/visual-attr';
import { clipViewportToChart, downsampleToPixelColumns } from '../../src/hp/paint/downsample';
import type { Bar } from '../../src/store/types';

function bar(time: number, ohlc: Partial<Bar> = {}): Bar {
  return { time, open: 100, high: 101, low: 99, close: 100, volume: 1, ...ohlc };
}

/** `count` one-minute bars, close running 100 + i. */
function bars(count: number, startTime = 0): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < count; i++) {
    out.push(
      bar(startTime + i * 60, { open: 100 + i, high: 102 + i, low: 98 + i, close: 101 + i }),
    );
  }
  return out;
}

describe('clipViewportToChart', () => {
  it('passes a fully inside viewport through', () => {
    expect(clipViewportToChart(1000, 900, 100)).toEqual({ fromIdx: 900, count: 100 });
  });

  it('clips LWCs right margin (no bars past the tail)', () => {
    expect(clipViewportToChart(1000, 990, 50)).toEqual({ fromIdx: 990, count: 10 });
  });

  it('clips a head underflow to bar 0', () => {
    expect(clipViewportToChart(1000, -5, 10)).toEqual({ fromIdx: 0, count: 5 });
  });

  it('returns null past the tail, for empty windows, or degenerate ranges', () => {
    expect(clipViewportToChart(1000, 1000, 10)).toBeNull();
    expect(clipViewportToChart(1000, 0, 0)).toBeNull();
    expect(clipViewportToChart(0, 0, 10)).toBeNull();
    expect(clipViewportToChart(1000, 0, Number.NaN)).toBeNull();
  });
});

describe('downsampleToPixelColumns', () => {
  it('maps 1:1 with integer slots when the viewport fits the pixels', () => {
    const out = downsampleToPixelColumns(bars(20), 10, 4, 100, 10);
    expect(out).toHaveLength(4);
    expect(out.map((b) => b.x)).toEqual([0, 1, 2, 3]);
    expect(out[2]?.close).toBe(113);
  });

  it('bins OHLCV with first-open / extremes / last-close / summed volume', () => {
    // 10 bars into 2 bins: [0,5) and [5,10).
    const out = downsampleToPixelColumns(bars(10), 0, 10, 2, 0);
    expect(out).toHaveLength(2);
    const [first, second] = out;
    expect(first?.open).toBe(100); // first open of bin 0
    expect(first?.high).toBe(106); // max high of bars 0..4 (102+4)
    expect(first?.low).toBe(98); // min low of bars 0..4 (98+0)
    expect(first?.close).toBe(105); // last close of bin 0 (101+4)
    expect(first?.volume).toBe(5);
    expect(first?.x).toBe(2); // center of slots 0..4
    expect(second?.open).toBe(105);
    expect(second?.close).toBe(110);
    expect(second?.x).toBe(7); // center of slots 5..9
  });

  it('centers fractional bins in viewport-relative slots', () => {
    // 3 bars into 2 bins: [10,11) and [11,13).
    const out = downsampleToPixelColumns(bars(20), 10, 3, 2, 10);
    expect(out).toHaveLength(2);
    expect(out[0]?.x).toBe(0);
    expect(out[1]?.x).toBe(1.5);
  });

  it('offsets x by the viewport base (both in chart slots)', () => {
    const out = downsampleToPixelColumns(bars(20), 10, 2, 2, 8);
    expect(out).toHaveLength(2);
    expect(out.map((b) => b.x)).toEqual([2, 3]); // slots 10,11 minus base 8
    expect(out[0]?.close).toBe(111);
  });

  it('takes the forming flag from the bins last bar', () => {
    const bs = bars(4);
    bs[3] = bar(180, { closed: false });
    const out = downsampleToPixelColumns(bs, 0, 4, 1, 0);
    expect(out).toHaveLength(1);
    expect(out[0]?.flags).toBe(BAR_FLAG_FORMING);
    expect(out[0]?.close).toBe(100); // last close still used
  });

  it('keeps the closed flag when every bar is closed', () => {
    const out = downsampleToPixelColumns(bars(4), 0, 4, 1, 0);
    expect(out[0]?.flags).toBe(BAR_FLAG_CLOSED);
  });

  it('skips holes (missing bars) instead of emitting zero candles', () => {
    const bs = bars(4);
    bs[1] = undefined as unknown as Bar;
    const out = downsampleToPixelColumns(bs, 0, 4, 2, 0);
    // Bin [0,2): only bar 0 seen; bin [2,4): bars 2,3.
    expect(out).toHaveLength(2);
    expect(out[0]?.close).toBe(101);
    expect(out[1]?.close).toBe(104);
  });

  it('returns [] for empty, degenerate, or out-of-range requests', () => {
    expect(downsampleToPixelColumns([], 0, 4, 4, 0)).toEqual([]);
    expect(downsampleToPixelColumns(bars(4), 0, 0, 4, 0)).toEqual([]);
    expect(downsampleToPixelColumns(bars(4), 0, 4, 0, 0)).toEqual([]);
    expect(downsampleToPixelColumns(bars(4), -1, 4, 4, 0)).toEqual([]);
    expect(downsampleToPixelColumns(bars(4), 0, Number.NaN, 4, 0)).toEqual([]);
  });
});
