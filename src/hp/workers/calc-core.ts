// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Calc session state machine (HP PR 6, §10.2): SNAPSHOT replay, scratch
 * TIP_UPDATE, commit-on-APPEND_BAR — without a Worker, DOM, or SAB, so the
 * ingest worker and unit tests share it.
 *
 * `CalcSession` owns the committed plot series and the scratch-vs-commit
 * split: a tip is evaluated on a *restored* committed snapshot so ticks
 * never accumulate into each other, and only the append of a closed bar
 * folds values into committed state (§10.1: accumulators commit iff
 * `isconfirmed`). PYNE parity of the resulting series is pinned by
 * `tests/hp/fixtures/barstate-parity.json`.
 *
 * Pyodide note: a host that cannot clone state cheaply (Pyodide) must
 * replay the last closed bar + tip from committed pickled state instead of
 * re-walking 10k bars — do not re-walk history per tick.
 *
 * @module hp/workers/calc-core
 */

import {
  appendCloseBarState,
  type BarStateContext,
  snapshotBarState,
  snapshotTipBarState,
  tipBarState,
} from '../calc/barstate';

/** One OHLCV bar as the calc state machine sees it (already scaled to price/volume floats). */
export type CalcBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** Plot-name → last evaluated cell (`null` = na). */
export type CalcPlotValues = Record<string, number | null>;

/**
 * The Pine runtime the session drives (PYNE in a worker, Pyodide, or a
 * test double). `evaluate` must be pure with respect to committed state —
 * only `commit` folds a bar into durable runtime state; `snapshot` /
 * `restore` are the cheap state clone the tip path relies on.
 */
export interface CalcEvaluator {
  /** Drop all runtime state (start of a SNAPSHOT replay). */
  reset(): void;
  /** Evaluate one bar under `ctx`; must not mutate committed state. */
  evaluate(bar: CalcBar, ctx: BarStateContext): CalcPlotValues;
  /** Fold a confirmed bar into committed runtime state. */
  commit(bar: CalcBar, ctx: BarStateContext): void;
  /** Opaque cheap clone of committed runtime state (for the scratch base). */
  snapshotCommitted(): unknown;
  /** Replace committed runtime state with a clone taken by `snapshotCommitted`. */
  restoreCommitted(snapshot: unknown): void;
}

/** Committed plot series: one `(number | null)[]` per plot name, one cell per committed bar. */
export type CommittedSeries = Record<string, (number | null)[]>;

/**
 * Drives a `CalcEvaluator` through the §10.2 state machine while owning the
 * committed plot series.
 *
 * Scratch rationale: TIP_UPDATE restores the committed snapshot *before*
 * evaluating, so a forming bar's N ticks each start from the same state —
 * a tick can never leak into the next tick or into committed history. Only
 * APPEND_BAR commits, and it snapshots the new committed state as the next
 * slot's scratch base (bar T+1 itself is not evaluated: its OHLCV does not
 * exist until tips arrive, so its first tip is `isnew`).
 */
export class CalcSession {
  private readonly evaluator: CalcEvaluator;
  private series: CommittedSeries = {};
  private committedCount = 0;
  /** Evaluator state clone every tip restores from; `scratchSeeded` guards it before any snapshot. */
  private scratchBase: unknown = null;
  private scratchSeeded = false;
  private tipTime: number | null = null;
  private tipValues: CalcPlotValues | null = null;

  constructor(evaluator: CalcEvaluator) {
    this.evaluator = evaluator;
  }

  /** How many closed bars have been committed (the forming tip never counts). */
  get committedBarCount(): number {
    return this.committedCount;
  }

  /** Plots of the last scratch (tip) evaluation, or `null` when no tip has been evaluated. */
  get tipPlotValues(): CalcPlotValues | null {
    return this.tipValues;
  }

  /** The committed cells of one plot (never includes the forming tip). */
  plotSeries(name: string): readonly (number | null)[] {
    const cells: (number | null)[] | undefined = this.series[name];
    return cells ?? [];
  }

  /**
   * SNAPSHOT: reset committed state, replay the closed bars, then snapshot
   * committed as the scratch base. An optional `forming` bar is evaluated
   * once as scratch (never committed) and seeds the tip time slot.
   */
  onSnapshot(bars: readonly CalcBar[], opts?: { forming?: CalcBar | null }): void {
    const forming = opts?.forming ?? null;
    this.evaluator.reset();
    this.series = {};
    this.committedCount = 0;
    this.tipTime = null;
    this.tipValues = null;
    const count = bars.length;
    for (let i = 0; i < count; i++) {
      // Only the final replayed bar may be `islast`, and only when nothing
      // follows it. The helper sees one index, so the session folds "a later
      // bar exists (forming or not)" into its flag per index — otherwise
      // every replayed bar would claim `islast` and PYNE parity (fixture:
      // 1 only on the last closed bar) would break.
      const laterBarExists = forming !== null || i < count - 1;
      const ctx = snapshotBarState(i, laterBarExists);
      const bar = bars[i];
      const values = this.evaluator.evaluate(bar, ctx);
      this.pushCommitted(values);
      this.evaluator.commit(bar, ctx);
    }
    this.scratchBase = this.evaluator.snapshotCommitted();
    this.scratchSeeded = true;
    if (forming) {
      this.tipTime = forming.time;
      this.tipValues = this.evaluator.evaluate(forming, snapshotTipBarState());
    }
  }

  /**
   * TIP_UPDATE: restore the scratch base first so ticks never accumulate,
   * then evaluate the forming bar once. `isnew` only on the first tip of a
   * time slot. Committed state is never touched.
   */
  onTipUpdate(bar: CalcBar): CalcPlotValues | null {
    if (this.scratchSeeded) this.evaluator.restoreCommitted(this.scratchBase);
    const first = bar.time !== this.tipTime;
    this.tipTime = bar.time;
    this.tipValues = this.evaluator.evaluate(bar, tipBarState(first));
    return this.tipValues;
  }

  /**
   * APPEND_BAR: evaluate + commit the closing bar (this is the eval that
   * folds accumulators), push its plots into the committed series, then
   * snapshot committed as the next slot's scratch base. Bar T+1 is not
   * evaluated — its OHLCV does not exist yet, so the next tip is `isnew`.
   */
  onAppendBar(bar: CalcBar): void {
    const ctx = appendCloseBarState();
    const values = this.evaluator.evaluate(bar, ctx);
    this.evaluator.commit(bar, ctx);
    this.pushCommitted(values);
    this.scratchBase = this.evaluator.snapshotCommitted();
    this.scratchSeeded = true;
    this.tipTime = null;
    this.tipValues = null;
  }

  /**
   * Append one committed bar's plot values at the current count. Every
   * known plot gets a cell (a plot that appears mid-run is padded with
   * `null`s up to its first appearance) so no series ever lags behind
   * `committedBarCount`.
   */
  private pushCommitted(values: CalcPlotValues): void {
    const index = this.committedCount;
    const names = new Set([...Object.keys(this.series), ...Object.keys(values)]);
    for (const name of names) {
      let cells: (number | null)[] | undefined = this.series[name];
      if (cells === undefined) {
        cells = [];
        this.series[name] = cells;
      }
      while (cells.length < index) cells.push(null);
      cells.push(name in values ? values[name] : null);
    }
    this.committedCount = index + 1;
  }
}
