// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Line-break points for missing-data gaps.
 *
 * Lightweight Charts spans a whitespace (`na`) row with a straight connector.
 * When the engine's bar axis skipped bars, that connector is drawn through
 * data the script never had — the "autoconnected ends" across a hole in the
 * indicator timeline. The primitive must break there, while still spanning
 * script-produced `na` (Pine `plot.style_line` semantics).
 */

import { describe, expect, it } from 'bun:test';

import {
  MIN_DATA_HOLE_BARS,
  dataHoleTimes,
  gapAwareLineBreakPoints,
} from '../src/chart/line-break-primitive';

describe('gapAwareLineBreakPoints', () => {
  it('breaks the stroke at every gap time', () => {
    const points = gapAwareLineBreakPoints(
      [
        { time: 100, value: 1 },
        { time: 200, value: 2 },
        { time: 300 },
        { time: 400 },
        { time: 500, value: 5 },
      ],
      new Set([300, 400]),
    );
    expect(points).toEqual([
      { time: 100, value: 1 },
      { time: 200, value: 2 },
      { time: 300 },
      { time: 400 },
      { time: 500, value: 5 },
    ]);
  });

  it('interpolates script na so a plain line keeps spanning it', () => {
    const points = gapAwareLineBreakPoints(
      [
        { time: 100, value: 0 },
        { time: 200 },
        { time: 300 },
        { time: 400, value: 30 },
        { time: 500, value: 40 },
        { time: 600 },
      ],
      new Set([500]),
    );
    // na 200/300 sit between 0 and 30 → straight segment, exactly as LWC draws.
    expect(points[0]).toEqual({ time: 100, value: 0 });
    expect(points[1]!.value).toBeCloseTo(10, 6);
    expect(points[2]!.value).toBeCloseTo(20, 6);
    expect(points[3]).toEqual({ time: 400, value: 30 });
    // A gap breaks, so the trailing na cannot be bridged.
    expect(points[4]).toEqual({ time: 500 });
    expect(points[5]).toEqual({ time: 600 });
  });

  it('does not bridge a script-na run across a gap', () => {
    const points = gapAwareLineBreakPoints(
      [{ time: 100, value: 0 }, { time: 200 }, { time: 300 }, { time: 400, value: 30 }],
      new Set([300]),
    );
    // 200 has a finite neighbour before it and a gap after → stays blank.
    expect(points[1]).toEqual({ time: 200 });
  });

  it('returns nothing when the series has no gap', () => {
    expect(
      gapAwareLineBreakPoints(
        [{ time: 100, value: 1 }, { time: 200 }, { time: 300, value: 3 }],
        new Set([999]),
      ),
    ).toEqual([]);
    expect(gapAwareLineBreakPoints([], new Set([1]))).toEqual([]);
    expect(gapAwareLineBreakPoints([{ time: 1, value: 1 }], new Set())).toEqual([]);
  });
});

describe('dataHoleTimes (no engine axis)', () => {
  const series = (values: Array<number | undefined>) =>
    values.map((value, i) => (value == null ? { time: 1000 + i * 60 } : { time: 1000 + i * 60, value }));

  it('flags a long internal blank stretch as missing data', () => {
    const values: Array<number | undefined> = [1, 2];
    for (let i = 0; i < MIN_DATA_HOLE_BARS; i++) values.push(undefined);
    values.push(3, 4);
    const times = dataHoleTimes(series(values));
    expect(times).toHaveLength(MIN_DATA_HOLE_BARS);
    expect(times[0]).toBe(1000 + 2 * 60);
  });

  it('keeps a short condition gap spanning', () => {
    const values: Array<number | undefined> = [1, 2, undefined, undefined, 5, 6];
    expect(dataHoleTimes(series(values))).toEqual([]);
  });

  it('ignores warmup and a not-yet-evaluated tail', () => {
    const values: Array<number | undefined> = [];
    for (let i = 0; i < 20; i++) values.push(undefined);
    values.push(1, 2);
    for (let i = 0; i < 20; i++) values.push(undefined);
    expect(dataHoleTimes(series(values))).toEqual([]);
  });
});
