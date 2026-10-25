import { describe, expect, test } from 'bun:test';
import {
  Redesign2ApplyStateManager,
  Redesign2DeltaApplier,
  scriptDeltaTimeTail,
} from '../../src/engine/client-apply';
import { _resetV1Metrics, v1MetricsSnapshot } from '../../src/engine/v1/metrics';
import { alignSeriesToTimes } from '../../src/indicators/runner';

describe('redesign2 client apply', () => {
  test('full result applies once, then deltas', () => {
    const mgr = new Redesign2ApplyStateManager();
    expect(mgr.shouldApplyFull()).toBe(true);
    mgr.requestFull();
    mgr.markFullApplied();
    expect(mgr.currentState).toBe('full-applied');
    expect(mgr.shouldApplyFull()).toBe(false);
    mgr.markDeltaApplied();
    expect(mgr.currentState).toBe('delta-only');
  });

  test('delta before full throws', () => {
    const mgr = new Redesign2ApplyStateManager();
    expect(() => mgr.markDeltaApplied()).toThrow();
  });
});

describe('script delta time axis', () => {
  test('a forming tick keeps the closed bar times and an append takes the new candle', () => {
    const cached = [60, 120, 180];
    expect(
      scriptDeltaTimeTail(cached, { base_index: 2, count: 3, tail_len: 1 }, []),
    ).toEqual([180]);
    // The chart has already slid to the new candle. The closed stamps stay put.
    expect(
      scriptDeltaTimeTail(cached, { base_index: 3, count: 4, tail_len: 1 }, [120, 180, 240]),
    ).toEqual([240]);
  });

  test('joining by those times does not move a closed %B onto the next candle', () => {
    const values = [0.1, 0.2, 0.8];
    const times = [60, 120, 180];
    const nextTime = scriptDeltaTimeTail(times, { base_index: 3, count: 4, tail_len: 1 }, [240])!;
    const mergedValues = [...values, 0.4];
    const mergedTimes = [...times, ...nextTime];
    const chart = [120, 180, 240];
    expect(alignSeriesToTimes(mergedValues, mergedTimes, chart)).toEqual([0.2, 0.8, 0.4]);
  });
});

describe('redesign2 delta applier (F-06)', () => {
  const full = {
    seq: 10,
    plots: [[1], [2], [3]],
    series: { a: [1, 2, 3] },
    count: 3,
  };

  test('applies full then splices delta tails', () => {
    const applier = new Redesign2DeltaApplier();
    applier.applyFull(full);
    const out = applier.applyDelta({
      seq: 11,
      base_index: 2,
      count: 3,
      tail_len: 1,
      plots: [[9]],
      series: { a: [9] },
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect((out.full.series as Record<string, number[]>).a).toEqual([1, 2, 9]);
      expect(out.replayed).toBe(false);
    }
  });

  test('delta before full reports delta-before-full', () => {
    const applier = new Redesign2DeltaApplier();
    const out = applier.applyDelta({ seq: 1, base_index: 0, count: 1, tail_len: 1, series: { a: [1] } });
    expect(out).toEqual({ ok: false, reason: 'delta-before-full' });
  });

  test('an acknowledged keepalive hole applies and does not count as a gap', () => {
    _resetV1Metrics();
    const applier = new Redesign2DeltaApplier();
    applier.applyFull(full);
    const out = applier.applyDelta({
      seq: 12,
      seqAckFrom: 10,
      base_index: 2,
      count: 3,
      tail_len: 1,
      plots: [[9]],
      series: { a: [9] },
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.full.seqAckFrom).toBeUndefined();
      expect((out.full.series as Record<string, number[]>).a).toEqual([1, 2, 9]);
    }
    expect(applier.lastSeq).toBe(12);
    expect(v1MetricsSnapshot().counts.seqGap).toBe(0);
    expect(v1MetricsSnapshot().counts.droppedTip).toBe(1);
    const wrong = new Redesign2DeltaApplier();
    wrong.applyFull(full);
    const rejected = wrong.applyDelta({
      seq: 13,
      seqAckFrom: 9,
      base_index: 2,
      count: 3,
      tail_len: 1,
      series: { a: [9] },
    });
    expect(rejected).toEqual({ ok: false, reason: 'needs-full' });
    expect(v1MetricsSnapshot().counts.seqGap).toBe(1);
    _resetV1Metrics();
  });

  test('seq gap and rebase report needs-full', () => {
    const applier = new Redesign2DeltaApplier();
    applier.applyFull(full);
    const gap = applier.applyDelta({ seq: 13, base_index: 2, count: 3, tail_len: 1, series: { a: [9] } });
    expect(gap).toEqual({ ok: false, reason: 'needs-full' });
    const rebase = applier.applyDelta({ seq: 11, base_index: 0, count: 1, tail_len: 1, series: { a: [9] } });
    expect(rebase.ok).toBe(false);
  });

  test('duplicate seq replays the cache', () => {
    const applier = new Redesign2DeltaApplier();
    applier.applyFull(full);
    const out = applier.applyDelta({ seq: 10, base_index: 2, count: 3, tail_len: 1, series: { a: [9] } });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.replayed).toBe(true);
      expect((out.full.series as Record<string, number[]>).a).toEqual([1, 2, 3]);
    }
  });

  test('full stamps snapshot; forming: true stamps tip; forming: false stamps append', () => {
    const applier = new Redesign2DeltaApplier();
    const snap = applier.applyFull(full);
    expect(snap.executionContext).toBe('snapshot');
    const tip = applier.applyDelta({
      seq: 11,
      base_index: 2,
      count: 3,
      tail_len: 1,
      forming: true,
      plots: [[9]],
      series: { a: [9] },
    });
    expect(tip.ok).toBe(true);
    if (tip.ok) {
      expect(tip.executionContext).toBe('tip');
      expect(tip.full.executionContext).toBe('tip');
    }
    const append = applier.applyDelta({
      seq: 12,
      base_index: 3,
      count: 4,
      tail_len: 1,
      forming: false,
      plots: [[8]],
      series: { a: [8] },
    });
    expect(append.ok).toBe(true);
    if (append.ok) expect(append.executionContext).toBe('append');
  });
});