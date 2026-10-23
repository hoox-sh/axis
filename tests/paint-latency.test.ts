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
  notePaintRequest,
  paintLatencyStats,
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
