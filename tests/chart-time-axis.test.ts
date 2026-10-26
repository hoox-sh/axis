// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Chart time-axis invariants.
 *
 * The library's shared time scale is the **union** of every series' rows and
 * every renderer asks its own series for the bar at the rendered index. A
 * series that holds a bar the candles do not have (or misses one they do)
 * therefore fails the render with `Value is null` — with no clue about which
 * series did it.
 *
 * These tests pin the three guards that keep the axes in step:
 *
 * 1. the engine's live snapshot **merges** into the chart window (it is a
 *    short tail — a replace threw the freshly loaded dataset away),
 * 2. the volume series carries the **same** bars as the candles,
 * 3. the co-painted series are projected onto the **candle axis**.
 */

import { describe, expect, it } from 'bun:test';

import { mapBarsToVolumeData } from '../src/chart/heavy-data';
import { mapBarsToPriceData } from '../src/chart/chart-type';
import {
  clampPointsToPaintedRange,
  projectToCandleAxis,
} from '../src/chart/series-sanitize';
import { mergeEngineSnapshot, snapshotMatchesChart } from '../src/streams/stream-live';
import type { Bar } from '../src/store/types';

function bar(time: number, extra: Partial<Bar> = {}): Bar {
  return {
    time,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 10,
    ...extra,
  };
}

describe('mergeEngineSnapshot', () => {
  it('keeps the chart window when the engine snapshot is a short tail', () => {
    // The chart holds 20k bars from the user's own load; the engine's live
    // series is a ~500 bar tail. A replace threw the load away.
    const chart = Array.from({ length: 2000 }, (_, i) => bar(i * 300));
    const snapshot = Array.from({ length: 500 }, (_, i) => bar(1500 * 300 + i * 300));

    const merged = mergeEngineSnapshot(chart, snapshot);

    expect(merged.length).toBe(2000);
    expect(merged[0]!.time).toBe(0);
    expect(merged[merged.length - 1]!.time).toBe(1999 * 300);
  });

  it("fills the chart's holes with the engine's rows", () => {
    const chart = [bar(0), bar(300), bar(1200)];
    const snapshot = [bar(600), bar(900)];

    const merged = mergeEngineSnapshot(chart, snapshot);

    expect(merged.map((b) => b.time)).toEqual([0, 300, 600, 900, 1200]);
  });

  it('extends the tail when the engine is ahead of the chart', () => {
    const chart = [bar(0), bar(300)];
    const snapshot = [bar(600)];

    const merged = mergeEngineSnapshot(chart, snapshot);

    expect(merged.map((b) => b.time)).toEqual([0, 300, 600]);
  });

  it('keeps the chart own bar when both cover the same slot', () => {
    const chart = [bar(0, { close: 1 })];
    const snapshot = [bar(0, { close: 2 })];

    const merged = mergeEngineSnapshot(chart, snapshot);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.close).toBe(1);
  });

  it('is a no-op for an empty snapshot', () => {
    const chart = [bar(0), bar(300)];
    expect(mergeEngineSnapshot(chart, [])).toBe(chart);
  });

  it('snapshotMatchesChart is true when merge added no times', () => {
    const chart = [bar(0), bar(300), bar(600)];
    const merged = mergeEngineSnapshot(chart, [bar(300, { close: 9 })]);
    expect(snapshotMatchesChart(chart, merged)).toBe(true);
  });

  it('snapshotMatchesChart is false when the engine filled a hole', () => {
    const chart = [bar(0), bar(600)];
    const merged = mergeEngineSnapshot(chart, [bar(300)]);
    expect(snapshotMatchesChart(chart, merged)).toBe(false);
  });
});

describe('volume series parity', () => {
  it('skips exactly the bars the candle series skips', () => {
    // A bar with a null high/low is not paintable as a candle. When the
    // volume kept it, the volume series held a bar time the candles did not
    // have — the shared time scale grew a slot the candles could not render.
    const bars: Bar[] = [
      bar(0),
      bar(300, { high: Number.NaN }),
      bar(600, { low: Number.NaN }),
      bar(900),
    ];

    const candles = mapBarsToPriceData(bars, 'candles');
    const volume = mapBarsToVolumeData(bars, { up: '#0f0', down: '#f00' });

    expect(candles.map((c) => c.time)).toEqual([0, 900]);
    expect(volume.map((v) => v.time)).toEqual([0, 900]);
  });
});

describe('clampPointsToPaintedRange (allowed times)', () => {
  it('drops rows at times the candles do not hold', () => {
    const rows = [
      { time: 100, value: 1 },
      { time: 200, value: 2 },
      { time: 300, value: 3 },
    ];

    const kept = clampPointsToPaintedRange(rows, { first: 100, last: 300 }, new Set([100, 300]));

    expect(kept).toEqual([
      { time: 100, value: 1 },
      { time: 300, value: 3 },
    ]);
  });

  it('keeps every in-range row when no allowed set is given', () => {
    const rows = [{ time: 100 }, { time: 250 }];
    expect(clampPointsToPaintedRange(rows, { first: 100, last: 300 })).toHaveLength(2);
  });
});

describe('projectToCandleAxis', () => {
  it('lands exactly on the candle axis', () => {
    const rows = [
      { time: 100, value: 1 },
      { time: 300, value: 3 },
    ];

    const projected = projectToCandleAxis(rows, [100, 200, 300], (time) => ({ time }));

    expect(projected).toEqual([
      { time: 100, value: 1 },
      { time: 200 },
      { time: 300, value: 3 },
    ]);
  });

  it('drops rows outside the axis', () => {
    const rows = [
      { time: 50, value: 1 },
      { time: 100, value: 2 },
      { time: 400, value: 3 },
    ];

    const projected = projectToCandleAxis(rows, [100], (time) => ({ time }));

    expect(projected).toEqual([{ time: 100, value: 2 }]);
  });

  it('passes the rows through when there is no axis yet', () => {
    const rows = [{ time: 100, value: 1 }];
    expect(projectToCandleAxis(rows, null, (time) => ({ time }))).toBe(rows);
  });
});
