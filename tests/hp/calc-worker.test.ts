/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Calc worker driver (hp2 C1): the pure `CalcEngine` behind the worker
 * entry, driven with the PYNE-recorded `barstate-parity` fixture as the
 * HP-off reference — indicator values must be identical.
 *
 * Covered: snapshot replay from posted bars, replay from cold on rebind
 * (cold input, not main-thread bars), scratch tips that never commit,
 * commit-on-append, per-series isolation, and the no-rewalk bound
 * (evaluate calls = bars + tips, never bars × tips).
 */

import { describe, expect, test } from 'bun:test';
import { CalcEngine } from '../../src/hp/workers/calc-engine';
import type { CalcBar } from '../../src/hp/workers/calc-core';
import type { CalcToHost, TimedValues } from '../../src/hp/workers/calc-protocol';
import fixtureJson from './fixtures/barstate-parity.json';

type ParityFixture = {
  bars: CalcBar[];
  cases: Array<{ id: string; plot?: string; confirmed?: number[] }>;
};

const fixture = fixtureJson as unknown as ParityFixture;

function timedValues(plot: string, confirmed: number[]): TimedValues[] {
  return fixture.bars.map((bar, i) => ({
    time: bar.time,
    plots: { [plot]: confirmed[i] ?? null },
  }));
}

function plotsOf(reply: CalcToHost | null): Record<string, (number | null)[]> {
  if (reply?.type !== 'plots') throw new Error(`expected plots, got ${reply?.type}`);
  return reply.series;
}

describe('calc engine (hp2 C1)', () => {
  test('snapshot replay matches the PYNE-recorded confirmed series', () => {
    const engine = new CalcEngine();
    expect(engine.dispatch({ type: 'init' })).toEqual({ type: 'ready' });
    const found = fixture.cases.find((c) => c.id === 'ta-cum');
    if (!found?.plot || !found.confirmed) throw new Error('ta-cum case missing');
    const reply = engine.dispatch({
      type: 'snapshot',
      seriesId: 's1',
      bars: fixture.bars,
      values: timedValues(found.plot, found.confirmed),
    });
    expect(reply?.type).toBe('plots');
    if (reply?.type !== 'plots') return;
    expect(reply.committed).toBe(fixture.bars.length);
    expect(reply.tip).toBeNull();
    expect(reply.series[found.plot]).toEqual(found.confirmed);
  });

  test('rebind replays from cold, not from reposted bars', () => {
    const engine = new CalcEngine();
    engine.dispatch({ type: 'init' });
    const found = fixture.cases.find((c) => c.id === 'var-assignment');
    if (!found?.plot || !found.confirmed) throw new Error('var-assignment case missing');
    const values = timedValues(found.plot, found.confirmed);
    const first = engine.dispatch({ type: 'snapshot', seriesId: 's1', bars: fixture.bars, values });
    // Same series, new snapshot with NO bars: the replay must come from
    // the cold the first snapshot seeded — identical committed series.
    const second = engine.dispatch({ type: 'snapshot', seriesId: 's1', bars: [], values });
    expect(plotsOf(second)[found.plot]).toEqual(plotsOf(first)[found.plot]);
  });

  test('tips stay scratch; only appends commit (valuewhen + barstate flags)', () => {
    const engine = new CalcEngine();
    engine.dispatch({ type: 'init' });
    const found = fixture.cases.find((c) => c.id === 'valuewhen-confirmed');
    if (!found?.plot || !found.confirmed) throw new Error('valuewhen case missing');
    const values = timedValues(found.plot, found.confirmed);
    engine.dispatch({ type: 'snapshot', seriesId: 's1', bars: fixture.bars, values });
    const before = engine.committedSeries('s1')?.[found.plot];
    // Three forming ticks on a new slot: scratch only.
    const tipTime = fixture.bars[fixture.bars.length - 1]!.time + 60;
    for (const close of [200, 201, 202]) {
      const tip = engine.dispatch({
        type: 'tip',
        seriesId: 's1',
        bar: { time: tipTime, open: close, high: close, low: close, close, volume: 1 },
        values: { [found.plot]: close },
      });
      if (tip?.type !== 'plots') throw new Error('expected plots');
      expect(tip.tip).toEqual({ [found.plot]: close });
      expect(tip.committed).toBe(fixture.bars.length);
    }
    expect(engine.committedSeries('s1')?.[found.plot]).toEqual(before);
    // Closing the bar commits exactly one cell.
    const appended = engine.dispatch({
      type: 'append',
      seriesId: 's1',
      bar: { time: tipTime, open: 200, high: 202, low: 200, close: 202, volume: 3 },
      values: { [found.plot]: 202 },
    });
    if (appended?.type !== 'plots') throw new Error('expected plots');
    expect(appended.committed).toBe(fixture.bars.length + 1);
    expect(appended.tip).toBeNull();
    expect(appended.series[found.plot]?.length).toBe(fixture.bars.length + 1);
  });

  test('tip evaluation never re-walks history (bars + tips, not bars x tips)', () => {
    const engine = new CalcEngine();
    engine.dispatch({ type: 'init' });
    const n = fixture.bars.length;
    const values = timedValues(
      'cum',
      fixture.bars.map((b) => b.close),
    );
    engine.dispatch({ type: 'snapshot', seriesId: 's1', bars: fixture.bars, values });
    const tipTime = fixture.bars[n - 1]!.time + 60;
    const tipBar = { time: tipTime, open: 1, high: 1, low: 1, close: 1, volume: 1 };
    engine.dispatch({ type: 'tip', seriesId: 's1', bar: tipBar, values: { cum: 1 } });
    engine.dispatch({ type: 'tip', seriesId: 's1', bar: tipBar, values: { cum: 2 } });
    engine.dispatch({ type: 'tip', seriesId: 's1', bar: tipBar, values: { cum: 3 } });
    // 12 snapshot evals + 3 tip evals. A scratch implementation that
    // re-walked committed state per tick would show 12 + 3 × 12.
    expect(engine.evalCalls('s1')).toBe(n + 3);
  });

  test('series are isolated; reset drops one or all', () => {
    const engine = new CalcEngine();
    engine.dispatch({ type: 'init' });
    const values = timedValues(
      'cum',
      fixture.bars.map((b) => b.close),
    );
    engine.dispatch({ type: 'snapshot', seriesId: 'a', bars: fixture.bars, values });
    engine.dispatch({ type: 'snapshot', seriesId: 'b', bars: fixture.bars.slice(0, 4), values });
    expect(engine.committedSeries('a')?.cum).toHaveLength(12);
    expect(engine.committedSeries('b')?.cum).toHaveLength(4);
    engine.dispatch({ type: 'reset', seriesId: 'b' });
    expect(engine.committedSeries('b')).toBeNull();
    expect(engine.committedSeries('a')?.cum).toHaveLength(12);
    engine.dispatch({ type: 'reset' });
    expect(engine.committedSeries('a')).toBeNull();
  });

  test('unknown series and malformed messages answer error, never throw', () => {
    const engine = new CalcEngine();
    const tip = engine.dispatch({ type: 'tip', seriesId: 'nope', bar: fixture.bars[0]! });
    expect(tip?.type).toBe('error');
    expect(engine.dispatch({ type: 'reset', seriesId: 'nope' })).toBeNull();
    expect(engine.evalCalls('nope')).toBeNull();
  });
});
