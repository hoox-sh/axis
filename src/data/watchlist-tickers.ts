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
 * Watchlist REST 24h tickers — seed and fallback when live WS is unavailable.
 *
 * Complements `watchlist-live.ts` (WebSocket mux). The Watchlist panel uses this
 * module to:
 * 1. **Seed** prices immediately when the panel opens (before/while WS connects)
 * 2. **Poll** on an interval only after WS fails or closes (`mode: rest`)
 *
 * Prefer the active historical source’s exchange when possible. Failed
 * non-Binance venues return empty — never silently mix Binance quotes.
 *
 * ## Venue strategies (REST)
 *
 * | Source id match | Endpoint / notes |
 * |-----------------|------------------|
 * | okx | Spot tickers list; match `okxInst` (`BTC-USDT`); change from open24h/sodUtc0 |
 * | bybit | Spot tickers; `price24hPcnt` fraction → % |
 * | coinbase | Per-product ticker + stats (capped at 12 symbols) |
 * | mexc | Worker-proxied 24hr ticker (`symbol=` ≤8 symbols, else full book); REST-only |
 * | kraken | Public `Ticker` (`c[0]` last, `o` open; legacy `XXBTZUSD` keys normalized); REST-only |
 * | mock | Deterministic seed + noise |
 * | csv | Empty map (no live quotes) |
 * | gecko/ccxt/unknown | Empty map — never silently mix another venue's quotes |
 * | binance / default | `GET /api/v3/ticker/24hr?symbols=…` batch |
 *
 * Shared symbol helpers (`toUsdt`, `okxInst`, `coinbaseProduct`) are also used
 * by the WS layer so REST and live keys stay aligned.
 */

import { fetchBinanceJson } from './binance-http';
import { fetchMexcJson } from './mexc-http';
import { getDataManagerSelection } from './data-manager-source';
import { fetchBybitTickers } from './venues/bybit';
import { fetchCoinbaseTickers } from './venues/coinbase';
import { fetchKrakenTickers } from './venues/kraken';
import { fetchOkxTickers } from './venues/okx';
import { coinbaseProduct, okxInst, toUsdt } from './venues/spot';

/** One row’s quote state as stored by the Watchlist UI. */
export interface WatchTicker {
  price: number;
  /** 24h change in percent. */
  change: number;
  source?: string;
  /** 24h open for local % recompute when WS only sends last. */
  open24h?: number;
  updatedAt?: number;
}

// Re-exported for `watchlist-live` (WS layer) — single spelling shared with REST.
export { coinbaseProduct, okxInst, toUsdt };

/**
 * Resolve the effective source id for quotes. `data-manager` is a cache over
 * an underlying venue — resolve to that venue so REST and WS agree. Without
 * this the REST seed would fetch Binance while the WS mux follows the
 * underlying selection (venue mixing).
 */
function resolveQuoteSourceId(sourceId: string): string {
  const id = (sourceId || 'binance-rest').toLowerCase();
  if (id === 'data-manager') {
    try {
      const sel = getDataManagerSelection()?.sourceId;
      if (sel) return sel.toLowerCase();
    } catch {
      /* selection store unavailable (tests) — fall through */
    }
    return 'binance-rest';
  }
  return id;
}

/**
 * Whether a source has REST 24h tickers worth polling when WS is unavailable.
 *
 * Binance / OKX / Bybit / Coinbase have both WS and REST. MEXC and Kraken
 * have REST only (no ticker mux in `watchlist-live.ts` — MEXC WS is
 * kline-only; Kraken quotes deliberately never fall back onto Binance), so
 * the Watchlist must keep REST-polling instead of going `off` after the seed.
 * CSV / upload / Gecko / CCXT-gateway / unknown return `{}` and must not poll
 * (CCXT has no ticker endpoint on the gateway yet; Gecko pool symbols are not
 * CEX pairs).
 */
export function sourceSupportsRestPoll(sourceId: string): boolean {
  const id = resolveQuoteSourceId(sourceId);
  if (id.includes('csv') || id.includes('upload')) return false;
  if (id.includes('gecko')) return false;
  if (id.includes('ccxt')) return false;
  if (
    id.includes('binance') ||
    id.includes('okx') ||
    id.includes('bybit') ||
    id.includes('coinbase') ||
    id.includes('mexc') ||
    id.includes('kraken') ||
    !id
  ) {
    return true;
  }
  if (id.includes('mock')) return false; // mock uses its own WS-like walk
  return false;
}

/**
 * Fetch 24h last + change for symbols using the active source when possible.
 *
 * Keys in the result prefer the original watchlist symbol strings. Failed
 * venues return `{}` — never mix another venue's quotes.
 */
export async function fetchWatchlistTickers(
  symbols: string[],
  sourceId: string,
): Promise<Record<string, WatchTicker>> {
  if (!symbols.length) return {};
  const id = resolveQuoteSourceId(sourceId);

  try {
    if (id.includes('okx')) return await fetchOkx(symbols);
    if (id.includes('bybit')) return await fetchBybit(symbols);
    if (id.includes('coinbase')) return await fetchCoinbase(symbols);
    if (id.includes('mock')) return mockTickers(symbols);
    if (id.includes('csv') || id.includes('upload')) return {};
    if (id.includes('mexc')) return await fetchMexc(symbols);
    if (id.includes('kraken')) return await fetchKraken(symbols);
    if (id.includes('gecko')) return {};
    if (id.includes('binance') || !id) {
      return await fetchBinance(symbols);
    }
    return {};
  } catch {
    return {};
  }
}

/** Binance batch 24hr ticker; maps exchange `symbol` back to watchlist keys. */
async function fetchBinance(symbols: string[]): Promise<Record<string, WatchTicker>> {
  const syms = symbols.map(toUsdt);
  const data = (await fetchBinanceJson({
    path: 'ticker/24hr',
    query: `symbols=${JSON.stringify(syms)}`,
  })) as Array<{
    symbol: string;
    lastPrice: string;
    priceChangePercent: string;
    openPrice?: string;
  }>;
  if (!Array.isArray(data)) throw new Error('binance ticker: unexpected body');
  const next: Record<string, WatchTicker> = {};
  for (const t of data) {
    // Map back to original key if present
    const orig = symbols.find((s) => toUsdt(s) === t.symbol) || t.symbol;
    const price = parseFloat(t.lastPrice);
    const open = t.openPrice != null ? parseFloat(t.openPrice) : NaN;
    next[orig] = {
      price,
      change: parseFloat(t.priceChangePercent),
      open24h: Number.isFinite(open) ? open : undefined,
      source: 'binance',
    };
  }
  return next;
}

/** OKX spot tickers, mapped to the requested symbols. */
async function fetchOkx(symbols: string[]): Promise<Record<string, WatchTicker>> {
  const rows = await fetchOkxTickers(symbols);
  const next: Record<string, WatchTicker> = {};
  for (const [sym, t] of Object.entries(rows)) next[sym] = { ...t, source: 'okx' };
  return next;
}

/** Bybit spot tickers, mapped to the requested symbols. */
async function fetchBybit(symbols: string[]): Promise<Record<string, WatchTicker>> {
  const rows = await fetchBybitTickers(symbols);
  const next: Record<string, WatchTicker> = {};
  for (const [sym, t] of Object.entries(rows)) next[sym] = { ...t, source: 'bybit' };
  return next;
}

/** Coinbase tickers, mapped to the requested symbols. */
async function fetchCoinbase(symbols: string[]): Promise<Record<string, WatchTicker>> {
  const rows = await fetchCoinbaseTickers(symbols);
  const next: Record<string, WatchTicker> = {};
  for (const [sym, t] of Object.entries(rows)) next[sym] = { ...t, source: 'coinbase' };
  return next;
}

type MexcTickerRow = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  openPrice?: string;
};

function asMexcTickerRows(data: unknown): MexcTickerRow[] {
  if (Array.isArray(data)) return data as MexcTickerRow[];
  if (data && typeof data === 'object' && 'symbol' in data && 'lastPrice' in data) {
    return [data as MexcTickerRow];
  }
  throw new Error('mexc ticker: unexpected body');
}

function tickerFromMexc(t: MexcTickerRow): WatchTicker {
  const price = parseFloat(t.lastPrice);
  const open = t.openPrice != null ? parseFloat(t.openPrice) : NaN;
  return {
    price,
    change: parseFloat(t.priceChangePercent),
    open24h: Number.isFinite(open) ? open : undefined,
    source: 'mexc',
  };
}

/** Per-symbol `?symbol=` stays cheap; above this, one full-book request wins. */
const MEXC_SINGLE_TICKER_MAX = 8;

/** MEXC 24hr tickers (Binance-shaped). `symbol=` when the list is small; else the full book. */
async function fetchMexc(symbols: string[]): Promise<Record<string, WatchTicker>> {
  if (symbols.length <= MEXC_SINGLE_TICKER_MAX) {
    const next: Record<string, WatchTicker> = {};
    await Promise.all(
      symbols.map(async (orig) => {
        const key = toUsdt(orig);
        try {
          const data = await fetchMexcJson({
            path: 'ticker/24hr',
            query: `symbol=${key}`,
          });
          const t = asMexcTickerRows(data).find((row) => row.symbol === key);
          if (!t) return;
          next[orig] = tickerFromMexc(t);
        } catch {
          /* skip missing / invalid symbol */
        }
      }),
    );
    return next;
  }

  const data = asMexcTickerRows(await fetchMexcJson({ path: 'ticker/24hr' }));
  const bySym = new Map(data.map((t) => [t.symbol, t]));
  const next: Record<string, WatchTicker> = {};
  for (const orig of symbols) {
    const t = bySym.get(toUsdt(orig));
    if (!t) continue;
    next[orig] = tickerFromMexc(t);
  }
  return next;
}

/** Kraken tickers, mapped to the requested symbols. */
async function fetchKraken(symbols: string[]): Promise<Record<string, WatchTicker>> {
  const rows = await fetchKrakenTickers(symbols);
  const next: Record<string, WatchTicker> = {};
  for (const [sym, t] of Object.entries(rows)) next[sym] = { ...t, source: 'kraken' };
  return next;
}

/** Synthetic quotes for mock source (no network). */
function mockTickers(symbols: string[]): Record<string, WatchTicker> {
  const next: Record<string, WatchTicker> = {};
  for (const sym of symbols) {
    const seed = [...sym].reduce((a, c) => a + c.charCodeAt(0), 0);
    const price = 50 + (seed % 200) + Math.random() * 2;
    const change = (Math.random() - 0.5) * 6;
    next[sym] = { price, change, source: 'mock' };
  }
  return next;
}

/** Chart intervals offered in the topbar, settings, DSM, and watchlist jump. */
export const WATCHLIST_INTERVALS = [
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '8h',
  '12h',
  '1d',
  '3d',
  '1w',
  '1M',
] as const;

/** REST fallback poll intervals (seconds) exposed in settings UI. */
export const WATCHLIST_REFRESH_OPTIONS = [
  { value: 5, label: '5s' },
  { value: 15, label: '15s' },
  { value: 30, label: '30s' },
  { value: 60, label: '60s' },
] as const;
