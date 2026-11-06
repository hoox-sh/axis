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
 * Quote sheet builder for the Quote dock panel: price + trend, 24h change /
 * range, last-bar OHLCV, tick time, venue. Day window is UTC-anchored. Pure —
 * no store access, safe for unit tests.
 *
 * @module ui/extras/quote
 */

import type { Bar } from '../../store/types';
import { trendOverTicks } from './trend';
import { formatExtraPrice } from './format';

/** One label/value line of the quote sheet; `tone` colors up/down/flat values. */
export interface QuoteRow {
  label: string;
  value: string;
  tone?: 'up' | 'down' | 'flat';
}

/** Inputs for the quote sheet: symbol/venue identity, bars, live tick, and day anchor. */
export interface QuoteInput {
  symbol: string;
  venue: string;
  bars: readonly Bar[];
  /** Live tick price, else last close. */
  lastPrice: number;
  /** Live tick wall time (ms), else null. */
  lastTickAt: number | null;
  /** REST 24h change % when available (preferred over day-bar math). */
  change24h?: number;
  /** Day-window anchor (wall ms). Defaults to now — inject in tests. */
  nowMs?: number;
}

/** Compact volume: 1.24M / 8.5K / 30. */
export function formatCompactVolume(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return `${Math.round(v * 100) / 100}`;
}

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
  if (streamAllowsLivePrice(opts.streamState) && Number.isFinite(opts.tickPrice))
    return opts.tickPrice;
  return Number.isFinite(opts.barClose) ? opts.barClose : NaN;
}

/** UTC clock HH:MM:SS for a wall-ms tick time. */
export function formatTickTime(at: number | null): string {
  if (at == null || !Number.isFinite(at)) return '—';
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
}

/** Numeric snapshot behind the quote sheet (hero, range bar, and rows). */
export interface QuoteStats {
  price: number;
  trend: 'up' | 'down' | 'flat';
  change: number;
  high24: number;
  low24: number;
  dayOpen: number;
  volume24: number;
  last: Bar | null;
}

/** Compute the quote numbers once; rows and the panel hero share them. */
export function quoteStats(input: QuoteInput): QuoteStats {
  const bars = Array.isArray(input.bars) ? input.bars : [];
  const last = bars.length ? (bars[bars.length - 1] ?? null) : null;
  const price = Number.isFinite(input.lastPrice)
    ? input.lastPrice
    : last && Number.isFinite(last.close)
      ? last.close
      : NaN;
  const trend = trendOverTicks(bars, 20);

  const now = new Date(input.nowMs ?? Date.now());
  const dayStartSec = Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000,
  );
  const dayBars = bars.filter((b) => b && Number.isFinite(b.time) && b.time >= dayStartSec);
  const dayOpen = dayBars.length ? (dayBars[0]?.open ?? NaN) : (last?.open ?? NaN);
  let high24 = last?.high ?? NaN;
  let low24 = last?.low ?? NaN;
  if (dayBars.length) {
    // Loop instead of Math.max(...spread): histories reach 100k bars and
    // spreading that many args blows the call stack.
    high24 = -Infinity;
    low24 = Infinity;
    for (const b of dayBars) {
      if (Number.isFinite(b.high) && b.high > high24) high24 = b.high;
      if (Number.isFinite(b.low) && b.low < low24) low24 = b.low;
    }
    if (high24 === -Infinity) high24 = NaN;
    if (low24 === Infinity) low24 = NaN;
  }
  const volume24 = dayBars.length
    ? dayBars.reduce((a, b) => a + (Number.isFinite(b.volume) ? (b.volume as number) : 0), 0)
    : (last?.volume ?? NaN);

  const change =
    input.change24h !== undefined && Number.isFinite(input.change24h)
      ? input.change24h
      : Number.isFinite(price) && Number.isFinite(dayOpen) && dayOpen !== 0
        ? ((price - dayOpen) / dayOpen) * 100
        : NaN;

  return { price, trend, change, high24, low24, dayOpen, volume24, last };
}

/** Build the quote sheet rows (always the same labels, in order). */
export function buildQuoteRows(input: QuoteInput): QuoteRow[] {
  const stats = quoteStats(input);
  const changeText = Number.isFinite(stats.change)
    ? `${stats.change >= 0 ? '+' : ''}${stats.change.toFixed(1)}%`
    : '—';

  const ohlc = stats.last
    ? `${formatExtraPrice(stats.last.open)} / ${formatExtraPrice(stats.last.high)} / ${formatExtraPrice(stats.last.low)} / ${formatExtraPrice(stats.last.close)}`
    : '—';

  return [
    {
      label: 'Price',
      value: `${formatExtraPrice(stats.price)} ${
        stats.trend === 'up' ? '▲' : stats.trend === 'down' ? '▼' : '●'
      }`,
      tone: stats.trend,
    },
    {
      label: '24h Change',
      value: changeText,
      tone: Number.isFinite(stats.change) ? (stats.change >= 0 ? 'up' : 'down') : 'flat',
    },
    { label: '24h High', value: formatExtraPrice(stats.high24) },
    { label: '24h Low', value: formatExtraPrice(stats.low24) },
    { label: 'Day Open', value: formatExtraPrice(stats.dayOpen) },
    { label: 'Last O/H/L/C', value: ohlc },
    { label: 'Volume 24h', value: formatCompactVolume(stats.volume24) },
    { label: 'Tick time', value: formatTickTime(input.lastTickAt) },
    { label: 'Venue', value: input.venue || '—' },
  ];
}
