/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Copy-out: hot SAB → `Bar[]` for Lightweight Charts (HP PR 4, §6.5).
 *
 * Two contracts:
 *
 * 1. **Range** — the visible request is clipped to the hot window (cold data
 *    is paged in by PR 5, never read here) and reported as `complete` or
 *    partial; a request that misses the window, an empty window, a torn
 *    sample, or an exhausted retry budget all yield `null`, which means
 *    "keep the previous frame".
 * 2. **Paint parity** — bars that came out of the SAB are ordinary `Bar`s:
 *    feeding them through `appendLiveBar` must produce exactly the four store
 *    verdicts (`ignored` | `updated` | `appended` | `slid`) that the JSON
 *    path produces, so switching the paint source cannot change behaviour.
 */

import '../setup';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { setStore, store } from '../../src/store';
import { setManager } from '../../src/chart/manager-access';
import { appendLiveBar } from '../../src/chart/live-append';
import type { Bar } from '../../src/store/types';
import {
  allocateHotBuffer,
  BAR_FLAG_CLOSED,
  BAR_FLAG_FORMING,
  type HotBarTicks,
  type HotBuffer,
} from '../../src/hp/memory/hot-buffer';
import { copyOutBars, chartRangeToAbsolute } from '../../src/hp/paint/copy-out-lwc';

const DEFAULT_WINDOW = 10_000;

function hot(): NonNullable<ReturnType<typeof allocateHotBuffer>> {
  const buf = allocateHotBuffer();
  if (!buf) throw new Error('allocate');
  buf.priceScale = 0; // ticks are the display price — assertions read as-is
  return buf;
}

function mk(time: number, closeTicks: bigint, flags: number): HotBarTicks {
  return {
    time,
    openTicks: closeTicks,
    highTicks: closeTicks,
    lowTicks: closeTicks,
    closeTicks,
    volume: 1,
    flags,
  };
}

/** Copy one bar out of the hot window, or fail loudly instead of `!`. */
function barAt(buf: HotBuffer, fromAbs: number): Bar {
  const bar = copyOutBars(buf, { fromAbs, count: 1 })?.bars[0];
  if (!bar) throw new Error(`no hot bar copied at ${fromAbs}`);
  return bar;
}

describe('copyOutBars ranges', () => {
  it('copies a fully contained range and marks it complete', () => {
    const buf = hot();
    buf.publish([mk(60, 100n, BAR_FLAG_CLOSED), mk(120, 110n, BAR_FLAG_CLOSED)], {
      hotFromIndex: 500,
    });

    const out = copyOutBars(buf, { fromAbs: 501, count: 1 });
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.complete).toBe(true);
    expect(out.fromAbs).toBe(501);
    expect(out.bars).toHaveLength(1);
    expect(out.bars[0]?.time).toBe(120);
    expect(out.bars[0]?.close).toBe(110);
    expect(out.generation % 2).toBe(0); // never an in-flight generation
  });

  it('clips a partial overlap and reports complete: false', () => {
    const buf = hot();
    buf.publish([mk(60, 100n, BAR_FLAG_CLOSED), mk(120, 110n, BAR_FLAG_CLOSED)], {
      hotFromIndex: 100,
    });

    // Requests stick out of the hot window on both sides.
    const left = copyOutBars(buf, { fromAbs: 99, count: 5 });
    expect(left?.complete).toBe(false);
    expect(left?.fromAbs).toBe(100);
    expect(left?.bars.map((b) => b.time)).toEqual([60, 120]);

    const right = copyOutBars(buf, { fromAbs: 101, count: 50 });
    expect(right?.complete).toBe(false);
    expect(right?.bars.map((b) => b.time)).toEqual([120]); // only the tail overlaps
  });

  it('returns null when the request misses the hot window (cold = PR 5)', () => {
    const buf = hot();
    buf.publish([mk(60, 100n, BAR_FLAG_CLOSED)], { hotFromIndex: 100 });
    expect(copyOutBars(buf, { fromAbs: 0, count: 10 })).toBeNull();
    expect(copyOutBars(buf, { fromAbs: 101, count: 10 })).toBeNull();
  });

  it('returns null for an empty window or a malformed request', () => {
    const buf = hot();
    expect(copyOutBars(buf, { fromAbs: 0, count: 1 })).toBeNull();
    buf.publish([mk(60, 100n, BAR_FLAG_CLOSED)]);
    expect(copyOutBars(buf, { fromAbs: 0, count: 0 })).toBeNull();
    expect(copyOutBars(buf, { fromAbs: 0, count: -5 })).toBeNull();
    expect(copyOutBars(buf, { fromAbs: Number.NaN, count: 1 })).toBeNull();
    expect(copyOutBars(buf, { fromAbs: 0, count: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('truncates a fractional count to whole bars', () => {
    const buf = hot();
    buf.publish([mk(60, 100n, BAR_FLAG_CLOSED), mk(120, 110n, BAR_FLAG_CLOSED)]);
    const out = copyOutBars(buf, { fromAbs: 0, count: 1.9 });
    expect(out?.bars).toHaveLength(1); // whole bars only, never a partial one
    expect(out?.complete).toBe(true); // the truncated request itself is covered
  });

  it('returns null while a write is in flight, then the committed window', () => {
    const buf = hot();
    buf.publish([mk(60, 100n, BAR_FLAG_CLOSED)]);
    expect(copyOutBars(buf, { fromAbs: 0, count: 1 })?.bars[0]?.close).toBe(100);

    // Open the other slot with a different marker and never commit: the
    // reader must get `null` (keep the last frame), never a mixed candle.
    const slot = buf.beginWrite();
    buf.writeBar(slot, 0, mk(60, 999n, BAR_FLAG_CLOSED));
    expect(copyOutBars(buf, { fromAbs: 0, count: 1 }, 2)).toBeNull();

    buf.commit({ hotCount: 1 });
    expect(copyOutBars(buf, { fromAbs: 0, count: 1 })?.bars[0]?.close).toBe(999);
  });

  it('honours the retry budget instead of spinning forever', () => {
    const buf = hot();
    buf.publish([mk(60, 100n, BAR_FLAG_CLOSED)]);
    expect(copyOutBars(buf, { fromAbs: 0, count: 1 }, 0)).toBeNull();
  });
});

describe('copy-out bars through appendLiveBar', () => {
  let appended: Bar[] = [];

  const paintManager = {
    appendBar: (b: Bar) => appended.push(b),
    getPane: () => undefined,
    getAllPanes: () => [],
  };

  beforeEach(() => {
    appended = [];
    setStore('bars', []);
    setStore('rollingWindowBars', DEFAULT_WINDOW);
    setManager(paintManager as never);
  });

  // The store is shared across test files in one process: a leaked rolling
  // window would slice the bars of every later test.
  afterEach(() => {
    setManager(undefined);
    setStore('bars', []);
    setStore('rollingWindowBars', DEFAULT_WINDOW);
  });

  it('produces appended, updated, ignored and slid from SAB data alone', () => {
    const buf = hot();
    const forming = (time: number, closeTicks: bigint): HotBarTicks =>
      mk(time, closeTicks, BAR_FLAG_FORMING);
    const closed = (time: number, closeTicks: bigint): HotBarTicks =>
      mk(time, closeTicks, BAR_FLAG_CLOSED);

    buf.publish([closed(60, 100n), closed(120, 200n), forming(180, 300n)], {
      hotFromIndex: 0,
    });

    // 1. A fresh bar from the shared window enters the store.
    const first = copyOutBars(buf, { fromAbs: 0, count: 1 });
    expect(first?.bars).toHaveLength(1);
    expect(appendLiveBar(barAt(buf, 0))).toBe('appended');
    expect(store.bars).toHaveLength(1);

    // 2. The forming tip lands as a normal append.
    expect(appendLiveBar(barAt(buf, 2))).toBe('appended');
    expect(store.bars).toHaveLength(2);

    // 3. A bar older than the tip is stale — ignored, nothing painted.
    appended = [];
    expect(appendLiveBar(barAt(buf, 1))).toBe('ignored');
    expect(appended).toHaveLength(0);
    expect(store.bars).toHaveLength(2);

    // 4. A new forming tip with a moved close updates in place (incremental
    //    manager.appendBar path — the reason the verdict must round-trip).
    buf.publish([closed(60, 100n), closed(120, 200n), forming(180, 350n)], {
      hotFromIndex: 0,
    });
    appended = [];
    const moved = copyOutBars(buf, { fromAbs: 2, count: 1 });
    expect(moved?.bars[0]?.close).toBe(350);
    expect(appendLiveBar(barAt(buf, 2))).toBe('updated');
    expect(appended).toHaveLength(1);
    expect(store.bars.at(-1)?.close).toBe(350);

    // 5. Past the rolling window the head slides and the caller repaints all.
    setStore('rollingWindowBars', 3);
    buf.publish(
      [
        closed(60, 100n),
        closed(120, 200n),
        forming(180, 350n),
        closed(240, 400n),
        forming(300, 450n),
      ],
      { hotFromIndex: 0 },
    );
    appended = [];
    expect(appendLiveBar(barAt(buf, 3))).toBe('appended');
    expect(store.bars).toHaveLength(3);
    // Cap not yet sliding the head — a new time slot is series.update.
    expect(appended).toHaveLength(1);
    appended = [];
    expect(appendLiveBar(barAt(buf, 4))).toBe('slid');
    expect(appended).toHaveLength(0); // a slide repaints, it is not incremental
    expect(store.bars).toHaveLength(3);
    expect(store.bars[0]?.time).toBe(180); // head moved: 60 and 120 are gone
  });
});

describe('chartRangeToAbsolute — chart index to ring absolute (§9.2)', () => {
  // Ring [900, 1000) is the tail window of a 1000-bar chart: chart index
  // `i` is absolute `900 + i`.
  it('maps the tail window by identity', () => {
    expect(chartRangeToAbsolute(1000, 900, 100, 900, 100)).toEqual({
      fromAbs: 900,
      count: 100,
    });
    expect(chartRangeToAbsolute(1000, 900, 100, 950, 10)).toEqual({
      fromAbs: 950,
      count: 10,
    });
  });

  it('clips the right margin (LWC slots with no bars)', () => {
    expect(chartRangeToAbsolute(1000, 900, 100, 990, 50)).toEqual({
      fromAbs: 990,
      count: 10,
    });
  });

  it('clips a head underflow to bar 0', () => {
    expect(chartRangeToAbsolute(1000, 900, 100, -5, 10)).toEqual({
      fromAbs: 0,
      count: 5,
    });
  });

  it('returns null past the tail, for empty windows, or degenerate ranges', () => {
    expect(chartRangeToAbsolute(1000, 900, 100, 1000, 10)).toBeNull();
    expect(chartRangeToAbsolute(1000, 900, 100, 0, 0)).toBeNull();
    expect(chartRangeToAbsolute(0, 0, 0, 0, 10)).toBeNull();
    // The ring can never hold more than the chart (identity would lie).
    expect(chartRangeToAbsolute(50, 0, 100, 0, 10)).toBeNull();
    expect(chartRangeToAbsolute(1000, 900, 100, Number.NaN, 10)).toBeNull();
  });
});
