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
 * Pure watchlist row helpers (no Solid imports — safe for unit tests).
 *
 * @module ui/watchlist-row
 */

/**
 * Big-price size class from the formatted price length — longer prices
 * (more digits / decimals) step down so the expanded row never wraps.
 */
export function bigPriceSizeClass(formatted: string): string {
  const len = formatted.length;
  if (len <= 9) return 'axis-wl-big-1';
  if (len <= 13) return 'axis-wl-big-2';
  return 'axis-wl-big-3';
}

/**
 * Where `price` sits inside `[low, high]` as a 0–100 percentage.
 *
 * Used by the expanded row's day-range track. Returns `null` when the range is
 * unusable (missing/non-finite values, `high <= low`), so the UI hides the bar
 * instead of drawing a misleading position.
 */
export function rangePercent(
  price: number | null | undefined,
  low: number | null | undefined,
  high: number | null | undefined,
): number | null {
  if (price == null || low == null || high == null) return null;
  if (![price, low, high].every((n) => Number.isFinite(n))) return null;
  if (!(high > low)) return null;
  const pct = ((price - low) / (high - low)) * 100;
  return Math.max(0, Math.min(100, pct));
}

/**
 * Compact volume text (`1.24M`, `812.4k`, `3.10B`). `null` when unknown so the
 * caller can hide the row.
 */
export function formatCompactVolume(value: number | null | undefined, digits = 2): string | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  if (value >= 1e9) return `${(value / 1e9).toFixed(digits)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(digits)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return value.toFixed(value < 10 ? 2 : 0);
}
