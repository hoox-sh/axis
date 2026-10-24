/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import './setup';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  _resetPaintLatency,
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
    expect(paintLatencyStats()).toEqual({ n: 1, last: 16, p50: 16, p95: 16, max: 16 });
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
    noteIngestPublish(90);
    notePaintRequest(100);
    noteHpCopyOut(110);
    noteHpGlDraw(114);
    clock.fire(116);
    expect(paintLatencyStats()).toEqual({ n: 1, last: 16, p50: 16, p95: 16, max: 16 });
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
    notePaintRequest(100);
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
    noteIngestPublish(80);
    noteIngestPublish(95);
    notePaintRequest(100);
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
    noteIngestPublish(80);
    flushPaintFrame(90);
    expect(paintLatencyStats().n).toBe(0);
    noteIngestPublish(195);
    notePaintRequest(200);
    clock.fire(216);
    expect(paintStageStats().publishToApplyP50).toBe(5);
  });
});
