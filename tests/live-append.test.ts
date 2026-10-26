/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Live append — the store verdict and the chart paint.
 *
 * `store.appendBar` decides what changed (nothing / tip / new bar / window
 * slide); the paint layer has to mirror that decision. The verdict is
 * returned so the caller can skip the side effects of a **rejected** bar —
 * a stale tick must not move the price card, fire an alert, or overwrite a
 * dataset bar.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { setStore, store, type BarAppendResult } from '../src/store';
import { setManager } from '../src/chart/manager-access';
import {
  appendLiveBar,
  _resetSlideReplaceForTests,
  _setSlideReplaceScheduler,
} from '../src/chart/live-append';
import { paintAction, type PaintAction } from '../src/chart/v1/paint-action';
import type { Bar } from '../src/store/types';

function bar(t: number, close = 100, extra: Partial<Bar> = {}): Bar {
  return { time: t, open: close, high: close + 1, low: close - 1, close, volume: 1, ...extra };
}

/** Coalesced chart paint runs in a microtask at the end of this turn. */
function settlePaint(): Promise<void> {
  return Promise.resolve();
}

/** Manual frame clock for deferred slide replaces. */
function manualSlideScheduler() {
  const queue: Array<() => void> = [];
  return {
    schedule: (cb: () => void): void => {
      queue.push(cb);
    },
    fire(): void {
      const next = queue.shift();
      if (next) next();
    },
    get pending(): number {
      return queue.length;
    },
  };
}

let appended: Bar[] = [];
let setDataCalls: unknown[][] = [];
let fitCalls = 0;
let manager: unknown;

const DEFAULT_WINDOW = 10_000;

beforeEach(async () => {
  // A previous test's flush must not paint into this manager.
  await settlePaint();
  _setSlideReplaceScheduler(null);
  _resetSlideReplaceForTests();
  appended = [];
  setDataCalls = [];
  fitCalls = 0;
  setStore('bars', []);
  setStore('rollingWindowBars', DEFAULT_WINDOW);
  // Candle series only — no chart, so `ensurePriceSeries` does not swap it.
  // `setData` here is the full-window replace; `appendBar` is `series.update`.
  // `afterDataReload` is the fit path when `setDataToChart({ fit: true })`.
  const candle = {
    setData: (data: unknown[]) => {
      setDataCalls.push(data);
    },
    applyOptions: () => {},
  };
  const pricePane = { id: 'price', series: { candle } };
  manager = {
    appendBar: (b: Bar) => appended.push(b),
    getPane: (id: string) => (id === 'price' ? pricePane : undefined),
    getAllPanes: () => [pricePane],
    afterDataReload: () => {
      fitCalls += 1;
    },
  };
  setManager(manager as never);
});

// The store is shared across the test files in one process: a leaked rolling
// window would slice the bars of every later test.
afterEach(async () => {
  await settlePaint();
  _setSlideReplaceScheduler(null);
  _resetSlideReplaceForTests();
  setManager(undefined);
  setStore('bars', []);
  setStore('rollingWindowBars', DEFAULT_WINDOW);
});

describe('appendLiveBar', () => {
  it('paints the first bar through setData (update throws on an empty series)', () => {
    const verdict = appendLiveBar(bar(60));
    expect(verdict).toBe('appended');
    expect(appended).toHaveLength(0); // manager.appendBar is not used for the first bar
    expect(setDataCalls).toHaveLength(1);
    expect(store.bars).toHaveLength(1);
  });

  it('paints a later new bar with series.update, not a full replace', async () => {
    appendLiveBar(bar(60));
    await settlePaint();
    appended = [];
    setDataCalls = [];
    // Time greater than the tip, window not full — a new slot, not a replace.
    const verdict = appendLiveBar(bar(120));
    expect(verdict).toBe('appended');
    expect(appended).toHaveLength(0);
    await settlePaint();
    expect(appended).toHaveLength(1); // manager.appendBar / series.update
    expect(setDataCalls).toHaveLength(0);
    expect(store.bars).toHaveLength(2);
    expect(store.bars[1]!.time).toBe(120);
  });

  it('keeps the incremental path for a forming-tick update', async () => {
    appendLiveBar(bar(60));
    await settlePaint();
    appended = [];
    // Same time as the tip → forming candle updated in place.
    const verdict = appendLiveBar(bar(60, 101));
    expect(verdict).toBe('updated');
    expect(appended).toHaveLength(0);
    await settlePaint();
    expect(appended).toHaveLength(1); // manager.appendBar / series.update
    expect(appended[0]?.close).toBe(101);
    expect(store.bars).toHaveLength(1);
  });

  it('coalesces same-bar ticks in one turn to one chart append', async () => {
    appendLiveBar(bar(60));
    await settlePaint();
    appended = [];
    setDataCalls = [];

    expect(appendLiveBar(bar(60, 101))).toBe('updated');
    expect(appendLiveBar(bar(60, 102))).toBe('updated');
    // Store verdicts are synchronous. The chart paint has not run yet.
    expect(store.bars[0]?.close).toBe(102);
    expect(appended).toHaveLength(0);
    expect(setDataCalls).toHaveLength(0);

    await settlePaint();
    expect(appended).toHaveLength(1);
    expect(appended[0]?.close).toBe(102);
    expect(setDataCalls).toHaveLength(0);
  });

  it('applies a new time after the forming update in the same flush', async () => {
    appendLiveBar(bar(60));
    await settlePaint();
    appended = [];
    setDataCalls = [];

    expect(appendLiveBar(bar(60, 101))).toBe('updated');
    expect(appendLiveBar(bar(120, 200))).toBe('appended');
    expect(appended).toHaveLength(0);

    await settlePaint();
    expect(appended.map((b) => [b.time, b.close])).toEqual([
      [60, 101],
      [120, 200],
    ]);
    expect(setDataCalls).toHaveLength(0);
    expect(store.bars.map((b) => b.time)).toEqual([60, 120]);
  });

  it('reports "ignored" for a late tick and paints nothing', () => {
    appendLiveBar(bar(120));
    appended = [];
    setDataCalls = [];
    const verdict = appendLiveBar(bar(60));
    expect(verdict).toBe('ignored');
    expect(appended).toHaveLength(0);
    expect(setDataCalls).toHaveLength(0);
    expect(store.bars).toHaveLength(1);
    expect(store.bars[0]!.time).toBe(120);
  });

  it('does not reopen a closed candle', () => {
    appendLiveBar(bar(60, 100, { closed: true }));
    appended = [];
    const verdict = appendLiveBar(bar(60, 101, { closed: false }));
    expect(verdict).toBe('ignored');
    expect(appended).toHaveLength(0);
    expect(store.bars[0]!.close).toBe(100);
  });

  it('reports a window slide so the caller can do a full repaint', async () => {
    setStore('rollingWindowBars', 3);
    for (let i = 0; i < 3; i++) appendLiveBar(bar(60 + i * 60));
    await settlePaint();
    appended = [];
    setDataCalls = [];
    const verdict = appendLiveBar(bar(60 + 3 * 60));
    expect(verdict).toBe('slid');
    // Default scheduler has no rAF in bun tests → sync fallback replace.
    expect(appended).toHaveLength(0);
    expect(setDataCalls).toHaveLength(1);
    expect(fitCalls).toBe(0);
    expect(store.bars).toHaveLength(3);
    expect(store.bars[0]!.time).toBe(120);
  });

  it('cancels a queued tip paint instead of flushing it before a slide replace', () => {
    setStore('rollingWindowBars', 2);
    appendLiveBar(bar(60));
    appendLiveBar(bar(120, 110));
    appended = [];
    setDataCalls = [];

    const verdict = appendLiveBar(bar(180, 130));
    expect(verdict).toBe('slid');
    // The queued update would have been overwritten by setData — skip it.
    expect(appended).toHaveLength(0);
    expect(setDataCalls).toHaveLength(1);
    expect(store.bars.map((b) => b.time)).toEqual([120, 180]);
  });

  it('defers a slide setData to one frame and coalesces bursts', async () => {
    const clock = manualSlideScheduler();
    _setSlideReplaceScheduler(clock.schedule);
    setStore('rollingWindowBars', 2);
    appendLiveBar(bar(60));
    appendLiveBar(bar(120));
    await settlePaint();
    appended = [];
    setDataCalls = [];

    expect(appendLiveBar(bar(180))).toBe('slid');
    expect(setDataCalls).toHaveLength(0);
    expect(clock.pending).toBe(1);
    expect(store.bars.map((b) => b.time)).toEqual([120, 180]);

    // A second slide in the same frame reuses the armed callback.
    expect(appendLiveBar(bar(240))).toBe('slid');
    expect(setDataCalls).toHaveLength(0);
    expect(clock.pending).toBe(1);
    expect(store.bars.map((b) => b.time)).toEqual([180, 240]);

    clock.fire();
    expect(setDataCalls).toHaveLength(1);
    expect((setDataCalls[0] as Bar[]).map((b) => b.time)).toEqual([180, 240]);
    expect(clock.pending).toBe(0);
    expect(fitCalls).toBe(0);
  });

  it('keeps forming-tick updates on the tip while a slide replace is armed', async () => {
    const clock = manualSlideScheduler();
    _setSlideReplaceScheduler(clock.schedule);
    setStore('rollingWindowBars', 2);
    appendLiveBar(bar(60));
    appendLiveBar(bar(120));
    await settlePaint();
    appended = [];
    setDataCalls = [];

    expect(appendLiveBar(bar(180, 130))).toBe('slid');
    expect(setDataCalls).toHaveLength(0);

    expect(appendLiveBar(bar(180, 131))).toBe('updated');
    expect(appended).toHaveLength(0);
    await settlePaint();
    expect(appended).toHaveLength(1);
    expect(appended[0]?.close).toBe(131);
    expect(setDataCalls).toHaveLength(0);

    clock.fire();
    expect(setDataCalls).toHaveLength(1);
    const painted = setDataCalls[0] as Bar[];
    expect(painted.map((b) => b.time)).toEqual([120, 180]);
    expect(painted[1]?.close).toBe(131);
  });
});

type PaintRow = {
  name: string;
  seed: () => void | Promise<void>;
  tick: Bar;
  verdict: BarAppendResult;
  windowLength: number;
  action: PaintAction;
  updates: number;
  setData: number;
};

describe('v1 paint-action table (concept §5.2 / §11)', () => {
  const rows: PaintRow[] = [
    {
      name: 'ignored (late tick)',
      seed: () => {
        appendLiveBar(bar(120));
      },
      tick: bar(60),
      verdict: 'ignored',
      windowLength: 1,
      action: 'none',
      updates: 0,
      setData: 0,
    },
    {
      name: 'updated (forming tick, same bar)',
      seed: () => {
        appendLiveBar(bar(60));
      },
      tick: bar(60, 101),
      verdict: 'updated',
      windowLength: 1,
      action: 'update',
      updates: 1,
      setData: 0,
    },
    {
      name: 'appended-first (empty series)',
      seed: () => {},
      tick: bar(60),
      verdict: 'appended',
      windowLength: 1,
      action: 'setData',
      updates: 0,
      setData: 1,
    },
    {
      name: 'appended-later (window not full)',
      seed: () => {
        appendLiveBar(bar(60));
      },
      tick: bar(120),
      verdict: 'appended',
      windowLength: 2,
      action: 'update',
      updates: 1,
      setData: 0,
    },
    {
      name: 'slid (cap reached)',
      seed: () => {
        setStore('rollingWindowBars', 3);
        for (let i = 0; i < 3; i++) appendLiveBar(bar(60 + i * 60));
      },
      tick: bar(60 + 3 * 60),
      verdict: 'slid',
      windowLength: 3,
      action: 'setData',
      updates: 0,
      setData: 1,
    },
  ];

  for (const row of rows) {
    it(`${row.name} → ${row.action}`, async () => {
      expect(paintAction(row.verdict, row.windowLength)).toBe(row.action);
      await row.seed();
      await settlePaint();
      appended = [];
      setDataCalls = [];
      fitCalls = 0;

      const verdict = appendLiveBar(row.tick);
      expect(verdict).toBe(row.verdict);
      expect(paintAction(verdict, store.bars.length)).toBe(row.action);
      await settlePaint();
      expect(appended).toHaveLength(row.updates);
      expect(setDataCalls).toHaveLength(row.setData);
      expect(fitCalls).toBe(0);
    });
  }

  it('coalesces forming ticks in one turn to one update, zero setData', async () => {
    appendLiveBar(bar(60));
    await settlePaint();
    appended = [];
    setDataCalls = [];

    expect(paintAction(appendLiveBar(bar(60, 101)), 1)).toBe('update');
    expect(paintAction(appendLiveBar(bar(60, 102)), 1)).toBe('update');
    expect(appended).toHaveLength(0);
    expect(setDataCalls).toHaveLength(0);

    await settlePaint();
    expect(appended).toHaveLength(1);
    expect(appended[0]?.close).toBe(102);
    expect(setDataCalls).toHaveLength(0);
    expect(fitCalls).toBe(0);
  });

  it('late tick ignored: zero paints', async () => {
    appendLiveBar(bar(120));
    await settlePaint();
    appended = [];
    setDataCalls = [];
    fitCalls = 0;

    expect(appendLiveBar(bar(60))).toBe('ignored');
    expect(paintAction('ignored', store.bars.length)).toBe('none');
    await settlePaint();
    expect(appended).toHaveLength(0);
    expect(setDataCalls).toHaveLength(0);
    expect(fitCalls).toBe(0);
  });
});

describe('slide replace still requires setData (update cannot drop the head)', () => {
  it('an update-only painter keeps the slid head until setData runs', () => {
    // Local series model mirrors LWC 5.2: update replaces the tip or appends
    // a newer time; it never removes an older row. Owned mock — not mock-lwc.
    const series: Bar[] = [];
    const updateOnly = (b: Bar) => {
      const last = series[series.length - 1];
      if (!last) {
        series.push(b);
        return;
      }
      if (b.time < last.time) throw new Error('Cannot update oldest data item');
      if (b.time === last.time) series[series.length - 1] = b;
      else series.push(b);
    };
    const candle = {
      setData: (data: Bar[]) => {
        series.splice(0, series.length, ...data);
        setDataCalls.push(data);
      },
      applyOptions: () => {},
    };
    const pricePane = { id: 'price', series: { candle } };
    const localManager = {
      appendBar: (b: Bar) => {
        updateOnly(b);
        appended.push(b);
      },
      getPane: (id: string) => (id === 'price' ? pricePane : undefined),
      getAllPanes: () => [pricePane],
      afterDataReload: () => {
        fitCalls += 1;
      },
    };
    setManager(localManager as never);
    setStore('rollingWindowBars', 2);

    const clock = manualSlideScheduler();
    _setSlideReplaceScheduler(clock.schedule);

    appendLiveBar(bar(60));
    // First bar is sync setData.
    expect(series.map((b) => b.time)).toEqual([60]);
    appendLiveBar(bar(120));
    // appended path uses manager.appendBar after microtask — drive it.
    return settlePaint().then(() => {
      expect(series.map((b) => b.time)).toEqual([60, 120]);
      appended = [];
      setDataCalls = [];

      expect(appendLiveBar(bar(180))).toBe('slid');
      expect(store.bars.map((b) => b.time)).toEqual([120, 180]);
      // Store slid; series still holds the old head until the deferred replace.
      expect(series.map((b) => b.time)).toEqual([60, 120]);
      expect(setDataCalls).toHaveLength(0);

      // Tip update alone would only grow the series — head stays.
      updateOnly(bar(180, 130));
      expect(series.map((b) => b.time)).toEqual([60, 120, 180]);

      clock.fire();
      expect(setDataCalls).toHaveLength(1);
      expect(series.map((b) => b.time)).toEqual([120, 180]);
    });
  });
});
