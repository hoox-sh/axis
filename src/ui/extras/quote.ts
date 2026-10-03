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
 * Quote sheet builder for the Quote dock panel: price + trend, 24h change /
 * range, last-bar OHLCV, tick time, venue. Day window is UTC-anchored. Pure —
 * no store access, safe for unit tests.
 *
 * @module ui/extras/quote
 */

import type { Bar } from '../../store/types';
import { trendOverTicks } from './trend';
import { formatExtraPrice } from './format';

export interface QuoteRow {
  label: string;
  value: string;
  tone?: 'up' | 'down' | 'flat';
}

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
}

/** Compact volume: 1.24M / 8.5K / 30. */
export function formatCompactVolume(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return `${Math.round(v * 100) / 100}`;
}

/** UTC clock HH:MM:SS for a wall-ms tick time. */
export function formatTickTime(at: number | null): string {
  if (at == null || !Number.isFinite(at)) return '—';
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
}

/** Build the quote sheet rows (always the same labels, in order). */
export function buildQuoteRows(input: QuoteInput): QuoteRow[] {
  const bars = Array.isArray(input.bars) ? input.bars : [];
  const last = bars.length ? bars[bars.length - 1] : null;
  const price = Number.isFinite(input.lastPrice)
    ? input.lastPrice
    : (last && Number.isFinite(last.close) ? (last as Bar).close : NaN);
  const trend = trendOverTicks(bars, 20);
  const tone = trend === 'up' ? 'up' : trend === 'down' ? 'down' : 'flat';

  const now = new Date();
  const dayStartSec = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);
  const dayBars = bars.filter((b) => b && Number.isFinite(b.time) && b.time >= dayStartSec);
  const dayOpen = dayBars.length ? dayBars[0]!.open : (last?.open ?? NaN);
  const high24 = dayBars.length
    ? Math.max(...dayBars.map((b) => b.high).filter(Number.isFinite))
    : (last?.high ?? NaN);
  const low24 = dayBars.length
    ? Math.min(...dayBars.map((b) => b.low).filter(Number.isFinite))
    : (last?.low ?? NaN);
  const vol24 = dayBars.length
    ? dayBars.reduce((a, b) => a + (Number.isFinite(b.volume) ? (b.volume as number) : 0), 0)
    : (last?.volume ?? NaN);

  const change =
    input.change24h !== undefined && Number.isFinite(input.change24h)
      ? input.change24h
      : Number.isFinite(price) && Number.isFinite(dayOpen) && dayOpen !== 0
        ? ((price - (dayOpen as number)) / (dayOpen as number)) * 100
        : NaN;
  const changeText = Number.isFinite(change)
    ? `${(change as number) >= 0 ? '+' : ''}${(change as number).toFixed(1)}%`
    : '—';

  const ohlc = last
    ? `${formatExtraPrice(last.open)} / ${formatExtraPrice(last.high)} / ${formatExtraPrice(last.low)} / ${formatExtraPrice(last.close)}`
    : '—';

  return [
    { label: 'Price', value: `${formatExtraPrice(price)} ${trend === 'up' ? '▲' : trend === 'down' ? '▼' : '●'}`, tone },
    { label: '24h Change', value: changeText, tone: Number.isFinite(change) ? ((change as number) >= 0 ? 'up' : 'down') : 'flat' },
    { label: '24h High', value: formatExtraPrice(high24) },
    { label: '24h Low', value: formatExtraPrice(low24) },
    { label: 'Day Open', value: formatExtraPrice(dayOpen) },
    { label: 'Last O/H/L/C', value: ohlc },
    { label: 'Volume 24h', value: formatCompactVolume(vol24) },
    { label: 'Tick time', value: formatTickTime(input.lastTickAt) },
    { label: 'Venue', value: input.venue || '—' },
  ];
}
