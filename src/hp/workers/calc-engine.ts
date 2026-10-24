// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure calc-worker driver (hp2 C1): message → `CalcSession`, no Worker,
 * DOM, or SAB, so unit tests drive the exact code the worker runs.
 *
 * Two pieces:
 *
 * - `FrameValuesEvaluator`: the Pro-API `CalcEvaluator`. Plot values are
 *   server-evaluated and keyed by bar time; the evaluator only files them
 *   into the session under the scratch/commit discipline — it never
 *   computes Pine. `snapshotCommitted` / `restoreCommitted` are an O(1)
 *   committed cursor (save/restore an int): the Pyodide pickle-restore
 *   analog for a host with nothing to pickle. Tip evaluation never
 *   re-walks history — `evaluateCalls` counts it, and a test pins the
 *   bound (bars + tips, not bars × tips).
 * - `CalcEngine`: per-series `{ session, evaluator, cold }` lifecycle.
 *   Snapshots seed cold and replay **from cold** once it holds history
 *   (hp2 C1: cold input, not main-thread bars); hydrate merges IDB behind
 *   live bars instead of wiping them (same rule as the ingest worker).
 *
 * @module hp/workers/calc-engine
 */

import { ColdStore, hydrateColdFromCache } from '../memory/cold-store';
import { barToTicks } from '../memory/hot-buffer';
import { PRICE_SCALE_DEFAULT } from '../axb1/constants';
import {
  CalcSession,
  type CalcBar,
  type CalcEvaluator,
  type CalcPlotValues,
  type CommittedSeries,
} from './calc-core';
import type { ColdKey } from './protocol';
import type { CalcToHost, HostToCalc, TimedValues } from './calc-protocol';

/** Server-evaluated plots keyed by bar time (Pro-API path). */
export class FrameValuesEvaluator implements CalcEvaluator {
  private readonly valuesByTime = new Map<number, CalcPlotValues>();
  private cursor = 0;
  private calls = 0;

  /** How many `evaluate` calls ran (no-rewalk bound: bars + tips). */
  get evaluateCalls(): number {
    return this.calls;
  }

  /** Merge snapshot plot columns (time → plots). */
  setValues(entries: readonly TimedValues[] | undefined): void {
    if (!entries) return;
    for (const entry of entries) {
      if (entry && Number.isFinite(entry.time))
        this.valuesByTime.set(entry.time, entry.plots ?? {});
    }
  }

  /** Single tip/append values for one bar time. */
  setTipValues(time: number, plots: CalcPlotValues | null | undefined): void {
    if (!Number.isFinite(time)) return;
    this.valuesByTime.set(time, plots ?? {});
  }

  /** Plot names filed so far (for reading the committed series back out). */
  plotNames(): string[] {
    const names = new Set<string>();
    for (const plots of this.valuesByTime.values()) {
      for (const name of Object.keys(plots ?? {})) names.add(name);
    }
    return [...names];
  }

  reset(): void {
    // NOTE: the values map is driver-filed *input* (snapshot columns), not
    // runtime state — the session resets before every replay, so clearing
    // the map here would wipe the columns before the first evaluate.
    // Stale times are harmless: lookups are always by replayed bar time,
    // and each snapshot overwrites its own times.
    this.cursor = 0;
  }

  evaluate(bar: CalcBar): CalcPlotValues {
    this.calls += 1;
    return this.valuesByTime.get(bar.time) ?? {};
  }

  commit(): void {
    this.cursor += 1;
  }

  snapshotCommitted(): unknown {
    return this.cursor;
  }

  restoreCommitted(snapshot: unknown): void {
    if (typeof snapshot === 'number') this.cursor = Math.trunc(snapshot);
  }
}

type SeriesState = {
  session: CalcSession;
  evaluator: FrameValuesEvaluator;
  cold: ColdStore;
};

function toCalcBar(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
): CalcBar {
  return { time, open, high, low, close, volume };
}

function coldToCalcBars(cold: ColdStore): CalcBar[] {
  return cold
    .readBars(0, cold.length)
    .map((b) => toCalcBar(b.time, b.open, b.high, b.low, b.close, b.volume ?? 0));
}

/** Pure per-series calc sessions + cold history. The worker entry wraps this. */
export class CalcEngine {
  private readonly series = new Map<string, SeriesState>();
  private coldKey: ColdKey | undefined;
  private priceScale = PRICE_SCALE_DEFAULT;
  private pendingHydrates: Array<Promise<void>> = [];

  /** Test hook: wait out background IDB hydrates. */
  settled(): Promise<void> {
    const pending = this.pendingHydrates;
    this.pendingHydrates = [];
    return Promise.all(pending).then(() => undefined);
  }

  /** `evaluate` calls for one series (no-rewalk bound). */
  evalCalls(seriesId: string): number | null {
    const state = this.series.get(seriesId);
    return state ? state.evaluator.evaluateCalls : null;
  }

  /** Committed plot series for one series (tests, future paint). */
  committedSeries(seriesId: string): CommittedSeries | null {
    const state = this.series.get(seriesId);
    if (!state) return null;
    return seriesOf(state);
  }

  dispatch(msg: HostToCalc): CalcToHost | null {
    if (!msg || typeof msg !== 'object') return null;
    switch (msg.type) {
      case 'init': {
        if (msg.coldKey) this.coldKey = msg.coldKey;
        if (Number.isFinite(msg.priceScale)) this.priceScale = Math.trunc(msg.priceScale as number);
        return { type: 'ready' };
      }
      case 'snapshot':
        return this.onSnapshot(msg.seriesId, msg.bars, msg.values, msg.forming ?? null);
      case 'tip':
        return this.onTip(msg.seriesId, msg.bar, msg.values ?? null);
      case 'append':
        return this.onAppend(msg.seriesId, msg.bar, msg.values ?? null);
      case 'reset': {
        if (msg.seriesId) this.series.delete(msg.seriesId);
        else this.series.clear();
        return null;
      }
      default:
        return null;
    }
  }

  private stateFor(seriesId: string): SeriesState | null {
    if (!seriesId) return null;
    let state = this.series.get(seriesId);
    if (!state) {
      const evaluator = new FrameValuesEvaluator();
      const session = new CalcSession(evaluator);
      const cold = new ColdStore({ priceScale: this.priceScale });
      state = { session, evaluator, cold };
      this.series.set(seriesId, state);
      this.hydrate(state);
    }
    return state;
  }

  private hydrate(state: SeriesState): void {
    const key = this.coldKey;
    if (!key?.sourceId || !key.symbol || !key.interval) return;
    const target = state.cold;
    const job = (async () => {
      try {
        const seed = new ColdStore({ priceScale: target.priceScale, max: target.max });
        const loaded = await hydrateColdFromCache(seed, key.sourceId, key.symbol, key.interval);
        if (loaded === 0) return;
        if (target.length === 0) target.setTicks(seed.toTicks());
        else target.upsertByTime(seed.toTicks());
      } catch {
        /* best-effort — the live feed still builds cold */
      }
    })();
    this.pendingHydrates.push(job);
    void job.then(() => {
      const i = this.pendingHydrates.indexOf(job);
      if (i >= 0) this.pendingHydrates.splice(i, 1);
    });
  }

  private onSnapshot(
    seriesId: string,
    bars: readonly CalcBar[],
    values: TimedValues[] | undefined,
    forming: CalcBar | null,
  ): CalcToHost | null {
    const state = this.stateFor(seriesId);
    if (!state) return { type: 'error', seriesId, reason: 'missing series id' };
    try {
      // Posted bars seed cold; the replay then reads cold when it holds
      // history (full-history replay, not the main 500-bar window).
      if (bars.length) {
        state.cold.upsertByTime(bars.map((b) => barToTicks(b, state.cold.priceScale)));
      }
      const replay = state.cold.length ? coldToCalcBars(state.cold) : [...bars];
      state.evaluator.setValues(values);
      state.session.onSnapshot(replay, forming ? { forming } : undefined);
      return this.plots(seriesId, state);
    } catch (err) {
      return { type: 'error', seriesId, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  private onTip(seriesId: string, bar: CalcBar, values: CalcPlotValues | null): CalcToHost | null {
    const state = this.series.get(seriesId);
    if (!state || !bar) return { type: 'error', seriesId, reason: 'unknown series' };
    try {
      state.evaluator.setTipValues(bar.time, values);
      const tip = state.session.onTipUpdate(bar);
      return {
        type: 'plots',
        seriesId,
        committed: state.session.committedBarCount,
        tip,
        series: seriesOf(state),
      };
    } catch (err) {
      return { type: 'error', seriesId, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  private onAppend(
    seriesId: string,
    bar: CalcBar,
    values: CalcPlotValues | null,
  ): CalcToHost | null {
    const state = this.series.get(seriesId);
    if (!state || !bar) return { type: 'error', seriesId, reason: 'unknown series' };
    try {
      state.evaluator.setTipValues(bar.time, values);
      state.session.onAppendBar(bar);
      return this.plots(seriesId, state);
    } catch (err) {
      return { type: 'error', seriesId, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  private plots(seriesId: string, state: SeriesState): CalcToHost {
    return {
      type: 'plots',
      seriesId,
      committed: state.session.committedBarCount,
      tip: state.session.tipPlotValues,
      series: seriesOf(state),
    };
  }
}

/** Read every committed plot out of a session (names come from filed values). */
function seriesOf(state: SeriesState): CommittedSeries {
  const out: CommittedSeries = {};
  for (const name of state.evaluator.plotNames()) out[name] = [...state.session.plotSeries(name)];
  return out;
}
