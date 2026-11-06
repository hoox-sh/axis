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
 * Last price and signed percent for the phone header.
 *
 * Same numbers as the document title: painted close versus the previous bar.
 * No watchlist fetch.
 *
 * @module ui/mobile/header-quote
 */

import { formatPriceWithDecimals } from '../../chart/price-precision';

/** Last price plus signed percent for the phone header; `null` when no price is painted. */
export type HeaderQuote = {
  price: string;
  change: string | null;
  tone: 'up' | 'down' | 'flat';
};

/** Format the painted close and its percent versus the previous close. */
export function headerQuote(input: {
  price?: number | null;
  prevClose?: number | null;
  decimals?: number;
}): HeaderQuote | null {
  const price = input.price;
  if (typeof price !== 'number' || !Number.isFinite(price)) return null;

  const decimals = Number.isFinite(input.decimals) ? Number(input.decimals) : 2;
  const priceText = formatPriceWithDecimals(price, decimals);
  const prev = input.prevClose;
  if (typeof prev !== 'number' || !Number.isFinite(prev) || prev === 0) {
    return { price: priceText, change: null, tone: 'flat' };
  }

  const pct = ((price - prev) / Math.abs(prev)) * 100;
  if (!Number.isFinite(pct)) return { price: priceText, change: null, tone: 'flat' };

  const raw = `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
  if (raw === '+0.00%' || raw === '-0.00%') {
    return { price: priceText, change: '0.00%', tone: 'flat' };
  }

  let tone: HeaderQuote['tone'] = 'flat';
  if (pct > 0) tone = 'up';
  else if (pct < 0) tone = 'down';
  return { price: priceText, change: raw, tone };
}
