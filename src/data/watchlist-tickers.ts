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
 * | mock | Deterministic seed + noise |
 * | csv | Empty map (no live quotes) |
 * | binance / default | `GET /api/v3/ticker/24hr?symbols=…` batch |
 *
 * Shared symbol helpers (`toUsdt`, `okxInst`, `coinbaseProduct`) are also used
 * by the WS layer so REST and live keys stay aligned.
 */

import { fetchBinanceJson } from './binance-http';
import { fetchMexcJson } from './mexc-http';

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

/**
 * Normalize to a USDT/USD/USDC pair symbol (e.g. `BTC` → `BTCUSDT`).
 * Strips non-alphanumerics; leaves pairs that already end in quote assets alone.
 */
export function toUsdt(sym: string): string {
  const s = sym.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.endsWith('USDT') || s.endsWith('USD') || s.endsWith('USDC')) return s;
  return `${s}USDT`;
}

/** OKX spot `instId` from a watchlist symbol (`BTCUSDT` → `BTC-USDT`). */
export function okxInst(sym: string): string {
  const s = toUsdt(sym);
  if (s.endsWith('USDT')) return `${s.slice(0, -4)}-USDT`;
  if (s.endsWith('USD')) return `${s.slice(0, -3)}-USD`;
  return `${s}-USDT`;
}

/** Coinbase product id (`BTCUSDT` / `BTC` → `BTC-USD`). */
export function coinbaseProduct(sym: string): string {
  const s = toUsdt(sym);
  const base = s.replace(/USDT$/, '').replace(/USDC$/, '').replace(/USD$/, '');
  return `${base}-USD`;
}

/**
 * Fetch 24h last + change for symbols using the active source when possible.
 *
 * Keys in the result prefer the original watchlist symbol strings. On failure
 * for a non-Binance source, retries once via Binance (common USDT pairs).
 */
export async function fetchWatchlistTickers(
  symbols: string[],
  sourceId: string,
): Promise<Record<string, WatchTicker>> {
  if (!symbols.length) return {};
  const id = (sourceId || 'binance-rest').toLowerCase();

  try {
    if (id.includes('okx')) return await fetchOkx(symbols);
    if (id.includes('bybit')) return await fetchBybit(symbols);
    if (id.includes('coinbase')) return await fetchCoinbase(symbols);
    if (id.includes('mock')) return mockTickers(symbols);
    if (id.includes('csv') || id.includes('upload')) return {};
    if (id.includes('mexc')) return await fetchMexc(symbols);
    if (id.includes('kraken') || id.includes('gecko')) return {};
    if (id.includes('binance') || id === 'data-manager' || !id) {
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

/**
 * OKX: full SPOT ticker list, filter by instId.
 * Change = (last − open) / open × 100 using open24h or sodUtc0.
 */
async function fetchOkx(symbols: string[]): Promise<Record<string, WatchTicker>> {
  const res = await fetch('https://www.okx.com/api/v5/market/tickers?instType=SPOT');
  if (!res.ok) throw new Error(`okx ${res.status}`);
  const body = (await res.json()) as {
    data?: Array<{ instId: string; last: string; sodUtc0?: string; open24h?: string }>;
  };
  const byId = new Map((body.data || []).map((t) => [t.instId, t]));
  const next: Record<string, WatchTicker> = {};
  for (const sym of symbols) {
    const inst = okxInst(sym);
    const t = byId.get(inst);
    if (!t) continue;
    const last = parseFloat(t.last);
    const open = parseFloat(t.open24h || t.sodUtc0 || String(last));
    const change = open ? ((last - open) / open) * 100 : 0;
    next[sym] = {
      price: last,
      change,
      open24h: Number.isFinite(open) ? open : undefined,
      source: 'okx',
    };
  }
  return next;
}

/** Bybit spot tickers; `price24hPcnt` is a fraction (0.01 = 1%). */
async function fetchBybit(symbols: string[]): Promise<Record<string, WatchTicker>> {
  const res = await fetch('https://api.bybit.com/v5/market/tickers?category=spot');
  if (!res.ok) throw new Error(`bybit ${res.status}`);
  const body = (await res.json()) as {
    result?: { list?: Array<{ symbol: string; lastPrice: string; price24hPcnt: string }> };
  };
  const bySym = new Map((body.result?.list || []).map((t) => [t.symbol, t]));
  const next: Record<string, WatchTicker> = {};
  for (const sym of symbols) {
    const key = toUsdt(sym);
    const t = bySym.get(key);
    if (!t) continue;
    next[sym] = {
      price: parseFloat(t.lastPrice),
      change: parseFloat(t.price24hPcnt) * 100, // fraction → %
      source: 'bybit',
    };
  }
  return next;
}

/**
 * Coinbase: parallel product ticker + 24h stats.
 * Capped at 12 symbols to avoid request storms.
 */
async function fetchCoinbase(symbols: string[]): Promise<Record<string, WatchTicker>> {
  // Coinbase product ids like BTC-USD
  const next: Record<string, WatchTicker> = {};
  await Promise.all(
    symbols.slice(0, 12).map(async (sym) => {
      const base = toUsdt(sym).replace(/USDT$/, '').replace(/USD$/, '');
      const product = `${base}-USD`;
      try {
        const res = await fetch(`https://api.exchange.coinbase.com/products/${product}/ticker`);
        if (!res.ok) return;
        const t = (await res.json()) as { price?: string };
        const price = parseFloat(t.price || '0');
        if (!price) return;
        // 24h stats
        let change = 0;
        try {
          const s = await fetch(`https://api.exchange.coinbase.com/products/${product}/stats`);
          if (s.ok) {
            const st = (await s.json()) as { open?: string; last?: string };
            const open = parseFloat(st.open || '0');
            const last = parseFloat(st.last || String(price));
            if (open) change = ((last - open) / open) * 100;
          }
        } catch {
          /* ignore */
        }
        next[sym] = { price, change, source: 'coinbase' };
      } catch {
        /* ignore */
      }
    }),
  );
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
