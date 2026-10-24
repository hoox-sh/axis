/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import './setup';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  _resetPaintLatency,
  _resetPaintLatencyVisibilityHook,
  _setPaintLatencyScheduler,
  flushPaintFrame,
  noteHpCopyOut,
  noteHpGlDraw,
  noteIngestPublish,
  notePaintRequest,
  paintLatencyStats,
  paintStageStats,
} from '../src/chart/paint-latency';

/** Manual frame clock: the test decides when a frame fires. */
function manualScheduler() {
  const queue: Array<(ts: number) => void> = [];
  return {
    schedule: (cb: (ts: number) => void): number => {
      queue.push(cb);
      return queue.length;
    },
    fire(ts: number): void {
      const next = queue.shift();
      if (next) next(ts);
    },
    get armed(): number {
      return queue.length;
    },
  };
}

describe('paint latency (tick → frame, plan §14.2)', () => {
  beforeEach(() => {
    _setPaintLatencyScheduler(null);
    _resetPaintLatency();
  });
  afterEach(() => {
    _setPaintLatencyScheduler(null);
    _resetPaintLatency();
  });

  it('measures the first arrival of a frame burst, once', () => {
    const clock = manualScheduler();
    _setPaintLatencyScheduler(clock.schedule);
    notePaintRequest(100);
    // A second bar in the same frame keeps the oldest arrival.
    notePaintRequest(104);
    expect(clock.armed).toBe(1);
    clock.fire(116);
    expect(paintLatencyStats()).toEqual({
      n: 1,
      last: 16,
      p50: 16,
      p95: 16,
      max: 16,
      suspended: 0,
    });
  });

  it('runs one callback per burst and re-arms on the next tick', () => {
    const clock = manualScheduler();
    _setPaintLatencyScheduler(clock.schedule);
    notePaintRequest(0);
    clock.fire(10);
    expect(clock.armed).toBe(0);
    notePaintRequest(20);
    expect(clock.armed).toBe(1);
    clock.fire(32);
    expect(paintLatencyStats().n).toBe(2);
    expect(paintLatencyStats().last).toBe(12);
  });

  it('ignores a frame with no pending tick', () => {
    const clock = manualScheduler();
    _setPaintLatencyScheduler(clock.schedule);
    flushPaintFrame(50);
    expect(paintLatencyStats().n).toBe(0);
  });

  it('reports p50 / p95 / max over a rolling window', () => {
    const clock = manualScheduler();
    _setPaintLatencyScheduler(clock.schedule);
    for (let i = 1; i <= 100; i++) {
      notePaintRequest(0);
      clock.fire(i);
    }
    const stats = paintLatencyStats();
    expect(stats.n).toBe(100);
    expect(stats.p50).toBe(50);
    expect(stats.p95).toBe(95);
    expect(stats.max).toBe(100);
    expect(stats.last).toBe(100);
  });

  it('bounds the window and never reports a stale arrival without frames', () => {
    const clock = manualScheduler();
    _setPaintLatencyScheduler(clock.schedule);
    for (let i = 0; i < 300; i++) {
      notePaintRequest(0);
      clock.fire(1);
    }
    expect(paintLatencyStats().n).toBe(240);

    // No scheduler (worker/test env): the arrival is dropped, not held.
    _setPaintLatencyScheduler(() => 1);
    _setPaintLatencyScheduler(null);
    _resetPaintLatency();
    notePaintRequest(0);
    expect(paintLatencyStats().n).toBe(0);
  });
});

describe('paint stages (hp2 A1: worker → apply → copy-out → draw)', () => {
  beforeEach(() => {
    _setPaintLatencyScheduler(null);
    _resetPaintLatency();
  });
  afterEach(() => {
    _setPaintLatencyScheduler(null);
    _resetPaintLatency();
  });

  it('splits publish → apply → copy-out → draw', () => {
    const clock = manualScheduler();
    _setPaintLatencyScheduler(clock.schedule);
    noteIngestPublish(90, 90);
    notePaintRequest(100, true);
    noteHpCopyOut(110);
    noteHpGlDraw(114);
    clock.fire(116);
    expect(paintLatencyStats()).toEqual({
      n: 1,
      last: 16,
      p50: 16,
      p95: 16,
      max: 16,
      suspended: 0,
    });
    expect(paintStageStats()).toEqual({
      publishedBursts: 1,
      publishToApplyP50: 10,
      applyToCopyOutP50: 10,
      copyOutToDrawP50: 4,
    });
  });

  it('reports null stages on the JSON / LWC-only path', () => {
    const clock = manualScheduler();
    _setPaintLatencyScheduler(clock.schedule);
    noteIngestPublish(undefined);
    notePaintRequest(100, true);
    clock.fire(116);
    expect(paintLatencyStats().n).toBe(1);
    expect(paintStageStats()).toEqual({
      publishedBursts: 0,
      publishToApplyP50: null,
      applyToCopyOutP50: null,
      copyOutToDrawP50: null,
    });
  });

  it('takes the last publish stamp per burst and resets between bursts', () => {
    const clock = manualScheduler();
    _setPaintLatencyScheduler(clock.schedule);
    // An earlier message in the same burst (e.g. a snapshot that appends
    // nothing) must not lend its stamp to the append that follows.
    noteIngestPublish(80, 80);
    noteIngestPublish(95, 95);
    notePaintRequest(100, true);
    clock.fire(116);
    expect(paintStageStats().publishToApplyP50).toBe(5);
    notePaintRequest(200);
    clock.fire(210);
    // Second burst had no publish stamp: no new stage sample.
    expect(paintStageStats().publishedBursts).toBe(1);
  });

  it('an orphaned publish does not survive a frame into a later burst', () => {
    const clock = manualScheduler();
    _setPaintLatencyScheduler(clock.schedule);
    // Snapshot burst: worker publishes, chart already holds the bars, so
    // no paint request arms — but a frame still closes the burst and drops
    // the orphaned stamp. The later tip burst carries its own stamp.
    noteIngestPublish(80, 80);
    flushPaintFrame(90);
    expect(paintLatencyStats().n).toBe(0);
    noteIngestPublish(195, 195);
    notePaintRequest(200, true);
    clock.fire(216);
    expect(paintStageStats().publishToApplyP50).toBe(5);
  });
});

describe('suspended bursts (hidden tab, plan §14.2)', () => {
  const g = globalThis as Record<string, unknown>;
  const realDocument = g.document;

  function fakeDocument(hidden: boolean) {
    const listeners: Record<string, Array<() => void>> = {};
    g.document = {
      hidden,
      addEventListener: (name: string, fn: () => void) => {
        const list = listeners[name];
        if (list) list.push(fn);
        else listeners[name] = [fn];
      },
      __fire: (name: string) => {
        for (const fn of listeners[name] ?? []) fn();
      },
      __setHidden: (value: boolean) => {
        (g.document as Record<string, unknown>).hidden = value;
      },
    };
    return g.document as Record<string, unknown>;
  }

  beforeEach(() => {
    _setPaintLatencyScheduler(null);
    _resetPaintLatency();
    _resetPaintLatencyVisibilityHook();
  });
  afterEach(() => {
    _setPaintLatencyScheduler(null);
    _resetPaintLatency();
    _resetPaintLatencyVisibilityHook();
    if (realDocument === undefined) delete g.document;
    else g.document = realDocument;
  });

  it('skips bursts armed while hidden and counts them', () => {
    const clock = (function manual() {
      const queue: Array<(ts: number) => void> = [];
      return {
        schedule: (cb: (ts: number) => void): number => {
          queue.push(cb);
          return queue.length;
        },
        fire(ts: number): void {
          const next = queue.shift();
          if (next) next(ts);
        },
      };
    })();
    _setPaintLatencyScheduler(clock.schedule);
    fakeDocument(true);
    noteIngestPublish(90, 90);
    notePaintRequest(100);
    // rAF resumes 96 s later — background time, not paint latency.
    clock.fire(96_100);
    expect(paintLatencyStats()).toEqual({
      n: 0,
      last: null,
      p50: null,
      p95: null,
      max: null,
      suspended: 1,
    });
    // Stale marks die with the burst: no stage inherits the old publish.
    expect(paintStageStats().publishedBursts).toBe(0);
    // Foreground bursts sample normally afterwards.
    (g.document as Record<string, (v: boolean) => void>).__setHidden(false);
    noteIngestPublish(96_190, 96_190);
    notePaintRequest(96_200, true);
    clock.fire(96_216);
    expect(paintLatencyStats().n).toBe(1);
    expect(paintLatencyStats().last).toBe(16);
    expect(paintLatencyStats().suspended).toBe(1);
    expect(paintStageStats().publishToApplyP50).toBe(10);
  });

  it('skips bursts suspended mid-flight via visibilitychange', () => {
    const queue: Array<(ts: number) => void> = [];
    _setPaintLatencyScheduler((cb) => {
      queue.push(cb);
      return queue.length;
    });
    const doc = fakeDocument(false);
    notePaintRequest(100);
    // Tab hides before the frame: the pending burst is suspended.
    (doc.__setHidden as (v: boolean) => void)(true);
    (doc.__fire as (n: string) => void)('visibilitychange');
    const next = queue.shift();
    if (next) next(200_100);
    const stats = paintLatencyStats();
    expect(stats.n).toBe(0);
    expect(stats.suspended).toBe(1);
  });
});

describe('causal pairing (worker vs venue appends, plan §14.2)', () => {
  function manual() {
    const queue: Array<(ts: number) => void> = [];
    return {
      schedule: (cb: (ts: number) => void): number => {
        queue.push(cb);
        return queue.length;
      },
      fire(ts: number): void {
        const next = queue.shift();
        if (next) next(ts);
      },
    };
  }

  beforeEach(() => {
    _setPaintLatencyScheduler(null);
    _resetPaintLatency();
  });
  afterEach(() => {
    _setPaintLatencyScheduler(null);
    _resetPaintLatency();
  });

  it('a venue burst never consumes the engine publish stamp', () => {
    const clock = manual();
    _setPaintLatencyScheduler(clock.schedule);
    // Engine posted 8 s ago; a venue tick paints the forming tip now.
    noteIngestPublish(100, 100);
    notePaintRequest(8100);
    clock.fire(8116);
    // Total tick→frame still samples — the tick really painted this frame.
    expect(paintLatencyStats().n).toBe(1);
    expect(paintLatencyStats().last).toBe(16);
    // But the publish stage stays empty: engine cadence is not dispatch.
    expect(paintStageStats().publishedBursts).toBe(0);
    expect(paintStageStats().publishToApplyP50).toBeNull();
  });

  it('a worker burst consumes the stamp for the dispatch number', () => {
    const clock = manual();
    _setPaintLatencyScheduler(clock.schedule);
    noteIngestPublish(100, 100);
    notePaintRequest(108, true);
    clock.fire(116);
    expect(paintLatencyStats().n).toBe(1);
    expect(paintStageStats().publishedBursts).toBe(1);
    expect(paintStageStats().publishToApplyP50).toBe(8);
  });

  it('a mixed burst pairs on the worker append (OR across the burst)', () => {
    const clock = manual();
    _setPaintLatencyScheduler(clock.schedule);
    noteIngestPublish(100, 100);
    notePaintRequest(104);
    notePaintRequest(108, true);
    clock.fire(116);
    // Total counts from the first arrival; the stage pairs worker-caused.
    expect(paintLatencyStats().last).toBe(12);
    expect(paintStageStats().publishedBursts).toBe(1);
    expect(paintStageStats().publishToApplyP50).toBe(4);
  });
});

describe('worker clock origin (plan §14.2)', () => {
  function manual() {
    const queue: Array<(ts: number) => void> = [];
    return {
      schedule: (cb: (ts: number) => void): number => {
        queue.push(cb);
        return queue.length;
      },
      fire(ts: number): void {
        const next = queue.shift();
        if (next) next(ts);
      },
    };
  }

  beforeEach(() => {
    _setPaintLatencyScheduler(null);
    _resetPaintLatency();
  });
  afterEach(() => {
    _setPaintLatencyScheduler(null);
    _resetPaintLatency();
  });

  it('subtracts the worker clock origin, leaving dispatch', () => {
    const clock = manual();
    _setPaintLatencyScheduler(clock.schedule);
    // The worker's time origin trails the main clock by 7 s: the stamp
    // reads 1000 where the main clock reads 8000 at receipt.
    noteIngestPublish(1000, 8000);
    notePaintRequest(8010, true);
    noteHpCopyOut(8012);
    clock.fire(8026);
    expect(paintLatencyStats().n).toBe(1);
    expect(paintLatencyStats().last).toBe(16);
    // (8010 − 1000) − 7000 origin delta = 10 ms of true dispatch.
    expect(paintStageStats().publishedBursts).toBe(1);
    expect(paintStageStats().publishToApplyP50).toBe(10);
    expect(paintStageStats().applyToCopyOutP50).toBe(2);
  });

  it('tracks the minimum transit as the origin estimate', () => {
    const clock = manual();
    _setPaintLatencyScheduler(clock.schedule);
    // A slow first post (transit 7050 ms) then a faster one (6002 ms):
    // the floor settles on the fastest, not the first.
    noteIngestPublish(1000, 8050);
    notePaintRequest(8060, true);
    clock.fire(8076);
    expect(paintStageStats().publishToApplyP50).toBe(10);
    noteIngestPublish(2000, 8002);
    notePaintRequest(8010, true);
    clock.fire(8026);
    // (8010 − 2000) − 6002 floor = 8: the stale 7050 ms floor no longer rules.
    expect(paintStageStats().publishToApplyP50).toBe(8);
  });
});
