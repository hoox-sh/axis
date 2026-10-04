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
 * Pure extras formatters (no Solid imports — safe for unit tests).
 *
 * @module ui/extras/format
 */

/** Tabular price with 2 decimals; em dash when not finite. */
export function formatExtraPrice(p: number): string {
  if (!Number.isFinite(p)) return '—';
  return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** One marquee item: `SYM 97,412.50 +1.2%` (dashes when unknown). */
export function formatTickerRow(q: { symbol: string; price: number; change?: number }): string {
  const p = formatExtraPrice(q.price);
  const c =
    q.change === undefined || !Number.isFinite(q.change)
      ? '—'
      : `${q.change >= 0 ? '+' : ''}${q.change.toFixed(1)}%`;
  return `${q.symbol} ${p} ${c}`;
}
