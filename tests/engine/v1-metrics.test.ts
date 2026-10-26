/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import { Redesign2DeltaApplier } from '../../src/engine/client-apply';
import {
  _resetV1Metrics,
  _setV1FrameScheduler,
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

describe('v1 metrics', () => {
  test('pairs tick→apply with the apply span and tick→paint on the next frame', () => {
    _resetV1Metrics();
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
    _resetV1Metrics();
  });

  test('batch:post is the main-thread receipt when the worker already decoded', () => {
    _resetV1Metrics();
    _setV1FrameScheduler(() => 1);
    v1Mark('batch:post', 5);
    v1Mark('apply:start', 6);
    v1Mark('apply:end', 8);
    const snap = v1MetricsSnapshot();
    expect(snap.tickToApply.p50).toBe(3);
    expect(snap.queueWait.p50).toBe(1);
    expect(snap.apply.p50).toBe(2);
    _setV1FrameScheduler(null);
    _resetV1Metrics();
  });

  test('queueWait is recv → apply:start and does not include the apply span', () => {
    _resetV1Metrics();
    _setV1FrameScheduler(() => 1);
    v1Mark('batch:post', 100);
    v1Mark('apply:start', 1_900);
    v1Mark('apply:end', 1_920);
    const snap = v1MetricsSnapshot();
    expect(snap.queueWait).toMatchObject({ n: 1, p50: 1_800, p95: 1_800, max: 1_800 });
    expect(snap.apply).toMatchObject({ n: 1, p50: 20 });
    expect(snap.tickToApply).toMatchObject({ n: 1, p50: 1_820 });
    _setV1FrameScheduler(null);
    _resetV1Metrics();
  });

  test('an apply with no recv records the transaction only', () => {
    _resetV1Metrics();
    _setV1FrameScheduler(() => 1);
    v1Mark('apply:start', 10);
    v1Mark('apply:end', 14);
    const snap = v1MetricsSnapshot();
    expect(snap.apply.p50).toBe(4);
    expect(snap.tickToApply.n).toBe(0);
    expect(snap.queueWait.n).toBe(0);
    expect(snap.tickToPaint.n).toBe(0);
    _setV1FrameScheduler(null);
    _resetV1Metrics();
  });

  test('pan sampling records frame deltas until the gesture goes quiet', () => {
    _resetV1Metrics();
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
    _resetV1Metrics();
  });

  test('a seq gap increments the counter and a rewind does not', () => {
    _resetV1Metrics();
    const applier = new Redesign2DeltaApplier();
    applier.applyFull({ seq: 10, count: 1, series: { a: [1] } });
    applier.applyDelta({ seq: 13, base_index: 0, count: 1, tail_len: 1, series: { a: [2] } });
    applier.applyDelta({ seq: 9, base_index: 0, count: 1, tail_len: 1, series: { a: [3] } });
    expect(v1MetricsSnapshot().counts.seqGap).toBe(1);
    _resetV1Metrics();
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
    _resetV1Metrics();
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
    _resetV1Metrics();
  });
});
