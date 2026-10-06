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
 * Pure extras state helpers (no Solid / icon imports — safe for unit tests).
 *
 * Reads `DEFAULTS` from the store so ticker option defaults have a single
 * source of truth; suites importing this must install `./setup` first.
 *
 * @module ui/extras/state
 */

import { DEFAULTS } from '../../store';
import type { ExtrasState, TickerState } from '../../store/types';

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

/**
 * Reset-shape of the ticker state: every field except `enabled`/`symbols`,
 * which the caller owns. Derived from {@link DEFAULTS} so a clamp or default
 * change in `hydrateExtras` does not need a matching edit here.
 */
const TICKER_OPTION_DEFAULTS = {
  speed: DEFAULTS.extras.ticker.speed,
  direction: DEFAULTS.extras.ticker.direction,
  showChange: DEFAULTS.extras.ticker.showChange,
  itemSpacing: DEFAULTS.extras.ticker.itemSpacing,
  bandHeight: DEFAULTS.extras.ticker.bandHeight,
  fontSize: DEFAULTS.extras.ticker.fontSize,
  opacity: DEFAULTS.extras.ticker.opacity,
  draggable: DEFAULTS.extras.ticker.draggable,
  offsetY: DEFAULTS.extras.ticker.offsetY,
} as const;

/** Ticker options at their defaults, with `enabled`/`symbols` unset. */
export type TickerOptionDefaults = typeof TICKER_OPTION_DEFAULTS;

/** Default ticker visual options (used by the reset button). */
export const TICKER_DEFAULTS: TickerOptionDefaults = TICKER_OPTION_DEFAULTS;

/**
 * Reset ticker options to defaults. `enabled` and the symbol selection are
 * passed through rather than forced — "reset options" must not silently
 * re-enable a ticker the user turned off.
 */
export function resetTickerOptions(
  symbols: readonly string[],
  enabled: boolean,
): TickerState {
  return { ...TICKER_OPTION_DEFAULTS, enabled, symbols: [...symbols] };
}
