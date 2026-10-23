/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Viewport paging (HP PR 5, §9.2): extend / jump / replace, the O(HOT_CAP)
 * memory contract, live-tip survival across a page replace, the columnar
 * cold store + `bars-cache` adapter, and the rung-1 fallback.
 *
 * The paging contract under test: panning into cold history copies **one
 * page** into the single-buffered page slot — a far jump replaces that page,
 * the SAB never grows, and the hot window / forming tip are untouched while
 * it happens.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { _resetBarsCacheForTests, putCachedBars } from '../../src/data/bars-cache';
import { HOT_CAP } from '../../src/hp/axb1/constants';
import { HP_RUNG_SESSION_KEY } from '../../src/hp/feature-flag';
import { ColdStore, hydrateColdFromCache } from '../../src/hp/memory/cold-store';
import { allocateHotBuffer, BAR_FLAG_CLOSED, barToTicks } from '../../src/hp/memory/hot-buffer';
import { computeHotLayout, HP_SECTION_ALIGN, HOT_COLUMNS } from '../../src/hp/memory/layout';
import {
  copyOutPageFromCold,
  planViewportPage,
  publishBarPage,
  publishViewportPage,
} from '../../src/hp/memory/page-buffer';
import {
  copyOutBars,
  copyOutPage,
  copyOutTail,
  copyOutViewport,
} from '../../src/hp/paint/copy-out-lwc';
import type { Bar } from '../../src/store/types';

function bar(time: number, close = 100): Bar {
  return { time, open: close, high: close + 1, low: close - 1, close, volume: 1 };
}

/** `count` closed bars, one per minute from `startTime`. */
function bars(count: number, startTime = 0): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < count; i++) out.push(bar(startTime + i * 60, 100 + i));
  return out;
}

function mustAllocate(cap?: number): NonNullable<ReturnType<typeof allocateHotBuffer>> {
  const buf = cap === undefined ? allocateHotBuffer() : allocateHotBuffer(cap);
  if (!buf) throw new Error('allocate');
  return buf;
}

describe('planViewportPage', () => {
  const hot = { fromIndex: 92, count: 8 };

  test('a request inside the hot window is acked — cold ranges are paged', () => {
    expect(planViewportPage({ fromAbs: 94, count: 4 }, hot)).toEqual({ action: 'ack' });
    expect(planViewportPage({ fromAbs: 0, count: 4 }, hot)).toEqual({
      action: 'replace',
      fromAbs: 0,
      count: 4,
      clipped: false,
    });
  });

  test('a viewport back inside hot retires the stale page', () => {
    expect(planViewportPage({ fromAbs: 92, count: 8 }, hot, { pageActive: true })).toEqual({
      action: 'release',
    });
  });

  test('a jump into cold is clipped to one page — never O(N)', () => {
    // "Fit content" (100k bars) that *overlaps* hot is acked — §9.2 forbids
    // paging the whole series; the cold gap is a conflation task (HP-3).
    const big = { fromIndex: 95_000, count: 5_000 };
    expect(planViewportPage({ fromAbs: 0, count: 100_000 }, big)).toEqual({ action: 'ack' });
    // A jump fully inside cold asks for exactly one page of capacity.
    expect(planViewportPage({ fromAbs: 0, count: 40_000 }, big)).toEqual({
      action: 'replace',
      fromAbs: 0,
      count: HOT_CAP,
      clipped: true,
    });
  });

  test('malformed requests are acked, not paged', () => {
    for (const req of [
      { fromAbs: Number.NaN, count: 10 },
      { fromAbs: 0, count: 0 },
      { fromAbs: 0, count: -5 },
      { fromAbs: Number.POSITIVE_INFINITY, count: 10 },
    ]) {
      expect(planViewportPage(req, hot, { pageActive: true })).toEqual({ action: 'ack' });
    }
  });
});

describe('page replace in the SAB', () => {
  // Small cap so the clipping cases are cheap; the default cap is covered by
  // the memory-contract test below.
  const CAP = 16;

  function scene(): {
    buf: ReturnType<typeof mustAllocate>;
    cold: ColdStore;
  } {
    const buf = mustAllocate(CAP);
    buf.priceScale = 2;
    const all = bars(100);
    const cold = new ColdStore({ priceScale: 2 });
    cold.setBars(all);
    // Hot window = the newest 8 bars (indices 92…99), page = cold history.
    buf.publish(
      all.slice(92).map((b) => barToTicks(b, 2)),
      { hotFromIndex: 92 },
    );
    return { buf, cold };
  }

  test('jump-to-oldest copies one page; the hot window still answers hot requests', () => {
    const { buf, cold } = scene();
    expect(publishViewportPage(buf, cold.read(0, 10), 0)).toBe(10);
    expect(buf.pageActive).toBe(true);
    expect(buf.pageFromIndex).toBe(0);
    expect(buf.pageCount).toBe(10);

    const page = copyOutPage(buf, { fromAbs: 0, count: 10 });
    expect(page?.complete).toBe(true);
    expect(page?.bars.map((b) => b.time)).toEqual(cold.read(0, 10).map((t) => t.time));

    // The same old range is still invisible to the hot reader.
    expect(copyOutBars(buf, { fromAbs: 0, count: 10 })).toBeNull();
    // …while the hot range is unaffected by the page.
    const hot = copyOutBars(buf, { fromAbs: 92, count: 8 });
    expect(hot?.complete).toBe(true);
    expect(hot?.bars.at(-1)?.time).toBe(99 * 60);
  });

  test('a far jump replaces the page, never appends', () => {
    const { buf, cold } = scene();
    publishViewportPage(buf, cold.read(0, 10), 0);
    expect(publishViewportPage(buf, cold.read(40, 5), 40)).toBe(5);

    expect(buf.pageFromIndex).toBe(40);
    expect(buf.pageCount).toBe(5);
    const page = copyOutPage(buf, { fromAbs: 0, count: 100 });
    expect(page?.fromAbs).toBe(40);
    expect(page?.bars).toHaveLength(5);
    expect(page?.bars[0]?.time).toBe(40 * 60);
  });

  test('an oversized cold slice is clipped to the page capacity', () => {
    const { buf, cold } = scene();
    expect(publishViewportPage(buf, cold.read(0, 100), 0)).toBe(CAP);
    expect(buf.pageCount).toBe(CAP);
    expect(buf.pageCount).toBeLessThanOrEqual(buf.layout.cap);
  });

  test('an empty cold slice retires the page instead of leaving it active', () => {
    const { buf, cold } = scene();
    publishViewportPage(buf, cold.read(0, 10), 0);
    expect(publishViewportPage(buf, [], 0)).toBe(0);
    expect(buf.pageActive).toBe(false);
    expect(copyOutPage(buf, { fromAbs: 0, count: 10 })).toBeNull();
  });

  test('the live tip keeps updating while a page is on screen', () => {
    const { buf, cold } = scene();
    publishViewportPage(buf, cold.read(0, 10), 0);

    // The venue prints a new forming bar at index 100 (outside the page).
    const tip = barToTicks({ ...bar(100 * 60, 999), closed: false }, 2);
    buf.publish(
      [
        ...bars(100)
          .slice(92)
          .map((b) => barToTicks(b, 2)),
        tip,
      ],
      {
        hotFromIndex: 92,
      },
    );

    const tail = copyOutTail(buf, 1);
    expect(tail?.bars[0]?.time).toBe(100 * 60);
    expect(tail?.bars[0]?.close).toBe(999);
    expect(tail?.bars[0]?.closed).toBe(false); // still forming

    // The page survived the hot publish untouched.
    expect(copyOutPage(buf, { fromAbs: 0, count: 10 })?.bars).toHaveLength(10);
  });

  test('copyOutViewport dispatches: hot for the tip, page for history', () => {
    const { buf, cold } = scene();
    publishViewportPage(buf, cold.read(0, 10), 0);

    const history = copyOutViewport(buf, { fromAbs: 2, count: 4 });
    expect(history?.fromAbs).toBe(2);
    expect(history?.bars.map((b) => b.close)).toEqual([102, 103, 104, 105]);

    const tip = copyOutViewport(buf, { fromAbs: 96, count: 10 });
    expect(tip?.bars[0]?.time).toBe(96 * 60);
    expect(tip?.complete).toBe(false); // sticks out past the hot window

    // Nothing published for a range neither section covers.
    expect(copyOutViewport(buf, { fromAbs: 200, count: 5 })).toBeNull();
  });

  test('a torn page write is invisible: the seqlock covers the page too', () => {
    const { buf, cold } = scene();
    publishViewportPage(buf, cold.read(0, 10), 0);

    buf.control.beginPageWrite();
    buf.writePageBar(0, {
      time: 999,
      openTicks: 1n,
      highTicks: 1n,
      lowTicks: 1n,
      closeTicks: 1n,
      volume: 0,
      flags: BAR_FLAG_CLOSED,
    });
    expect(copyOutPage(buf, { fromAbs: 0, count: 10 }, 2)).toBeNull();

    buf.control.commitPageWrite();
    expect(copyOutPage(buf, { fromAbs: 0, count: 10 })?.bars[0]?.time).toBe(999);
  });

  test('a page replace leaves the hot window and its published slot alone', () => {
    const { buf, cold } = scene();
    const before = copyOutBars(buf, { fromAbs: 92, count: 8 });
    const slot = buf.control.publishedSlot;

    publishViewportPage(buf, cold.read(0, 10), 0);

    expect(buf.control.publishedSlot).toBe(slot);
    const after = copyOutBars(buf, { fromAbs: 92, count: 8 });
    expect(after?.bars).toEqual(before?.bars);
    expect(after?.generation).toBeGreaterThan(before?.generation ?? 0); // seqlock moved on
  });
});

describe('memory contract', () => {
  test('the page slot rides in the same SAB: byteLength is O(HOT_CAP), not O(N)', () => {
    const layout = computeHotLayout();
    for (const col of HOT_COLUMNS) {
      const off = (layout.page as unknown as Record<string, number>)[col];
      expect(off % HP_SECTION_ALIGN).toBe(0);
    }
    // The page starts beyond hot slot 1 — the sections never overlap.
    const slot1 = layout.slots[1];
    if (!slot1) throw new Error('layout');
    expect(layout.page.time_s).toBeGreaterThan(slot1.bar_flags);

    // A 200k-bar history exists in the worker heap; the SAB does not care.
    const history = new ColdStore({ max: 400_000 });
    history.setBars(bars(200_000));
    expect(history.length).toBe(200_000);

    const a = mustAllocate();
    const b = mustAllocate();
    expect(a.sab.byteLength).toBe(b.sab.byteLength); // history size never reaches the SAB
    // Hot double-buffer + one page of the same capacity — fixed, < 1 MiB.
    expect(b.sab.byteLength).toBe(691_968);
    expect(b.sab.byteLength).toBeLessThan(1024 * 1024);

    // Halving the capacity halves the columns: the size tracks the cap.
    const half = mustAllocate(HOT_CAP / 2);
    expect(half.sab.byteLength).toBeLessThan(b.sab.byteLength);
    expect(half.layout.cap).toBe(HOT_CAP / 2);
  });
});

describe('ColdStore', () => {
  beforeEach(async () => {
    await _resetBarsCacheForTests();
  });

  afterEach(async () => {
    await _resetBarsCacheForTests();
  });

  test('reads a clipped columnar range and nothing outside it', () => {
    const cold = new ColdStore();
    cold.setBars(bars(50));
    expect(cold.length).toBe(50);

    expect(cold.read(10, 5).map((t) => t.time)).toEqual([600, 660, 720, 780, 840]);
    expect(cold.read(45, 10)).toHaveLength(5); // clipped at the newest end
    expect(cold.read(-5, 3)).toHaveLength(3); // clipped at the oldest end
    expect(cold.read(90, 5)).toHaveLength(0); // outside the series

    const asBars = cold.readBars(0, 2);
    expect(asBars[0]?.close).toBe(100);
    expect(asBars[0]?.closed).toBe(true);
  });

  test('dedupes repeated times (last write wins) and keeps only the newest', () => {
    const cold = new ColdStore({ max: 10 });
    cold.setBars(bars(20));
    expect(cold.length).toBe(10);
    expect(cold.read(0, 1)[0]?.time).toBe(10 * 60); // oldest 10 dropped

    cold.setBars([bar(600, 1), bar(600, 2)]);
    expect(cold.length).toBe(1);
    expect(cold.readBars(0, 1)[0]?.close).toBe(2);
  });

  test('hydrates from bars-cache memory-first (no IndexedDB round-trip)', async () => {
    await putCachedBars('hp-test-src', 'TEST/USDT', '1h', bars(20, 60));
    const cold = new ColdStore();
    expect(await hydrateColdFromCache(cold, 'hp-test-src', 'TEST/USDT', '1h')).toBe(20);
    expect(cold.length).toBe(20);
    expect(cold.read(0, 1)[0]?.time).toBe(60);

    const missing = new ColdStore();
    expect(await hydrateColdFromCache(missing, 'hp-test-src', 'NOPE/USDT', '1h')).toBe(0);
    expect(missing.length).toBe(0);
  });
});

describe('rung 1 — no SAB at all', () => {
  test('a failed allocation still serves the viewport from the cold store', () => {
    const mem = new Map<string, string>();
    const g = globalThis as { sessionStorage?: unknown };
    g.sessionStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
    try {
      const buf = allocateHotBuffer(HOT_CAP, () => {
        throw new RangeError('SAB allocation failed');
      });
      expect(buf).toBeNull();
      expect(mem.get(HP_RUNG_SESSION_KEY)).toBe('1');

      const cold = new ColdStore();
      cold.setBars(bars(50));
      const full = copyOutPageFromCold(cold, { fromAbs: 10, count: 5 });
      expect(full?.bars.map((b) => b.time)).toEqual([600, 660, 720, 780, 840]);
      expect(full?.complete).toBe(true);

      const partial = copyOutPageFromCold(cold, { fromAbs: 45, count: 10 });
      expect(partial?.bars).toHaveLength(5);
      expect(partial?.complete).toBe(false);

      expect(copyOutPageFromCold(cold, { fromAbs: 90, count: 5 })).toBeNull();
      expect(copyOutPageFromCold(cold, { fromAbs: 0, count: 0 })).toBeNull();
    } finally {
      delete g.sessionStorage;
    }
  });
});

describe('publishBarPage — main-thread cold page (§9.2 wiring)', () => {
  test('converts Bars with the buffer scale and activates the page', () => {
    const buf = mustAllocate();
    buf.priceScale = 2; // cents: the worker converts with its own scale
    const n = publishBarPage(buf, [bar(60, 101.5), bar(120, 102.25)], 40);
    expect(n).toBe(2);
    expect(buf.pageActive).toBe(true);
    expect(buf.pageFromIndex).toBe(40);
    expect(buf.pageCount).toBe(2);
    const first = buf.readPageBar(0);
    expect(first.time).toBe(60);
    expect(first.close).toBeCloseTo(101.5, 10);
    expect(buf.readPageBar(1).close).toBeCloseTo(102.25, 10);
  });

  test('an empty page retires a stale page instead of leaving it active', () => {
    const buf = mustAllocate();
    publishBarPage(buf, [bar(60)], 40);
    expect(buf.pageActive).toBe(true);
    expect(publishBarPage(buf, [], 0)).toBe(0);
    expect(buf.pageActive).toBe(false);
    expect(buf.pageCount).toBe(0);
  });
});
