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
 * Browser-tab title for the chart shell.
 *
 * Price leads so a narrow tab still shows the moving number. The signed
 * percent is the last close versus the previous bar.
 *
 * @module ui/document-title
 */

import { formatPriceWithDecimals } from '../chart/price-precision';

export type ChartTitleInput = {
  symbol?: string | null;
  price?: number | null;
  /** Previous bar close. Omitted change when missing or zero. */
  prevClose?: number | null;
  decimals?: number;
};

function signedPercent(price: number, prev: number): string | null {
  if (!Number.isFinite(prev) || prev === 0) return null;
  const pct = ((price - prev) / Math.abs(prev)) * 100;
  if (!Number.isFinite(pct)) return null;
  const body = `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
  return body === '+0.00%' || body === '-0.00%' ? '0.00%' : body;
}

/**
 * Tab title. Examples: `81645.10 +0.42% BTCUSDT`, `BTCUSDT · AXIS`, `AXIS`.
 */
export function formatChartTitle(input: ChartTitleInput = {}): string {
  const symbol = String(input.symbol || '')
    .trim()
    .toUpperCase();
  const price = input.price;
  const hasPrice = typeof price === 'number' && Number.isFinite(price);
  if (!hasPrice) {
    return symbol ? `${symbol} · AXIS` : 'AXIS';
  }
  const decimals = Number.isFinite(input.decimals) ? Number(input.decimals) : 2;
  const priceText = formatPriceWithDecimals(price, decimals);
  const change =
    input.prevClose == null ? null : signedPercent(price, Number(input.prevClose));
  const parts = [priceText];
  if (change) parts.push(change);
  if (symbol) parts.push(symbol);
  return parts.join(' ');
}
