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
 * Ticker normalization — a leaf module (no imports).
 *
 * Kept separate from {@link ./symbol-exchange} so the cache key builder can
 * use the same rule without pulling the store in (the store imports the data
 * plane, which imports the cache).
 *
 * @module data/symbol-normalize
 */

/**
 * Normalize a ticker for history fetch / dataset keys.
 *
 * CEX tickers are uppercased. DEX pool symbols (`network:0x…`, `network/…`,
 * Solana base58, or any `sourceId === 'geckoterminal-ohlcv'`) keep mixed case
 * because addresses are case-sensitive on some chains.
 *
 * The **dataset key** is built from this form: uppercasing a pool address
 * made two distinct pools share one dataset, so the store served the wrong
 * series.
 */
export function normalizeLoadSymbol(
  symbol: string,
  sourceId?: string | null,
): string {
  const rawSym = String(symbol || '').trim();
  const srcId = String(sourceId || '');
  if (
    srcId === 'geckoterminal-ohlcv' ||
    rawSym.includes(':') ||
    rawSym.includes('/')
  ) {
    return rawSym;
  }
  return rawSym.toUpperCase();
}
