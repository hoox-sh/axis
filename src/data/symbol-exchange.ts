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
 * Leaf helpers shared by `load-symbol` and the DSM modules: ticker
 * normalization and source-id → chart exchange label.
 *
 * Kept free of load / DSM imports so `data-source-manager` and
 * `dsm-orchestrator` can use one definition without an import cycle.
 *
 * @module data/symbol-exchange
 */

import { store } from '../store';

/**
 * Normalize a ticker for history fetch / dataset keys.
 *
 * CEX tickers are uppercased. DEX pool symbols (`network:0x…`, `network/…`,
 * Solana base58, or any `sourceId === 'geckoterminal-ohlcv'`) keep mixed case
 * because addresses are case-sensitive on some chains.
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

/** Map a source plugin id to the chart exchange label. */
export function exchangeForSource(sourceId: string): string {
  const venue = store.provider?.sourceId === sourceId
    ? store.provider.venue
    : undefined;
  if (venue && venue !== 'generic' && venue !== 'cache') return venue;
  switch (sourceId) {
    case 'binance-rest':
      return 'binance';
    case 'okx-rest':
      return 'okx';
    case 'bybit-rest':
      return 'bybit';
    case 'coinbase-rest':
      return 'coinbase';
    case 'kraken-rest':
      return 'kraken';
    case 'mexc-rest':
      return 'mexc';
    case 'mock-walk':
      return 'mock';
    case 'csv-upload':
      return 'upload';
    case 'data-manager':
      return store.provider?.venue && store.provider.venue !== 'cache'
        ? store.provider.venue
        : 'cache';
    default:
      return store.exchange;
  }
}
