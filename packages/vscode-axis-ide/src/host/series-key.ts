// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Canonical series key helpers for the IDE host (PR-06b).
 * Aligned with `src/engine/market-identity.ts` — copied minimally; do not import
 * the Solid/PWA store.
 *
 * Key form: `exchange|market|SYMBOL|interval`
 * (lower exchange/market, UPPER pair-form symbol, verbatim interval).
 */

/** Catalog row used only for load-form → pair-form mapping. */
export interface CatalogSymbol {
  symbol: string;
  display: string;
}

/**
 * Compact majors for pair-form when the chart doc stores `BTCUSDT`.
 * Mirrors AXIS `FALLBACK_MAJORS` (`symbol` + `display` only).
 */
export const FALLBACK_PAIR_CATALOG: readonly CatalogSymbol[] = [
  { symbol: 'BTCUSDT', display: 'BTC/USDT' },
  { symbol: 'ETHUSDT', display: 'ETH/USDT' },
  { symbol: 'SOLUSDT', display: 'SOL/USDT' },
  { symbol: 'BNBUSDT', display: 'BNB/USDT' },
  { symbol: 'XRPUSDT', display: 'XRP/USDT' },
  { symbol: 'ADAUSDT', display: 'ADA/USDT' },
  { symbol: 'DOGEUSDT', display: 'DOGE/USDT' },
  { symbol: 'AVAXUSDT', display: 'AVAX/USDT' },
  { symbol: 'DOTUSDT', display: 'DOT/USDT' },
  { symbol: 'LINKUSDT', display: 'LINK/USDT' },
];

export interface SeriesKeyFields {
  exchange: string;
  market?: string;
  symbol: string;
  interval: string;
}

/**
 * Map an AXIS load-form symbol (`BTCUSDT`) to pair form (`BTC/USDT`) via an
 * optional catalog. Already-paired symbols and unknowns pass through uppercased.
 */
export function pairFormSymbol(symbol: string, catalog?: readonly CatalogSymbol[]): string {
  try {
    const up = String(symbol ?? '')
      .trim()
      .toUpperCase();
    if (!up) return '';
    if (up.includes('/')) return up;
    const list = catalog ?? FALLBACK_PAIR_CATALOG;
    const hit = list.find((e) => e.symbol.toUpperCase() === up);
    if (hit?.display) return hit.display.trim().toUpperCase();
    return up;
  } catch {
    try {
      return String(symbol ?? '')
        .trim()
        .toUpperCase();
    } catch {
      return '';
    }
  }
}

/**
 * Canonical series key: `exchange|market|SYMBOL|interval`.
 * `market` defaults to `spot`. Symbol is pair-formed via {@link pairFormSymbol}.
 */
export function buildSeriesKey(
  fields: SeriesKeyFields,
  catalog?: readonly CatalogSymbol[],
): string {
  try {
    const exchange = String(fields.exchange ?? '')
      .trim()
      .toLowerCase();
    const market =
      String(fields.market ?? '')
        .trim()
        .toLowerCase() || 'spot';
    const symbol = pairFormSymbol(fields.symbol ?? '', catalog);
    const interval = String(fields.interval ?? '').trim() || '1m';
    return `${exchange}|${market}|${symbol}|${interval}`;
  } catch {
    return '|| |1m';
  }
}

/** Alias matching PWA `currentSeriesKey` naming. */
export function currentSeriesKey(
  opts: {
    exchange: string;
    symbol: string;
    interval: string;
    market?: string;
    catalog?: readonly CatalogSymbol[];
  },
): string {
  return buildSeriesKey(
    {
      exchange: opts.exchange,
      market: opts.market,
      symbol: opts.symbol,
      interval: opts.interval,
    },
    opts.catalog,
  );
}

/** Parse `exchange|market|SYMBOL|interval` (best-effort; never throws). */
export function parseSeriesKey(seriesKey: string): SeriesKeyFields {
  try {
    const parts = String(seriesKey ?? '').split('|');
    return {
      exchange: parts[0] ?? '',
      market: parts[1] || 'spot',
      symbol: parts[2] ?? '',
      interval: parts[3] || '1m',
    };
  } catch {
    return { exchange: '', market: 'spot', symbol: '', interval: '1m' };
  }
}
