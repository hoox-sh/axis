/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import {
  appendCloseBarState,
  type BarStateContext,
  commitsAccumulators,
  snapshotBarState,
  snapshotTipBarState,
  tipBarState,
} from '../../src/hp/calc/barstate';
import {
  type CalcBar,
  type CalcEvaluator,
  CalcSession,
  type CalcPlotValues,
} from '../../src/hp/workers/calc-core';
import fixtureJson from './fixtures/barstate-parity.json';

/** Loose shape of `tests/hp/fixtures/barstate-parity.json` (recorded from PYNE). */
interface ParityFixture {
  bars: CalcBar[];
  cases: Array<{
    id: string;
    plot?: string;
    confirmed?: number[];
    plots?: Record<string, number[]>;
  }>;
}

const fixture: ParityFixture = fixtureJson;

function valueCase(id: string): { plot: string; confirmed: number[] } {
  const found = fixture.cases.find((c) => c.id === id);
  if (!found?.plot || !found.confirmed) {
    throw new Error(`fixture case "${id}" is missing plot/confirmed`);
  }
  return { plot: found.plot, confirmed: found.confirmed };
}

/** `ta.cum(close)` — the accumulator folds only on confirmed bars; the plot includes the tick's close. */
class CumEvaluator implements CalcEvaluator {
  private cum = 0;

  reset(): void {
    this.cum = 0;
  }

  evaluate(bar: CalcBar, _ctx: BarStateContext): CalcPlotValues {
    return { cum: this.cum + bar.close };
  }

  commit(bar: CalcBar, ctx: BarStateContext): void {
    if (commitsAccumulators(ctx)) this.cum += bar.close;
  }

  snapshotCommitted(): unknown {
    return this.cum;
  }

  restoreCommitted(snapshot: unknown): void {
    if (typeof snapshot === 'number') this.cum = snapshot;
  }
}

/** `ta.valuewhen(barstate.isconfirmed, close, 0)` — scratch ticks must not overwrite the last confirmed close. */
class ValueWhenEvaluator implements CalcEvaluator {
  private lastConfirmed = Number.NaN;

  constructor(private readonly plot: string) {}

  reset(): void {
    this.lastConfirmed = Number.NaN;
  }

  evaluate(bar: CalcBar, ctx: BarStateContext): CalcPlotValues {
    return { [this.plot]: ctx.isconfirmed ? bar.close : this.lastConfirmed };
  }

  commit(bar: CalcBar, ctx: BarStateContext): void {
    if (commitsAccumulators(ctx)) this.lastConfirmed = bar.close;
  }

  snapshotCommitted(): unknown {
    return this.lastConfirmed;
  }

  restoreCommitted(snapshot: unknown): void {
    if (typeof snapshot === 'number') this.lastConfirmed = snapshot;
  }
}

/** `var float x = na` / `x := close` on confirmed bars — same commit shape as valuewhen. */
class VarEvaluator implements CalcEvaluator {
  private x = Number.NaN;

  constructor(private readonly plot: string) {}

  reset(): void {
    this.x = Number.NaN;
  }

  evaluate(bar: CalcBar, ctx: BarStateContext): CalcPlotValues {
    return { [this.plot]: ctx.isconfirmed ? bar.close : this.x };
  }

  commit(bar: CalcBar, ctx: BarStateContext): void {
    if (commitsAccumulators(ctx)) this.x = bar.close;
  }

  snapshotCommitted(): unknown {
    return this.x;
  }

  restoreCommitted(snapshot: unknown): void {
    if (typeof snapshot === 'number') this.x = snapshot;
  }
}

/** Records every evaluation context; plots nothing. */
class FlagsRecorder implements CalcEvaluator {
  readonly contexts: BarStateContext[] = [];

  reset(): void {
    this.contexts.length = 0;
  }

  evaluate(_bar: CalcBar, ctx: BarStateContext): CalcPlotValues {
    this.contexts.push(ctx);
    return {};
  }

  /** No committed state to fold — the recorder only watches contexts. */
  commit(): void {
    /* no-op: nothing to commit */
  }

  snapshotCommitted(): unknown {
    return null;
  }

  /** Nothing to restore — contexts recorded so far stay valid. */
  restoreCommitted(): void {
    /* no-op: nothing to restore */
  }
}

function recordedFlags(contexts: readonly BarStateContext[]): Record<string, number[]> {
  const bit = (value: boolean) => (value ? 1 : 0);
  return {
    isnew: contexts.map((c) => bit(c.isnew)),
    isconfirmed: contexts.map((c) => bit(c.isconfirmed)),
    isrealtime: contexts.map((c) => bit(c.isrealtime)),
    isfirst: contexts.map((c) => bit(c.isfirst)),
    islast: contexts.map((c) => bit(c.islast)),
  };
}

describe('§10.1 execution contexts', () => {
  test('snapshot replay: new + confirmed, never realtime, isfirst only at 0, never islast while a bar follows', () => {
    for (let i = 0; i < 12; i++) {
      // A later bar always follows a replayed bar (another closed bar or the forming tip).
      const ctx = snapshotBarState(i, true);
      expect(ctx.isnew).toBe(true);
      expect(ctx.isconfirmed).toBe(true);
      expect(ctx.isrealtime).toBe(false);
      expect(ctx.isfirst).toBe(i === 0);
      expect(ctx.islast).toBe(false);
    }
    // Nothing follows the final replayed bar of a forming-less snapshot → it is islast.
    expect(snapshotBarState(11, false).islast).toBe(true);
  });

  test('snapshot forming tip: a continuation — not new, not confirmed, realtime, islast', () => {
    expect(snapshotTipBarState()).toEqual({
      isnew: false,
      isconfirmed: false,
      isrealtime: true,
      isfirst: false,
      islast: true,
    });
  });

  test('tip: never confirmed, isnew only on the first tip of a slot', () => {
    expect(tipBarState(true)).toEqual({
      isnew: true,
      isconfirmed: false,
      isrealtime: true,
      isfirst: false,
      islast: true,
    });
    expect(tipBarState(false)).toEqual({
      isnew: false,
      isconfirmed: false,
      isrealtime: true,
      isfirst: false,
      islast: true,
    });
  });

  test('append close: confirmed + realtime, not new, islast', () => {
    expect(appendCloseBarState()).toEqual({
      isnew: false,
      isconfirmed: true,
      isrealtime: true,
      isfirst: false,
      islast: true,
    });
  });

  test('accumulators commit exactly when isconfirmed', () => {
    expect(commitsAccumulators(snapshotBarState(0, true))).toBe(true);
    expect(commitsAccumulators(appendCloseBarState())).toBe(true);
    expect(commitsAccumulators(snapshotTipBarState())).toBe(false);
    expect(commitsAccumulators(tipBarState(true))).toBe(false);
    expect(commitsAccumulators({ ...tipBarState(false), isconfirmed: true })).toBe(true);
    expect(commitsAccumulators({ ...appendCloseBarState(), isconfirmed: false })).toBe(false);
  });
});

describe('PYNE parity (barstate-parity.json)', () => {
  const valueSpecs: Array<{
    id: string;
    make: () => CalcEvaluator;
    expectedTip: (committedLast: number, tickClose: number) => number;
  }> = [
    {
      id: 'ta-cum',
      make: () => new CumEvaluator(),
      // The tip plots cum + tick close, but only against the *committed* cum —
      // wild ticks must never accumulate into each other.
      expectedTip: (committedLast, tickClose) => committedLast + tickClose,
    },
    {
      id: 'valuewhen-confirmed',
      make: () => new ValueWhenEvaluator('valuewhen_confirmed_close'),
      // Unconfirmed: the plot holds the last confirmed close regardless of the tick.
      expectedTip: (committedLast) => committedLast,
    },
    {
      id: 'var-assignment',
      make: () => new VarEvaluator('var_x'),
      expectedTip: (committedLast) => committedLast,
    },
  ];

  for (const spec of valueSpecs) {
    test(`${spec.id}: snapshot parity, scratch-only tips, append parity`, () => {
      const { plot, confirmed } = valueCase(spec.id);
      const session = new CalcSession(spec.make());

      // 11 closed bars + the 12th forming: committed matches the PYNE closed run prefix.
      session.onSnapshot(fixture.bars.slice(0, 11), { forming: fixture.bars[11] });
      expect(session.committedBarCount).toBe(11);
      expect(session.plotSeries(plot)).toEqual(confirmed.slice(0, 11));

      // Three wild ticks on the forming bar: each tip is scratch — committed
      // cells and the committed bar count stay frozen.
      const frozen = [...session.plotSeries(plot)];
      const committedLast = frozen[frozen.length - 1];
      if (typeof committedLast !== 'number')
        throw new Error('last committed cell should be numeric');
      for (const tickClose of [200, 150, 125]) {
        const tip = session.onTipUpdate({ ...fixture.bars[11], close: tickClose });
        expect(session.plotSeries(plot)).toEqual(frozen);
        expect(session.committedBarCount).toBe(11);
        expect(session.tipPlotValues).not.toBeNull();
        if (!tip) throw new Error('tip plots missing');
        expect(tip[plot]).toBe(spec.expectedTip(committedLast, tickClose));
      }

      // APPEND_BAR commits the recorded final bar: full PYNE closed-run parity.
      session.onAppendBar(fixture.bars[11]);
      expect(session.committedBarCount).toBe(12);
      expect(session.plotSeries(plot)).toEqual(confirmed);
      expect(session.tipPlotValues).toBeNull();
    });
  }

  test('barstate flags parity: recorded replay contexts match the PYNE closed run', () => {
    const found = fixture.cases.find((c) => c.id === 'barstate-flags');
    if (!found?.plots) throw new Error('fixture case "barstate-flags" is missing plots');
    const recorder = new FlagsRecorder();
    const session = new CalcSession(recorder);
    session.onSnapshot(fixture.bars, {});
    expect(recordedFlags(recorder.contexts)).toEqual(found.plots);
  });

  test('append opens the next slot: first tip of the new time is isnew, its re-ticks are not', () => {
    const recorder = new FlagsRecorder();
    const session = new CalcSession(recorder);
    session.onSnapshot(fixture.bars.slice(0, 11), { forming: fixture.bars[11] });
    // A tip for the forming time continues the snapshot's slot — not isnew.
    session.onTipUpdate(fixture.bars[11]);
    expect(recorder.contexts.at(-1)?.isnew).toBe(false);

    session.onAppendBar(fixture.bars[11]);
    recorder.contexts.length = 0; // inspect only the upcoming tip contexts
    const nextTime = fixture.bars[11].time + 60;
    session.onTipUpdate({ ...fixture.bars[11], time: nextTime, close: 130 });
    expect(recorder.contexts.at(-1)?.isnew).toBe(true);
    expect(recorder.contexts.at(-1)?.isconfirmed).toBe(false);
    session.onTipUpdate({ ...fixture.bars[11], time: nextTime, close: 131 });
    expect(recorder.contexts.at(-1)?.isnew).toBe(false);
    expect(recorder.contexts.at(-1)?.isconfirmed).toBe(false);
  });
});
