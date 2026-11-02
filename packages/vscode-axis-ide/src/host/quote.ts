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
 * Pure quote helpers for the watchlist StatusBar (PR-08b / Task 20).
 *
 * Semantics mirrored from AXIS PWA `src/ui/extras/quote.ts` — do not import
 * Solid or the PWA module graph. Keep this file vscode-free for Bun unit tests.
 */

/**
 * A missing stream plane still follows the tick. Connecting, degraded,
 * error, and closed keep the card on the candle so it cannot run ahead
 * of the chart.
 */
export function streamAllowsLivePrice(state: string | null | undefined): boolean {
  return state == null || state === 'open';
}

/** Tick price while the stream is open; otherwise the last painted close. */
export function displayedLastPrice(opts: {
  tickPrice: number;
  barClose: number;
  streamState?: string | null;
}): number {
  if (streamAllowsLivePrice(opts.streamState) && Number.isFinite(opts.tickPrice)) {
    return opts.tickPrice;
  }
  return Number.isFinite(opts.barClose) ? opts.barClose : NaN;
}

/** Compact StatusBar price text (no locale surprises). */
export function formatQuotePrice(price: number): string {
  if (!Number.isFinite(price)) return '—';
  const abs = Math.abs(price);
  if (abs >= 1000) return price.toFixed(2);
  if (abs >= 1) return price.toFixed(2);
  if (abs >= 0.01) return price.toFixed(4);
  return price.toPrecision(4);
}

export type QuoteSnapshot = {
  tickPrice: number;
  barClose: number;
  streamState?: string | null;
};

/**
 * Resolve the number shown on the StatusBar for a symbol quote.
 * Prefer {@link displayedLastPrice}; callers supply mock/placeholder when
 * no live watchlist feed exists yet (soft-dep PR-09).
 */
export function resolveDisplayedQuotePrice(quote: QuoteSnapshot): number {
  return displayedLastPrice({
    tickPrice: quote.tickPrice,
    barClose: quote.barClose,
    streamState: quote.streamState,
  });
}
