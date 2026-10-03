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
 * Pure extras state helpers (no Solid / icon imports — safe for unit tests).
 *
 * @module ui/extras/state
 */

import type { ExtrasState } from '../../store/types';

/** True when at least one extra widget is enabled (button active state). */
export function anyExtraEnabled(e: ExtrasState): boolean {
  return !!(e.priceCard.enabled || e.ticker.enabled || e.alertOverlay.enabled);
}

/**
 * Default ticker selection: keep an existing non-empty pick, otherwise seed
 * from the watchlist (capped). Without this the ticker band — gated on a
 * non-empty symbol list — never appears after just flipping the toggle.
 */
export function defaultTickerSymbols(
  watchlistSymbols: readonly string[],
  current: readonly string[],
): string[] {
  if (current.length) return [...current];
  return watchlistSymbols.filter((s) => typeof s === 'string' && !!s.trim()).slice(0, 20);
}
