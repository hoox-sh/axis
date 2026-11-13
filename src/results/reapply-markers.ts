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
 * Repaint trade markers from the current `strategyUi` preferences.
 *
 * The three fill-display toggles (`slippageNextOpen`, `invertTradeLabels`,
 * `exactOnCandle`) are read when markers are built, not while they are
 * painted. Results → Strategy repainted its own copies on change; Settings →
 * General → Strategy & results wrote the store and left the existing markers
 * alone, so the two surfaces that claim to be "the same controls" behaved
 * differently until the next run.
 *
 * @module results/reapply-markers
 */

import { store } from '../store';
import { getManager } from '../chart/manager-access';
import type { PaneManager } from '../chart/pane-manager';
import { normalizeStrategyEvents, eventsToMarkers } from './events';
import type { RunResult } from '../indicators/runner';
import type { StrategyEvent } from './strategy';
import { windowAxisFromMeta } from './window-axis';

/**
 * Rebuild and set trade markers for the focused run.
 *
 * No-op when there is no run, no chart, or the run carried no events.
 */
export function reapplyTradeMarkersFromStore(
  manager: PaneManager | null | undefined = getManager(),
): void {
  const run = store.lastRun as RunResult | null;
  if (!run?.events?.length || !manager) return;
  const normalized = normalizeStrategyEvents(run.events as StrategyEvent[], {
    bars: store.bars || [],
    includeOrders: false,
    fillMode: store.strategyUi?.slippageNextOpen ? 'next_open' : 'close',
    axis: windowAxisFromMeta(run.meta),
  });
  const markers = eventsToMarkers(normalized, {
    invertLabels: !!store.strategyUi?.invertTradeLabels,
    exactOnCandle: store.strategyUi?.exactOnCandle !== false,
  });
  manager.setTradeMarkers(markers, store.resultsFocusId || undefined);
}
