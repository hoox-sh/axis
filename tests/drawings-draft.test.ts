/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * In-progress drawing draft state machine (`createDraftController`).
 * Guards: idle → click phases, cancel, TOOL_SPECS completeness, commit payloads.
 */

import { describe, expect, it } from 'bun:test';
import {
  createDraftController,
  TOOL_SPECS,
  type ChartPoint,
} from '../src/chart/drawings/draft.ts';

const p = (time: number, price: number): ChartPoint => ({ time, price });

describe('createDraftController', () => {
  it('starts idle and exposes default TOOL_SPECS', () => {
    const d = createDraftController();
    expect(d.getPhase()).toEqual({ status: 'idle' });
    expect(d.previewPoints()).toBeNull();
    expect(d.onClick(p(1, 1))).toBeNull();
    expect(d.onFinish()).toBeNull();
    expect(TOOL_SPECS.map((s) => s.kind)).toEqual([
      'hline',
      'text',
      'trend',
      'ray',
      'rect',
      'fib',
      'measure',
      'channel',
      'polyline',
    ]);
  });

  it('arity 1: first click completes (hline / text)', () => {
    for (const kind of ['hline', 'text'] as const) {
      const d = createDraftController();
      d.begin(kind);
      expect(d.getPhase().status).toBe('placing');

      const done = d.onClick(p(100, 42));
      expect(done).toEqual({ kind, points: [p(100, 42)] });
      expect(d.getPhase()).toEqual({ status: 'idle' });
      expect(d.previewPoints()).toBeNull();
    }
  });

  it('arity 2: second click completes (trend)', () => {
    const d = createDraftController();
    d.begin('trend');

    expect(d.onClick(p(1, 10))).toBeNull();
    expect(d.getPhase()).toMatchObject({
      status: 'placing',
      kind: 'trend',
      points: [p(1, 10)],
      hover: null,
    });

    d.onMove(p(2, 20));
    expect(d.previewPoints()).toEqual([p(1, 10), p(2, 20)]);

    const done = d.onClick(p(3, 30));
    expect(done).toEqual({ kind: 'trend', points: [p(1, 10), p(3, 30)] });
    expect(d.getPhase()).toEqual({ status: 'idle' });
  });

  it('arity 2 covers ray/rect/fib/measure', () => {
    for (const kind of ['ray', 'rect', 'fib', 'measure'] as const) {
      const d = createDraftController();
      d.begin(kind);
      expect(d.onClick(p(0, 0))).toBeNull();
      expect(d.onClick(p(5, 5))).toEqual({ kind, points: [p(0, 0), p(5, 5)] });
    }
  });

  it('arity 3: third click completes (channel)', () => {
    const d = createDraftController();
    d.begin('channel');

    expect(d.onClick(p(1, 1))).toBeNull();
    expect(d.onClick(p(2, 2))).toBeNull();
    expect(d.getPhase()).toMatchObject({
      status: 'placing',
      points: [p(1, 1), p(2, 2)],
    });

    const done = d.onClick(p(3, 3));
    expect(done).toEqual({ kind: 'channel', points: [p(1, 1), p(2, 2), p(3, 3)] });
    expect(d.getPhase()).toEqual({ status: 'idle' });
  });

  it('arity n: onClick appends; onFinish when >= minPoints', () => {
    const d = createDraftController();
    d.begin('polyline');

    expect(d.onFinish()).toBeNull(); // 0 points
    expect(d.onClick(p(1, 1))).toBeNull();
    expect(d.onFinish()).toBeNull(); // 1 < min 2

    expect(d.onClick(p(2, 2))).toBeNull();
    d.onMove(p(9, 9));
    expect(d.previewPoints()).toEqual([p(1, 1), p(2, 2), p(9, 9)]);

    const done = d.onFinish();
    expect(done).toEqual({ kind: 'polyline', points: [p(1, 1), p(2, 2)] });
    expect(d.getPhase()).toEqual({ status: 'idle' });
  });

  it('arity n: can append more than minPoints before finish', () => {
    const d = createDraftController();
    d.begin('polyline');
    d.onClick(p(1, 1));
    d.onClick(p(2, 2));
    d.onClick(p(3, 3));
    d.onClick(p(4, 4));
    expect(d.onFinish()).toEqual({
      kind: 'polyline',
      points: [p(1, 1), p(2, 2), p(3, 3), p(4, 4)],
    });
  });

  it('onFinish is a no-op for fixed-arity tools', () => {
    const d = createDraftController();
    d.begin('trend');
    d.onClick(p(1, 1));
    expect(d.onFinish()).toBeNull();
    expect(d.getPhase().status).toBe('placing');
  });

  it('cancel resets to idle (mid-placement)', () => {
    const d = createDraftController();
    d.begin('channel');
    d.onClick(p(1, 1));
    d.onMove(p(2, 2));
    expect(d.previewPoints()).toEqual([p(1, 1), p(2, 2)]);

    d.cancel();
    expect(d.getPhase()).toEqual({ status: 'idle' });
    expect(d.previewPoints()).toBeNull();
    expect(d.onClick(p(3, 3))).toBeNull();
    expect(d.onFinish()).toBeNull();
  });

  it('begin resets an in-progress draft', () => {
    const d = createDraftController();
    d.begin('trend');
    d.onClick(p(1, 1));
    d.begin('hline');
    expect(d.getPhase()).toEqual({
      status: 'placing',
      kind: 'hline',
      points: [],
      hover: null,
    });
    expect(d.onClick(p(9, 9))).toEqual({ kind: 'hline', points: [p(9, 9)] });
  });

  it('previewPoints is committed only when hover is unset', () => {
    const d = createDraftController();
    d.begin('trend');
    d.onClick(p(1, 1));
    expect(d.previewPoints()).toEqual([p(1, 1)]);
    d.onMove(p(2, 2));
    expect(d.previewPoints()).toEqual([p(1, 1), p(2, 2)]);
  });

  it('throws on unknown kind', () => {
    const d = createDraftController();
    expect(() => d.begin('nope')).toThrow(/unknown/i);
  });

  it('accepts custom specs', () => {
    const d = createDraftController([{ kind: 'quad', arity: 'n', minPoints: 4 }]);
    d.begin('quad');
    d.onClick(p(1, 1));
    d.onClick(p(2, 2));
    d.onClick(p(3, 3));
    expect(d.onFinish()).toBeNull();
    d.onClick(p(4, 4));
    expect(d.onFinish()).toEqual({
      kind: 'quad',
      points: [p(1, 1), p(2, 2), p(3, 3), p(4, 4)],
    });
  });

  it('returns defensive copies of phase points', () => {
    const d = createDraftController();
    d.begin('trend');
    d.onClick(p(1, 1));
    const phase = d.getPhase();
    if (phase.status !== 'placing') throw new Error('expected placing');
    phase.points[0]!.price = 999;
    phase.points.push(p(0, 0));
    const again = d.getPhase();
    if (again.status !== 'placing') throw new Error('expected placing');
    expect(again.points).toEqual([p(1, 1)]);
  });
});
