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
 * Market identity helpers for Redesign2.
 *
 * Canonical series key (final/plan.mdx §3.5): `exchange|market|SYMBOL|interval`
 * with a lowercased exchange, lowercased market, UPPERCASE pair-form symbol,
 * and a verbatim interval. This matches the PYNE store key exactly
 * (`binance|spot|BTC/USDT|1m`) — a fully lowercased key would miss the store.
 *
 * Provides deterministic keying for resettable session state.
 *
 * @module engine/market-identity
 */

/**
 * The four coordinates that identify a market on the engine side; every session and series
 * memo is keyed from these.
 */
export interface MarketIdentity {
  exchange: string;
  market: string;
  symbol: string;
  interval: string;
}

/**
 * Canonical `exchange|market|SYMBOL|interval` key for a market identity — lowercase exchange
 * and market, uppercase symbol, verbatim interval, matching the PYNE store key.
 *
 * @param id Market identity to serialize; fields are trimmed before normalization.
 * @returns The canonical key string.
 */
export function marketIdentityKey(id: MarketIdentity): string {
  const exchange = id.exchange.trim().toLowerCase();
  const market = id.market.trim().toLowerCase();
  const symbol = id.symbol.trim().toUpperCase();
  const interval = id.interval.trim();
  return `${exchange}|${market}|${symbol}|${interval}`;
}

/**
 * Minimal symbol-catalog row used to translate a load-form ticker into its display pair form;
 * only `symbol` (match key) and `display` (pair form) are consulted.
 */
export interface CatalogSymbol {
  symbol: string;
  display: string;
}

/**
 * Map an AXIS load-form symbol (`BTCUSDT`) to pair form (`BTC/USDT`) via an
 * optional catalog list. Already-paired symbols and unknown symbols pass
 * through uppercased — writer and reader agree as long as both use this
 * helper with the same catalog.
 */
export function pairFormSymbol(symbol: string, catalog?: CatalogSymbol[]): string {
  const up = symbol.trim().toUpperCase();
  if (up.includes('/')) return up;
  const hit = catalog?.find((e) => e.symbol.toUpperCase() === up);
  if (hit?.display) return hit.display.trim().toUpperCase();
  return up;
}

/**
 * Build the canonical series key for the current chart from store-shaped
 * fields. `market` defaults to `spot` (the engine-side default); pass an
 * explicit market for futures/swap charts.
 */
export function currentSeriesKey(opts: {
  exchange: string;
  symbol: string;
  interval: string;
  market?: string;
  catalog?: CatalogSymbol[];
}): string {
  return marketIdentityKey({
    exchange: opts.exchange,
    market: opts.market ?? 'spot',
    symbol: pairFormSymbol(opts.symbol, opts.catalog),
    interval: opts.interval,
  });
}

/**
 * Compares two identities by canonical key, so differing casing or pair form still matches.
 *
 * @param a First identity.
 * @param b Second identity.
 * @returns `true` when both normalize to the same `marketIdentityKey`.
 */
export function sameMarketIdentity(a: MarketIdentity, b: MarketIdentity): boolean {
  return marketIdentityKey(a) === marketIdentityKey(b);
}
