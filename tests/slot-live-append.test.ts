// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from 'bun:test';
import { applyBarToSeries, appendSlotLiveBar } from '../src/chart/slot-live-append.ts';
import {
  getSlotBars,
  removeSlotRuntime,
  setSlotBars,
} from '../src/chart/chart-registry.ts';

function bar(t: number, close = 100, extra?: Partial<{ open: number; high: number; low: number; closed: boolean }>) {
  const open = extra?.open ?? close;
  return {
    time: t,
    open,
    high: extra?.high ?? close,
    low: extra?.low ?? close,
    close,
    volume: 1,
    ...(extra?.closed != null ? { closed: extra.closed } : {}),
  };
}

afterEach(() => {
  removeSlotRuntime('s1');
});

describe('applyBarToSeries', () => {
  it('updates forming tip and appends / slides', () => {
    const a = applyBarToSeries([], bar(10, 1));
    expect(a.result).toBe('appended');
    expect(a.bars).toHaveLength(1);

    const b = applyBarToSeries(a.bars, bar(10, 2));
    expect(b.result).toBe('updated');
    expect(b.bars[0]!.close).toBe(2);

    const c = applyBarToSeries(b.bars, bar(20, 3));
    expect(c.result).toBe('appended');
    expect(c.bars).toHaveLength(2);
    expect(c.bars[0]!.closed).toBe(true);

    const slid = applyBarToSeries(
      [bar(1), bar(2), bar(3)],
      bar(4, 9),
      3,
    );
    expect(slid.result).toBe('slid');
    expect(slid.bars.map((x) => x.time)).toEqual([2, 3, 4]);
  });

  it('ignores late ticks and closed-tip reopen', () => {
    const base = [bar(10, 1, { closed: true })];
    expect(applyBarToSeries(base, bar(5, 9)).result).toBe('ignored');
    expect(applyBarToSeries(base, bar(10, 9)).result).toBe('ignored');
  });
});

describe('appendSlotLiveBar', () => {
  it('writes slot cache without requiring a PaneManager', () => {
    setSlotBars('s1', [bar(1, 10)], false);
    const r = appendSlotLiveBar('s1', bar(1, 11));
    expect(r).toBe('updated');
    expect(getSlotBars('s1')[0]!.close).toBe(11);

    const r2 = appendSlotLiveBar('s1', bar(2, 12));
    expect(r2).toBe('appended');
    expect(getSlotBars('s1')).toHaveLength(2);
  });
});
