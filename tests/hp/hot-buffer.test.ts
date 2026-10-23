/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Hot double-buffer (HP PR 4): layout budget, seqlock read/write, OOM clamp,
 * and the main-thread rAF generation poll.
 *
 * The tearing contract under test: while a write is in flight the generation
 * is odd, so no reader ever receives a mix of the previous and the next
 * window — it gets `null` (keep the last frame) instead.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { HOT_CAP } from '../../src/hp/axb1/constants';
import { HP_RUNG_SESSION_KEY } from '../../src/hp/feature-flag';
import {
  allocateHotBuffer,
  BAR_FLAG_CLOSED,
  barToTicks,
  HotBuffer,
  type HotBarTicks,
} from '../../src/hp/memory/hot-buffer';
import {
  computeHotLayout,
  HOT_COLUMN_BYTES,
  HOT_COLUMNS,
  HP_CONTROL_BYTES,
  HP_SECTION_ALIGN,
} from '../../src/hp/memory/layout';
import { HpControlBlock } from '../../src/hp/memory/control-block';
import { subscribeGeneration } from '../../src/hp/sync/raf-poll';
import { copyOutBars, copyOutTail } from '../../src/hp/paint/copy-out-lwc';

function markerBars(marker: bigint, count: number, startTime = 60): HotBarTicks[] {
  const out: HotBarTicks[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      time: startTime + i * 60,
      openTicks: marker,
      highTicks: marker,
      lowTicks: marker,
      closeTicks: marker,
      volume: 1,
      flags: BAR_FLAG_CLOSED,
    });
  }
  return out;
}

afterEach(() => {
  const g = globalThis as { sessionStorage?: unknown };
  delete g.sessionStorage;
});

describe('computeHotLayout', () => {
  test('is O(HOT_CAP): 5_120 bars × 2 slots, every section aligned', () => {
    expect(HOT_CAP).toBe(5120);
    expect(HOT_CAP % 64).toBe(0);

    const layout = computeHotLayout();
    expect(layout.cap).toBe(HOT_CAP);
    expect(layout.controlOffset).toBe(0);
    expect(layout.headerOffset).toBe(HP_CONTROL_BYTES);
    expect(layout.slots).toHaveLength(2);

    for (const slot of layout.slots) {
      for (const col of HOT_COLUMNS) {
        expect(slot[col] % HP_SECTION_ALIGN).toBe(0);
      }
      // The whole row fits: time + 4×i64 + f64 + flags per bar.
      const rowBytes = Object.values(HOT_COLUMN_BYTES).reduce((a, b) => a + b, 0);
      expect(layout.byteLength).toBeGreaterThan(rowBytes * HOT_CAP);
    }

    // Sections of slot 0 end exactly where slot 1 begins (no overlap).
    const [a, b] = layout.slots;
    const lastCol = HOT_COLUMNS[HOT_COLUMNS.length - 1];
    if (!a || !lastCol || !b) throw new Error('layout');
    expect(a[lastCol] + HOT_COLUMN_BYTES[lastCol] * HOT_CAP).toBeLessThanOrEqual(b.time_s);

    // The whole double-buffer stays far below 1 MiB — a naive 2 × 200k bar
    // allocation is what mobile WebViews reject (§6.6).
    expect(layout.byteLength).toBeLessThan(1024 * 1024);
  });

  test('rejects a nonsense capacity', () => {
    expect(() => computeHotLayout(0)).toThrow(RangeError);
    expect(() => computeHotLayout(1.5)).toThrow(RangeError);
  });
});

describe('HotBuffer allocate', () => {
  test('allocates the exact layout byte length with a valid control block', () => {
    const buf = allocateHotBuffer();
    expect(buf).not.toBeNull();
    if (!buf) throw new Error('allocate');
    expect(buf.sab.byteLength).toBe(computeHotLayout().byteLength);
    expect(buf.control.valid).toBe(true);
    expect(buf.control.generation).toBe(0);
    expect(buf.priceScale).toBe(8); // fresh buffer defaults to 10^8
  });

  test('a RangeError from the allocator drops the tab to rung 1 for the session', () => {
    const mem = new Map<string, string>();
    const g = globalThis as { sessionStorage?: unknown };
    g.sessionStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };

    const buf = allocateHotBuffer(HOT_CAP, () => {
      throw new RangeError('SAB allocation failed');
    });
    expect(buf).toBeNull();
    expect(mem.get(HP_RUNG_SESSION_KEY)).toBe('1'); // axis.hp.rung = '1' → HP-1
  });

  test('a factory that returns nothing is a failure, not a crash', () => {
    const buf = allocateHotBuffer(HOT_CAP, () => null as unknown as SharedArrayBuffer);
    expect(buf).toBeNull();
  });

  test('control block refuses a misaligned or short view', () => {
    expect(() => new HpControlBlock(new SharedArrayBuffer(8), 0)).toThrow(RangeError);
    expect(() => new HpControlBlock(new SharedArrayBuffer(256), 4)).toThrow(RangeError);
  });
});

describe('HotBuffer seqlock', () => {
  test('publish then read round-trips ticks into float64 bars', () => {
    const buf = allocateHotBuffer();
    if (!buf) throw new Error('allocate');
    buf.priceScale = 2;

    buf.publish(markerBars(10_500n, 3), { hotFromIndex: 100, closedUpto: 102, seq: 7 });

    expect(buf.control.hotCount).toBe(3);
    expect(buf.control.hotFromIndex).toBe(100);
    expect(buf.control.closedUpto).toBe(102);
    expect(buf.control.seq).toBe(7);
    expect(buf.control.generation % 2).toBe(0);

    const out = copyOutBars(buf, { fromAbs: 100, count: 3 });
    expect(out?.complete).toBe(true);
    expect(out?.generation).toBe(buf.control.generation);
    expect(out?.bars.map((b) => b.close)).toEqual([105, 105, 105]);
    expect(out?.bars.every((b) => b.closed === true)).toBe(true);
  });

  test('a write in flight is invisible: readers get null, never a mixed window', () => {
    const buf = allocateHotBuffer();
    if (!buf) throw new Error('allocate');
    buf.priceScale = 0; // ticks are the display price, so markers read as-is

    buf.publish(markerBars(100n, 3));
    expect(copyOutBars(buf, { fromAbs: 0, count: 3 })?.bars.map((b) => b.close)).toEqual([
      100, 100, 100,
    ]);

    // Open the *other* slot with a different marker and never commit.
    const slot = buf.beginWrite();
    markerBars(200n, 3).forEach((bar, i) => {
      buf.writeBar(slot, i, bar);
    });
    expect(buf.control.generation & 1).toBe(1);
    expect(buf.control.sample()).toBeNull();
    expect(copyOutBars(buf, { fromAbs: 0, count: 3 })).toBeNull();

    buf.commit({ hotCount: 3 });
    expect(buf.control.sample()?.slot).toBe(slot);
    expect(copyOutBars(buf, { fromAbs: 0, count: 3 })?.bars.map((b) => b.close)).toEqual([
      200, 200, 200,
    ]);
  });

  test('alternating publishes never yield a torn sample', () => {
    const buf = allocateHotBuffer();
    if (!buf) throw new Error('allocate');
    buf.priceScale = 0; // ticks are the display price, so markers read as-is

    for (let i = 0; i < 20; i++) {
      const marker = i % 2 === 0 ? 100n : 200n;
      buf.publish(markerBars(marker, 4));
      const out = copyOutBars(buf, { fromAbs: 0, count: 4 });
      expect(out).not.toBeNull();
      const closes = new Set(out?.bars.map((b) => b.close));
      expect(closes.size).toBe(1); // every bar came from the same slot
      expect(closes.has(Number(marker))).toBe(true);
    }
  });

  test('barToTicks keeps sub-float32 prices exact', () => {
    expect(
      barToTicks(
        {
          time: 60,
          open: 0.00000012,
          high: 0.00000012,
          low: 0.00000012,
          close: 0.00000012,
          volume: 1,
        },
        8,
      ).openTicks,
    ).toBe(12n);
  });

  test('epoch bumps on a symbol switch and never reuses the old ticks', () => {
    const buf = allocateHotBuffer();
    if (!buf) throw new Error('allocate');
    const first = buf.bumpEpoch();
    const second = buf.bumpEpoch();
    expect(second).toBe(first + 1);
    expect(buf.epoch).toBe(second);
  });
});

describe('subscribeGeneration (rAF poll)', () => {
  test('paints even generations only, once each', () => {
    const buf = allocateHotBuffer();
    if (!buf) throw new Error('allocate');

    let id = 0;
    const pending = new Map<number, (t: number) => void>();
    const raf = (cb: (t: number) => void): number => {
      id += 1;
      pending.set(id, cb);
      return id;
    };
    const cancelRaf = (h: number): void => void pending.delete(h);
    const frame = (): void => {
      const cbs = [...pending.values()];
      pending.clear();
      for (const cb of cbs) cb(0);
    };

    const seen: number[] = [];
    const stop = subscribeGeneration(buf.control, (g) => seen.push(g), { raf, cancelRaf });

    frame(); // generation 0 (even, new) → paint
    expect(seen).toEqual([0]);
    frame(); // unchanged → no repaint
    expect(seen).toEqual([0]);

    buf.beginWrite(); // odd → the frame must be skipped
    frame();
    expect(seen).toEqual([0]);
    buf.commit(); // generation 2
    frame();
    expect(seen).toEqual([0, 2]);

    stop();
    expect(pending.size).toBe(0); // the frame was cancelled
    frame();
    expect(seen).toEqual([0, 2]);
  });
});

describe('copyOutTail', () => {
  test('copies the newest bars of the hot window', () => {
    const buf = allocateHotBuffer();
    if (!buf) throw new Error('allocate');
    buf.publish(markerBars(100n, 5), { hotFromIndex: 0 });
    const tail = copyOutTail(buf, 3);
    expect(tail?.bars).toHaveLength(3);
    expect(tail?.fromAbs).toBe(2);
    expect(tail?.bars.map((b) => b.time)).toEqual([180, 240, 300]);
  });

  test('an empty window copies nothing', () => {
    const buf = allocateHotBuffer();
    if (!buf) throw new Error('allocate');
    expect(copyOutTail(buf, 3)).toBeNull();
    expect(copyOutBars(buf, { fromAbs: 0, count: 1 })).toBeNull();
  });
});

describe('HotBuffer helpers', () => {
  test('publish refuses more bars than the window holds', () => {
    const buf = new HotBuffer(
      new SharedArrayBuffer(computeHotLayout(4).byteLength),
      computeHotLayout(4),
    );
    expect(() => buf.publish(markerBars(1n, 5))).toThrow(RangeError);
    buf.publish(markerBars(1n, 4));
    expect(buf.control.hotCount).toBe(4);
  });

  test('readTicks keeps the canonical integers the GPU/calc sides need', () => {
    const buf = allocateHotBuffer();
    if (!buf) throw new Error('allocate');
    buf.priceScale = 4;
    buf.publish(markerBars(1_000n, 1)); // 0.1 at scale 4 → 1000 ticks
    const ticks = buf.readTicks(buf.control.publishedSlot, 0); // publish flipped to slot 1
    expect(ticks.closeTicks).toBe(1_000n);
    expect(ticks.flags & BAR_FLAG_CLOSED).toBe(BAR_FLAG_CLOSED);
  });
});
