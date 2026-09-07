// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Position-view model for the Results Events tab "Open ⇄ Close" view.
 *
 * Thin re-export over the shared pairing walker in `results/strategy` — one
 * source of truth for trade pairing, pyramiding averages, and per-fill P&L.
 *
 * @module results/positions
 */

import type { Bar } from '../store/types';
import {
  walkStrategyEvents,
  type PositionView,
  type StreamEventView,
  type StrategyEvent,
} from './strategy';

export type { PositionView, StreamEventView, PositionFill, PositionCloseFill } from './strategy';

export interface BuildPositionViewsOptions {
  /** Fill model: `close` (default) or `next_open` (slippage → next bar open). */
  fillMode?: 'close' | 'next_open';
}

/**
 * Build the Open ⇄ Close position grid + enriched stream from raw events.
 * Positions group entry fills (pyramiding averages into the position) against
 * exit fills with per-fill P&L; re-opens after a full close form new cycles.
 */
export function buildPositionViews(
  events: StrategyEvent[] | Record<string, unknown>[] | null | undefined,
  bars?: Bar[],
  opts: BuildPositionViewsOptions = {},
): { positions: PositionView[]; stream: StreamEventView[] } {
  const walk = walkStrategyEvents(events ?? [], bars, opts);
  return { positions: walk.positions, stream: walk.stream };
}
