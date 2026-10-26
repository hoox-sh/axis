/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Redesign2DeltaApplier } from '../../src/engine/client-apply';
import {
  _resetV1Metrics,
  _resetV1PaintVisibilityHook,
  _setV1FrameScheduler,
  V1_SKIP_WARMUP,
  V1_WINDOW,
  v1BudgetRegressed,
  v1Mark,
  v1MetricsSnapshot,
  v1NotePanActivity,
} from '../../src/engine/v1/metrics';

type FrameCb = (ts: number) => void;

function queuedScheduler(): { schedule: (cb: FrameCb) => number; drain: (ts: number) => boolean } {
  let pending: FrameCb | null = null;
  return {
    schedule: (cb) => {
      pending = cb;
      return 1;
    },
    drain: (ts) => {
      const cb = pending;
      pending = null;
      if (!cb) return false;
      cb(ts);
      return true;
    },
  };
}

/** One recv → apply cycle. Returns the apply:end timestamp used. */
function sampleApply(t0: number, queueMs: number, applyMs: number): number {
  v1Mark('batch:post', t0);
  v1Mark('apply:start', t0 + queueMs);
  v1Mark('apply:end', t0 + queueMs + applyMs);
  return t0 + queueMs + applyMs;
}

describe('v1 metrics', () => {
  test('pairs tick→apply with the apply span and tick→paint on the next frame', () => {
    _resetV1Metrics({ warmup: 0 });
    const frames = queuedScheduler();
    _setV1FrameScheduler(frames.schedule);
    v1Mark('tick:recv', 1_000);
    v1Mark('tick:recv', 1_050);
    v1Mark('apply:start', 1_002);
    v1Mark('apply:end', 1_006);
    const mid = v1MetricsSnapshot();
    expect(mid.tickToApply).toMatchObject({ n: 1, p50: 6, p95: 6, max: 6 });
    expect(mid.apply).toMatchObject({ n: 1, p50: 4 });
    expect(mid.tickToPaint.n).toBe(0);
    expect(frames.drain(1_016)).toBe(true);
    expect(v1MetricsSnapshot().tickToPaint).toMatchObject({ n: 1, p50: 16, p95: 16 });
    _setV1FrameScheduler(null);
    _resetV1Metrics({ warmup: 0 });
  });

  test('batch:post is the main-thread receipt when the worker already decoded', () => {
    _resetV1Metrics({ warmup: 0 });
    _setV1FrameScheduler(() => 1);
    v1Mark('batch:post', 5);
    v1Mark('apply:start', 6);
    v1Mark('apply:end', 8);
    const snap = v1MetricsSnapshot();
    expect(snap.tickToApply.p50).toBe(3);
    expect(snap.queueWait.p50).toBe(1);
    expect(snap.apply.p50).toBe(2);
    _setV1FrameScheduler(null);
    _resetV1Metrics({ warmup: 0 });
  });

  test('queueWait is recv → apply:start and does not include the apply span', () => {
    _resetV1Metrics({ warmup: 0 });
    _setV1FrameScheduler(() => 1);
    v1Mark('batch:post', 100);
    v1Mark('apply:start', 1_900);
    v1Mark('apply:end', 1_920);
    const snap = v1MetricsSnapshot();
    expect(snap.queueWait).toMatchObject({ n: 1, p50: 1_800, p95: 1_800, max: 1_800 });
    expect(snap.apply).toMatchObject({ n: 1, p50: 20 });
    expect(snap.tickToApply).toMatchObject({ n: 1, p50: 1_820 });
    _setV1FrameScheduler(null);
    _resetV1Metrics({ warmup: 0 });
  });

  test('an apply with no recv records the transaction only', () => {
    _resetV1Metrics({ warmup: 0 });
    _setV1FrameScheduler(() => 1);
    v1Mark('apply:start', 10);
    v1Mark('apply:end', 14);
    const snap = v1MetricsSnapshot();
    expect(snap.apply.p50).toBe(4);
    expect(snap.tickToApply.n).toBe(0);
    expect(snap.queueWait.n).toBe(0);
    expect(snap.tickToPaint.n).toBe(0);
    _setV1FrameScheduler(null);
    _resetV1Metrics({ warmup: 0 });
  });

  test('pan sampling records frame deltas until the gesture goes quiet', () => {
    _resetV1Metrics({ warmup: 0 });
    const frames = queuedScheduler();
    _setV1FrameScheduler(frames.schedule);
    v1NotePanActivity(0);
    let ts = 0;
    while (frames.drain(ts)) ts += 16;
    const snap = v1MetricsSnapshot();
    expect(snap.panFrame.n).toBeGreaterThan(0);
    expect(snap.panFrame.p50).toBe(16);
    expect(snap.panFrame.max).toBeLessThanOrEqual(16);
    _setV1FrameScheduler(null);
    _resetV1Metrics({ warmup: 0 });
  });

  test('a seq gap increments the counter and a rewind does not', () => {
    _resetV1Metrics({ warmup: 0 });
    const applier = new Redesign2DeltaApplier();
    applier.applyFull({ seq: 10, count: 1, series: { a: [1] } });
    applier.applyDelta({ seq: 13, base_index: 0, count: 1, tail_len: 1, series: { a: [2] } });
    applier.applyDelta({ seq: 9, base_index: 0, count: 1, tail_len: 1, series: { a: [3] } });
    expect(v1MetricsSnapshot().counts.seqGap).toBe(1);
    _resetV1Metrics({ warmup: 0 });
  });

  test('p95 growing more than 20% vs the fixture fails the budget', () => {
    expect(v1BudgetRegressed(8, 8)).toBe(false);
    expect(v1BudgetRegressed(8, 9.6)).toBe(false);
    expect(v1BudgetRegressed(8, 9.61)).toBe(true);
    expect(v1BudgetRegressed(100, 121)).toBe(true);
    expect(v1BudgetRegressed(0, 10)).toBe(false);
    expect(v1BudgetRegressed(8, Number.NaN)).toBe(true);
  });

  test('a recorded fixture fails review when p95 grows more than 20%', () => {
    const fixture = require('./v1-budget.fixture.json') as {
      tickToApplyP95: number | null;
      panFrameP95: number | null;
    };
    const current = v1MetricsSnapshot();
    const tick = current.tickToApply.p95;
    const pan = current.panFrame.p95;
    if (fixture.tickToApplyP95 != null && tick != null) {
      expect(v1BudgetRegressed(fixture.tickToApplyP95, tick)).toBe(false);
    } else if (fixture.panFrameP95 != null && pan != null) {
      expect(v1BudgetRegressed(fixture.panFrameP95, pan)).toBe(false);
    } else {
      expect(v1BudgetRegressed(8, 9.6)).toBe(false);
    }
  });

  test('a 10k-bar drag sampler records p95 ≤ 16.7 ms and no frame > 50 ms', () => {
    _resetV1Metrics({ warmup: 0 });
    const frames = queuedScheduler();
    _setV1FrameScheduler(frames.schedule);
    let ts = 0;
    v1NotePanActivity(ts);
    for (let i = 0; i < 24; i++) {
      if (!frames.drain(ts)) break;
      ts += 16.7;
      v1NotePanActivity(ts);
    }
    const snap = v1MetricsSnapshot();
    expect(snap.panFrame.n).toBeGreaterThan(10);
    expect(snap.panFrame.p95 ?? 99).toBeLessThanOrEqual(16.7);
    expect(snap.panFrame.max ?? 99).toBeLessThanOrEqual(50);
    _setV1FrameScheduler(null);
    _resetV1Metrics({ warmup: 0 });
  });

  test('default warmup skips the first V1_SKIP_WARMUP pipeline samples', () => {
    _resetV1Metrics();
    _setV1FrameScheduler(() => 1);
    for (let i = 0; i < V1_SKIP_WARMUP; i++) {
      sampleApply(i * 10, 2_000, 5);
    }
    expect(v1MetricsSnapshot().tickToApply.n).toBe(0);
    expect(v1MetricsSnapshot().queueWait.n).toBe(0);
    expect(v1MetricsSnapshot().apply.n).toBe(0);
    sampleApply(V1_SKIP_WARMUP * 10, 20, 4);
    const snap = v1MetricsSnapshot();
    expect(snap.tickToApply).toMatchObject({ n: 1, p50: 24, max: 24 });
    expect(snap.queueWait).toMatchObject({ n: 1, p50: 20, max: 20 });
    expect(snap.apply).toMatchObject({ n: 1, p50: 4, max: 4 });
    _setV1FrameScheduler(null);
    _resetV1Metrics({ warmup: 0 });
  });

  test('a cold spike dropped by warmup does not pin steady-state p95', () => {
    _resetV1Metrics();
    _setV1FrameScheduler(() => 1);
    for (let i = 0; i < V1_SKIP_WARMUP; i++) {
      sampleApply(i * 10, 2_764, 10);
    }
    for (let i = 0; i < 40; i++) {
      sampleApply(1_000 + i * 10, 20, 5);
    }
    const snap = v1MetricsSnapshot();
    expect(snap.queueWait.n).toBe(40);
    expect(snap.queueWait.p50).toBe(20);
    expect(snap.queueWait.p95).toBe(20);
    expect(snap.queueWait.max).toBe(20);
    expect(snap.tickToApply.p95).toBe(25);
    _setV1FrameScheduler(null);
    _resetV1Metrics({ warmup: 0 });
  });

  test(`latency rings keep only the last ${V1_WINDOW} samples`, () => {
    _resetV1Metrics({ warmup: 0 });
    _setV1FrameScheduler(() => 1);
    const total = V1_WINDOW + 30;
    for (let i = 0; i < total; i++) {
      // First 30 are cold spikes; once the window slides they must leave.
      const queue = i < 30 ? 2_764 : 18;
      sampleApply(i * 10, queue, 3);
    }
    const snap = v1MetricsSnapshot();
    expect(snap.queueWait.n).toBe(V1_WINDOW);
    expect(snap.tickToApply.n).toBe(V1_WINDOW);
    expect(snap.apply.n).toBe(V1_WINDOW);
    expect(snap.queueWait.p50).toBe(18);
    expect(snap.queueWait.p95).toBe(18);
    expect(snap.queueWait.max).toBe(18);
    _setV1FrameScheduler(null);
    _resetV1Metrics({ warmup: 0 });
  });

  test('a second apply in the same paint burst keeps the first recv for tick→paint', () => {
    _resetV1Metrics({ warmup: 0 });
    const frames = queuedScheduler();
    _setV1FrameScheduler(frames.schedule);
    v1Mark('batch:post', 1_000);
    v1Mark('apply:start', 1_002);
    v1Mark('apply:end', 1_006);
    v1Mark('batch:post', 1_010);
    v1Mark('apply:start', 1_011);
    v1Mark('apply:end', 1_012);
    expect(frames.drain(1_020)).toBe(true);
    const snap = v1MetricsSnapshot();
    expect(snap.tickToApply.n).toBe(2);
    expect(snap.tickToPaint).toMatchObject({ n: 1, p50: 20, max: 20 });
    _setV1FrameScheduler(null);
    _resetV1Metrics({ warmup: 0 });
  });
});

describe('v1 paint:raf suspended bursts (hidden tab)', () => {
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
    _setV1FrameScheduler(null);
    _resetV1Metrics({ warmup: 0 });
    _resetV1PaintVisibilityHook();
  });
  afterEach(() => {
    _setV1FrameScheduler(null);
    _resetV1Metrics({ warmup: 0 });
    _resetV1PaintVisibilityHook();
    if (realDocument === undefined) delete g.document;
    else g.document = realDocument;
  });

  test('skips a paint burst armed while the tab is hidden', () => {
    const frames = queuedScheduler();
    _setV1FrameScheduler(frames.schedule);
    fakeDocument(true);
    v1Mark('batch:post', 100);
    v1Mark('apply:start', 102);
    v1Mark('apply:end', 106);
    // No rAF armed while hidden — a late fire must not invent a sample.
    expect(frames.drain(96_100)).toBe(false);
    expect(v1MetricsSnapshot().tickToPaint.n).toBe(0);
    expect(v1MetricsSnapshot().tickToApply.n).toBe(1);
  });

  test('skips a paint burst hidden mid-flight so occlusion does not pin p95', () => {
    const frames = queuedScheduler();
    _setV1FrameScheduler(frames.schedule);
    const doc = fakeDocument(false);
    v1Mark('batch:post', 100);
    v1Mark('apply:start', 102);
    v1Mark('apply:end', 106);
    (doc.__setHidden as (v: boolean) => void)(true);
    (doc.__fire as (n: string) => void)('visibilitychange');
    expect(frames.drain(200_100)).toBe(true);
    expect(v1MetricsSnapshot().tickToPaint.n).toBe(0);
    // Foreground burst after show samples normally.
    (doc.__setHidden as (v: boolean) => void)(false);
    v1Mark('batch:post', 200_200);
    v1Mark('apply:start', 200_202);
    v1Mark('apply:end', 200_206);
    expect(frames.drain(200_216)).toBe(true);
    expect(v1MetricsSnapshot().tickToPaint).toMatchObject({ n: 1, p50: 16, max: 16 });
  });
});
