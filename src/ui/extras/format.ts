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

/**
 * One marquee item: `SYM 97,412.50 +1.2%` (dashes when unknown).
 * With `{ showChange: false }` the change % is omitted: `SYM 97,412.50`.
 */
export function formatTickerRow(
  q: { symbol: string; price: number; change?: number },
  opts?: { showChange?: boolean },
): string {
  const p = formatExtraPrice(q.price);
  if (opts?.showChange === false) return `${q.symbol} ${p}`;
  const c =
    q.change === undefined || !Number.isFinite(q.change)
      ? '—'
      : `${q.change >= 0 ? '+' : ''}${q.change.toFixed(1)}%`;
  return `${q.symbol} ${p} ${c}`;
}

/** Raw quote fields the ticker needs — extra keys are ignored. */
export interface TickerQuote {
  price?: number;
  change?: number;
}

/**
 * One marquee row, pre-split for styling. Kept separate from the joined
 * {@link formatTickerRow} string so the band can dim the symbol, render the
 * price tabular, and color the change on its own.
 */
export interface TickerRow {
  symbol: string;
  /** Pre-formatted price (`—` while unknown). */
  price: string;
  /** Signed 24h pct, or `null` when hidden / unknown. */
  change: string | null;
  /** Direction for the up/down treatment — unknown reads as up (neutral). */
  up: boolean;
  /** False while the REST seed or first WS tick has not landed. */
  hasPrice: boolean;
  hasChange: boolean;
}

/**
 * Build display rows for the ticker band, in the caller's symbol order.
 * Pure (no Solid) so it stays unit-testable; missing or non-finite values
 * degrade to `—` instead of throwing.
 */
export function buildTickerRows(
  symbols: readonly string[],
  quotes: Readonly<Record<string, TickerQuote | undefined>>,
  opts?: { showChange?: boolean },
): TickerRow[] {
  const showChange = opts?.showChange !== false;
  return symbols.map((symbol) => {
    const q = quotes[symbol];
    const price = typeof q?.price === 'number' && Number.isFinite(q.price) ? q.price : NaN;
    const change = typeof q?.change === 'number' && Number.isFinite(q.change) ? q.change : null;
    return {
      symbol,
      price: formatExtraPrice(price),
      change: showChange && change !== null ? `${change >= 0 ? '+' : ''}${change.toFixed(1)}%` : null,
      up: change === null || change >= 0,
      hasPrice: Number.isFinite(price),
      hasChange: change !== null,
    };
  });
}
