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
 * Thin engine market identity helpers.
 *
 * Canonical series key: `exchange|market|SYMBOL|interval` with a lowercased
 * exchange, lowercased market, UPPERCASE pair-form symbol, and a verbatim
 * interval. Matches the PYNE store key exactly.
 *
 * @module engine/market-identity
 */

export interface MarketIdentity {
  exchange: string;
  market: string;
  symbol: string;
  interval: string;
}

export function marketIdentityKey(id: MarketIdentity): string {
  const exchange = id.exchange.trim().toLowerCase();
  const market = id.market.trim().toLowerCase();
  const symbol = id.symbol.trim().toUpperCase();
  const interval = id.interval.trim();
  return `${exchange}|${market}|${symbol}|${interval}`;
}

export interface CatalogSymbol {
  symbol: string;
  display: string;
}

/**
 * Map an AXIS load-form symbol (`BTCUSDT`) to pair form (`BTC/USDT`) via an
 * optional catalog list.
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
 * fields. `market` defaults to `spot`.
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

export function sameMarketIdentity(a: MarketIdentity, b: MarketIdentity): boolean {
  return marketIdentityKey(a) === marketIdentityKey(b);
}
