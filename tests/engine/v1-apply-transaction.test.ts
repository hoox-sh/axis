/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import { runApplyTransaction } from '../../src/engine/v1/apply-transaction';

describe('v1 apply transaction', () => {
  test('a continuous seq runs every step and commits once', () => {
    const order: string[] = [];
    const result = runApplyTransaction({
      seq: 2,
      lastSeq: 1,
      steps: [() => order.push('price'), () => order.push('plots')],
      commit: () => order.push('commit'),
    });
    expect(result).toEqual({ ok: true, action: 'commit' });
    expect(order).toEqual(['price', 'plots', 'commit']);
  });

  test('a duplicate seq is a replay and still commits', () => {
    let painted = 0;
    const result = runApplyTransaction({
      seq: 4,
      lastSeq: 4,
      commit: () => {
        painted += 1;
      },
    });
    expect(result).toEqual({ ok: true, action: 'replay' });
    expect(painted).toBe(1);
  });

  test('a seq gap does not run steps or commit', () => {
    const order: string[] = [];
    let reason = '';
    const result = runApplyTransaction({
      seq: 8,
      lastSeq: 5,
      steps: [() => order.push('price')],
      commit: () => order.push('commit'),
      onStale: (why) => {
        reason = why;
      },
    });
    expect(result).toEqual({ ok: false, reason: 'gap' });
    expect(reason).toBe('gap');
    expect(order).toEqual([]);
  });

  test('an acknowledged hole commits', () => {
    let painted = 0;
    const result = runApplyTransaction({
      seq: 8,
      lastSeq: 5,
      seqAckFrom: 5,
      commit: () => {
        painted += 1;
      },
    });
    expect(result).toEqual({ ok: true, action: 'commit' });
    expect(painted).toBe(1);
  });

  test('a forged ack from the wrong cursor does not commit', () => {
    const result = runApplyTransaction({
      seq: 8,
      lastSeq: 5,
      seqAckFrom: 4,
      commit: () => {
        throw new Error('should not paint');
      },
    });
    expect(result).toEqual({ ok: false, reason: 'gap' });
  });

  test('a rewind does not commit', () => {
    const result = runApplyTransaction({
      seq: 1,
      lastSeq: 4,
      commit: () => {
        throw new Error('should not paint');
      },
    });
    expect(result).toEqual({ ok: false, reason: 'rewind' });
  });

  test('a missing seq skips the seq gate', () => {
    const result = runApplyTransaction({
      seq: null,
      lastSeq: 9,
      commit: () => {},
    });
    expect(result).toEqual({ ok: true, action: 'commit' });
  });

  test('a generation mismatch aborts before steps', () => {
    const order: string[] = [];
    const result = runApplyTransaction({
      seq: 3,
      lastSeq: 2,
      generation: 1,
      currentGeneration: 2,
      steps: [() => order.push('price')],
      commit: () => order.push('commit'),
    });
    expect(result).toEqual({ ok: false, reason: 'generation' });
    expect(order).toEqual([]);
  });

  test('a thrown step skips the rest and the commit', () => {
    const order: string[] = [];
    const result = runApplyTransaction({
      seq: 2,
      lastSeq: 1,
      steps: [
        () => order.push('price'),
        () => {
          throw new Error('plot');
        },
        () => order.push('markers'),
      ],
      commit: () => order.push('commit'),
    });
    expect(result).toEqual({ ok: false, reason: 'aborted' });
    expect(order).toEqual(['price']);
  });

  test('a thrown commit is aborted after the steps', () => {
    const order: string[] = [];
    const result = runApplyTransaction({
      seq: 2,
      lastSeq: 1,
      steps: [() => order.push('price')],
      commit: () => {
        order.push('commit');
        throw new Error('paint');
      },
    });
    expect(result).toEqual({ ok: false, reason: 'aborted' });
    expect(order).toEqual(['price', 'commit']);
  });

  test('pane skew and plot length refuse the commit', () => {
    const skew = runApplyTransaction({
      seq: 2,
      lastSeq: 1,
      check: { priceTime: 120, paneTimes: [120, 60] },
      commit: () => {
        throw new Error('should not paint');
      },
    });
    const lengths = runApplyTransaction({
      seq: 2,
      lastSeq: 1,
      check: { barTimes: [60, 120], plotLengths: [2, 1] },
      commit: () => {
        throw new Error('should not paint');
      },
    });
    expect(skew.ok).toBe(false);
    expect(lengths.ok).toBe(false);
    if (!skew.ok) expect(skew.reason).toBe('pane-skew');
    if (!lengths.ok) expect(lengths.reason).toBe('plot-length');
  });
});
