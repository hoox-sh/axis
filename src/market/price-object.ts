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
 * The one price. Every surface that shows the chart instrument's price reads
 * this object — the tab title, the HUD Last chip, the quote / price panels, the
 * mobile header, the chart last-value label, alerts, and the MCP snapshot.
 *
 * ## Why
 *
 * The old path fanned the price out: each consumer re-derived it from
 * `telemetry.lastTick`, `barPlane.tip`, and the stream state with its own
 * precedence, so the tab could show one number while the candle showed
 * another. Here there is exactly one writer and one value.
 *
 * ## Contract
 *
 * - The **writer** is the chart commit path (`store` → `commitPrice`), so the
 *   value is the close of the candle that was just painted. A tick never runs
 *   ahead of the chart, and the chart never lags a tick: both read the same
 *   commit.
 * - The **readers** never recompute. They read {@link priceView} and format it.
 * - No store import: this module is a leaf so the store can write to it without
 *   a cycle.
 *
 * @module market/price-object
 */

import { createSignal } from 'solid-js';
import { formatPriceWithDecimals } from '../chart/price-precision';

/** Direction of the last price move, for up/down/flat styling. */
export type PriceDirection = 'up' | 'down' | 'flat';

/** Immutable snapshot of the chart instrument's price. */
export interface PriceView {
  /** Symbol the price belongs to. Empty before the first commit. */
  symbol: string;
  /** The price the chart is showing. `NaN` while unknown. */
  value: number;
  /** Close of the bar before the current one. `NaN` while unknown. */
  prevClose: number;
  /** Signed percent versus {@link prevClose}. `NaN` while unknown. */
  changePct: number;
  /** Direction versus the previous price. */
  direction: PriceDirection;
  /** Decimal places resolved once from the symbol and the loaded window. */
  decimals: number;
  /** Wall-clock ms of this commit. */
  at: number;
  /** Unix seconds of the bar this price belongs to. `0` while unknown. */
  barTime: number;
  /** True while the bar is still forming (the only mutable bar). */
  live: boolean;
}

/** Inputs for one price commit. */
export interface PriceCommit {
  symbol: string;
  /** Candle close (or the price about to be painted). */
  value: number;
  prevClose?: number;
  decimals?: number;
  barTime?: number;
  live?: boolean;
  /** Wall-clock ms. Defaults to now. */
  at?: number;
}

const EMPTY: PriceView = Object.freeze({
  symbol: '',
  value: Number.NaN,
  prevClose: Number.NaN,
  changePct: Number.NaN,
  direction: 'flat',
  decimals: 2,
  at: 0,
  barTime: 0,
  live: false,
});

/** Compare the fields a commit can change; skip the signal write when equal. */
function sameView(a: PriceView, b: PriceView): boolean {
  return (
    a.symbol === b.symbol &&
    Object.is(a.value, b.value) &&
    Object.is(a.prevClose, b.prevClose) &&
    Object.is(a.changePct, b.changePct) &&
    a.direction === b.direction &&
    a.decimals === b.decimals &&
    a.at === b.at &&
    a.barTime === b.barTime &&
    a.live === b.live
  );
}

const [view, setView] = createSignal<PriceView>(EMPTY, { equals: sameView });

/** Signed percent between two prices; `NaN` when it cannot be computed. */
export function priceChangePct(value: number, prevClose: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(prevClose) || prevClose === 0) return Number.NaN;
  const pct = ((value - prevClose) / Math.abs(prevClose)) * 100;
  return Number.isFinite(pct) ? pct : Number.NaN;
}

/** Direction of a price move; flat when either side is unknown. */
export function priceDirection(value: number, prevClose: number): PriceDirection {
  if (!Number.isFinite(value) || !Number.isFinite(prevClose)) return 'flat';
  if (value > prevClose) return 'up';
  if (value < prevClose) return 'down';
  return 'flat';
}

/**
 * Commit the price that was just painted. The **only** writer.
 *
 * Called from the store's live-frame flush and full-load path, in the same
 * batch as the tip bar, so the object and the candle can never disagree.
 */
export function commitPrice(input: PriceCommit): void {
  const value = Number(input.value);
  if (!Number.isFinite(value)) return;
  const prevClose =
    input.prevClose != null && Number.isFinite(input.prevClose)
      ? Number(input.prevClose)
      : Number.NaN;
  const decimals =
    input.decimals != null && Number.isFinite(input.decimals)
      ? Math.max(0, Math.min(8, Math.round(input.decimals)))
      : 2;
  const next: PriceView = {
    symbol: String(input.symbol || ''),
    value,
    prevClose,
    changePct: priceChangePct(value, prevClose),
    direction: priceDirection(value, prevClose),
    decimals,
    at: input.at != null && Number.isFinite(input.at) ? input.at : Date.now(),
    barTime: input.barTime != null && Number.isFinite(input.barTime) ? input.barTime : 0,
    live: input.live === true,
  };
  setView(next);
}

/** Drop the price (symbol switch, reload). Keeps the symbol for the title. */
export function resetPrice(symbol = ''): void {
  const current = view();
  if (!current.symbol && !symbol) return;
  setView({ ...EMPTY, symbol: String(symbol || '') });
}

/** Current price snapshot. Reactive. */
export function priceView(): PriceView {
  return view();
}

/** Formatted price using the object's own decimals (`—` while unknown). */
export function formatPrice(v: PriceView = view()): string {
  return formatPriceWithDecimals(v.value, v.decimals);
}

/**
 * Signed percent text (`+1.24%`). `null` when there is no previous close, so
 * callers can omit the change instead of printing `NaN%`.
 */
export function formatPriceChange(v: PriceView = view()): string | null {
  if (!Number.isFinite(v.changePct)) return null;
  const text = `${v.changePct > 0 ? '+' : ''}${v.changePct.toFixed(2)}%`;
  return text === '+0.00%' || text === '-0.00%' ? '0.00%' : text;
}

/** Tone for the price: the committed direction. */
export function priceTone(v: PriceView = view()): PriceDirection {
  return v.direction;
}

/**
 * Overlay the one price on a multi-symbol quote row.
 *
 * A watchlist / ticker row is fed by a quote mux that covers many symbols; only
 * the chart instrument has a candle to stay in sync with. When `symbol` is the
 * chart symbol, the row takes {@link priceView}'s value (and nothing else), so
 * the list can never show a last price the chart is not painting. Other symbols
 * pass through untouched — their 24h change/high/low/volume only exist in the
 * mux.
 *
 * `makeEmpty` builds the row when the mux has not delivered that symbol yet;
 * without it the chart symbol would stay blank until the first venue frame.
 */
export function withChartPrice<T>(
  symbol: string,
  quote: T | undefined,
  makeEmpty: (price: number) => T,
  v: PriceView = view(),
): T | undefined {
  if (!symbol || v.symbol !== symbol || !Number.isFinite(v.value)) return quote;
  if (quote) return Object.assign({}, quote, { price: v.value }) as T;
  return makeEmpty(v.value);
}

/** @internal test hook — reset the module-level signal between tests. */
export function _resetPriceForTests(): void {
  setView(EMPTY);
}
