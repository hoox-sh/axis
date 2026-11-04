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
 * Previous **daily close** per watchlist symbol (UTC day boundary).
 *
 * ## Why not the 24h open
 *
 * Exchange `ticker/24hr` returns the open of a *rolling* 24-hour window, so
 * `open24h` moves on every tick and a “Prev” column built from it changes
 * continuously — it is not a reference price. The previous **daily close**
 * (the close of the last completed UTC daily candle) is fixed for the whole
 * day, which is what a watchlist reference column should show.
 *
 * Only venues whose public daily klines are fetched directly are supported
 * here (Binance today); other venues return `{}` and the UI falls back to the
 * 24h open with an explicit tooltip. Never fabricate a daily close.
 *
 * @module data/watchlist-daily
 */

import { fetchBinanceJson } from './binance-http';
import { resolveQuoteSourceId } from './watchlist-tickers';
import { toUsdt } from './venues/spot';

/** Binance kline tuple: `[openTime, open, high, low, close, volume, closeTime, …]`. */
export type KlineTuple = readonly [number, string, string, string, string, ...unknown[]];

/** UTC day key (`YYYY-MM-DD`) — the daily-close cache epoch. */
export function dailyCloseDayKey(nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/**
 * Close of the last **completed** daily candle in a kline list.
 *
 * Binance includes the in-progress candle as the last row, so its close is the
 * live price (not a reference). Pick the newest row whose close time has
 * already passed; a list of only in-progress candles yields `null`.
 */
export function previousDailyCloseFromKlines(
  rows: readonly KlineTuple[] | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (!Array.isArray(rows) || !rows.length) return null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (!row) continue;
    const closeTime = Number(row[6]);
    const close = Number(row[4]);
    if (!Number.isFinite(close) || close <= 0) continue;
    // A row without a close time cannot prove it is completed — skip it.
    if (!Number.isFinite(closeTime)) continue;
    if (closeTime < nowMs) return close;
  }
  return null;
}

/**
 * Per-source cache. A daily close is valid for the whole UTC day; a symbol
 * the venue has no daily kline for is cached as `missing` for the day too, so
 * the watchlist poll does not re-request it every minute.
 */
const cache = new Map<string, { day: string; close?: number; missing?: boolean }>();

/** @internal test helper. */
export function _resetDailyCloseCacheForTests(): void {
  cache.clear();
}

function cacheKey(sourceId: string, symbol: string): string {
  return `${sourceId}|${symbol.toUpperCase()}`;
}

/** True when the quote source can supply a real daily close. */
export function sourceSupportsDailyClose(sourceId: string): boolean {
  // `data-manager` resolves to its underlying venue (see watchlist-tickers).
  const id = resolveQuoteSourceId(sourceId);
  return !id || id.includes('binance');
}

/**
 * Epoch for the daily-close state: the resolved quote venue.
 *
 * The watchlist clears its `dailyCloses` map when this changes, so a
 * Binance → OKX switch cannot keep showing the previous venue's closes.
 */
export function dailyCloseSourceKey(sourceId: string): string {
  return resolveQuoteSourceId(sourceId);
}

/**
 * Previous daily close per symbol.
 *
 * Binance only (`/klines?interval=1d`); every other venue returns `{}` so the
 * caller can fall back to the 24h open. Cached per UTC day, one request per
 * symbol (watchlists are small), failures never poison the cache.
 */
export async function fetchDailyCloses(
  symbols: readonly string[],
  sourceId: string,
  nowMs: number = Date.now(),
  deps?: { fetchKlines?: typeof fetchBinanceJson },
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!symbols.length || !sourceSupportsDailyClose(sourceId)) return out;
  const day = dailyCloseDayKey(nowMs);
  if (!day) return out;
  const fetchKlines = deps?.fetchKlines ?? fetchBinanceJson;

  await Promise.all(
    symbols.map(async (sym) => {
      const key = cacheKey(sourceId, sym);
      const hit = cache.get(key);
      if (hit && hit.day === day) {
        if (hit.close != null) out[sym] = hit.close;
        return;
      }
      try {
        const rows = (await fetchKlines({
          path: 'klines',
          query: `symbol=${toUsdt(sym)}&interval=1d&limit=3`,
        })) as KlineTuple[];
        const close = previousDailyCloseFromKlines(rows, nowMs);
        if (close == null) {
          // No completed candle (invalid symbol / venue gap): cache the miss
          // for the day instead of retrying on every poll.
          cache.set(key, { day, missing: true });
          return;
        }
        cache.set(key, { day, close });
        out[sym] = close;
      } catch {
        /* venue hiccup — fall back to the 24h open, do not cache */
      }
    }),
  );
  return out;
}
