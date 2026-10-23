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
 * Bar-state context (HP PR 6, §10.1) — what `barstate.*` reads at each phase
 * of the calc state machine, and the one rule that keeps accumulators honest:
 * `ta.cum`, `ta.valuewhen`, `var` / `varip` fold only when `isconfirmed` is
 * true. A forming tip is a **scratch** evaluation and never mutates committed
 * state (§10.2).
 *
 * PYNE parity: its multi-tick realtime window sets
 * `isconfirmed = tick_i == n_ticks - 1` — forming ticks are unconfirmed and
 * only the closing tick commits. That is the same split as `tipBarState` /
 * `appendCloseBarState` here, and the closed-run expectations are recorded
 * in `tests/hp/fixtures/barstate-parity.json`
 * (`scripts/record-hp-fixtures.py`).
 *
 * @module hp/calc/barstate
 */

/** The `barstate.*` flags of one evaluation. */
export interface BarStateContext {
  isnew: boolean;
  isconfirmed: boolean;
  isrealtime: boolean;
  isfirst: boolean;
  islast: boolean;
}

/**
 * History replay (SNAPSHOT): every replayed bar is closed, and `isfirst` is
 * true only for absolute index 0.
 *
 * `laterBarExists` is true whenever another bar follows — a later closed bar
 * or the forming tip. Only the rightmost bar of the series is `islast` (the
 * PYNE-recorded closed-run flags in the parity fixture show `islast` on the
 * final cell only).
 */
export function snapshotBarState(index: number, laterBarExists: boolean): BarStateContext {
  return {
    isnew: true,
    isconfirmed: true,
    isrealtime: false,
    isfirst: index === 0,
    islast: !laterBarExists,
  };
}

/**
 * The snapshot's forming tip: a continuation of the replayed series (never
 * `isnew` — the tip row's "first tip after APPEND_BAR" does not apply), never
 * confirmed, and the last bar of the viewport.
 */
export function snapshotTipBarState(): BarStateContext {
  return {
    isnew: false,
    isconfirmed: false,
    isrealtime: true,
    isfirst: false,
    islast: true,
  };
}

/**
 * Incremental tip (TIP_UPDATE / PLOT_TIP): never confirmed, so accumulators
 * stay scratch. `isnew` is true only on the first tip of a time slot — i.e.
 * the first tip after an `APPEND_BAR` opened bar T+1.
 */
export function tipBarState(firstTipOfSlot: boolean): BarStateContext {
  return {
    isnew: firstTipOfSlot,
    isconfirmed: false,
    isrealtime: true,
    isfirst: false,
    islast: true,
  };
}

/**
 * The bar `APPEND_BAR` closes: finalized values, confirmed (this is the eval
 * that folds accumulators), realtime, and not `isnew` — the bar already had
 * its `isnew` tick as a tip.
 */
export function appendCloseBarState(): BarStateContext {
  return {
    isnew: false,
    isconfirmed: true,
    isrealtime: true,
    isfirst: false,
    islast: true,
  };
}

/** Accumulators (`ta.cum`, `ta.valuewhen`, `var`/`varip`) commit only on confirmed bars. */
export function commitsAccumulators(ctx: BarStateContext): boolean {
  return ctx.isconfirmed;
}
