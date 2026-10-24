// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// You should have received a copy of the GNU Affero General Public License
// as published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Messages for the calc worker (hp2 C1).
 *
 * The worker owns one `CalcSession` per series plus the cold history the
 * session replays from. Plot values ride the messages (Pro-API path: the
 * server evaluated Pine; the worker enforces the scratch/commit *series*
 * discipline, it does not re-evaluate). A future plot-columns transport
 * replaces the per-message value maps; the session contract stays.
 *
 * @module hp/workers/calc-protocol
 */

import type { ColdKey } from './protocol';
import type { CalcBar, CalcPlotValues, CommittedSeries } from './calc-core';

/** Plot values keyed by bar time (arrays clone across the worker boundary; Maps do not). */
export type TimedValues = {
  time: number;
  plots: CalcPlotValues;
};

export type HostToCalc =
  /** Own the series lifecycle from here on; hydrate cold when keyed. */
  | { type: 'init'; coldKey?: ColdKey; priceScale?: number }
  /**
   * Replay the series. Bars seed cold; when cold already holds history
   * (rebind, hydrate) the replay reads cold instead of `bars` (hp2 C1:
   * cold input, not main-thread bars). `values` are the server-evaluated
   * plots keyed by bar time.
   */
  | {
      type: 'snapshot';
      seriesId: string;
      bars: CalcBar[];
      values?: TimedValues[];
      forming?: CalcBar | null;
    }
  /** One forming tick: scratch only, never committed. */
  | { type: 'tip'; seriesId: string; bar: CalcBar; values?: CalcPlotValues | null }
  /** One closed bar: the eval that folds accumulators into committed state. */
  | { type: 'append'; seriesId: string; bar: CalcBar; values?: CalcPlotValues | null }
  /** Drop one series (or all when `seriesId` is absent), cold included. */
  | { type: 'reset'; seriesId?: string };

export type CalcToHost =
  | { type: 'ready' }
  /**
   * Committed state after a snapshot/append, or the scratch tip after a
   * tip. `series` is the full committed plot series (correctness-first;
   * a plot-columns transport replaces it when the paint path consumes
   * worker plots).
   */
  | {
      type: 'plots';
      seriesId: string;
      committed: number;
      tip: CalcPlotValues | null;
      series: CommittedSeries;
    }
  | { type: 'error'; seriesId: string; reason: string };
