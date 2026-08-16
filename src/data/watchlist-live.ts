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
 * Multi-symbol watchlist quote WebSocket multiplex.
 *
 * Subscribes to last-price (+ 24h change where available) for many symbols on one
 * or a few exchange WS connections. Independent of chart kline streams in
 * `src/streams/multiplex.ts` — different product (ticker vs OHLCV), different
 * lifecycle (panel open only), and separate reconnect handles.
 *
 * ## Venue strategies
 *
 * | Source id match | Transport |
 * |-----------------|-----------|
 * | binance (default), kraken | Binance combined stream: `wss://…/stream?streams=btcusdt@ticker/…` (chunked) |
 * | okx | Single public WS; `subscribe` tickers by `instId` (batches of 20) |
 * | bybit | Spot public WS; `subscribe` `tickers.SYMBOL` (batches of 10) |
 * | coinbase | Exchange feed; one `ticker` channel over product_ids |
 * | mock | Local random walk (~500ms), no network |
 * | csv | No live quotes — status `mode: 'none'` |
 *
 * ## 24h change model
 *
 * @see {@link binanceTickerWsUrls} for host/port rotation
 *
 * - **Binance**: exchange `%` in `P`; open in `o` → both forwarded.
 * - **OKX / Coinbase**: last + open24h (or sodUtc0); change = `(last−open)/open×100`.
 * - **Bybit**: `price24hPcnt` is a fraction → ×100 for %; `prevPrice24h` as open.
 * - UI may recompute change from retained `open24h` when a frame only has last
 *   (see `mergeQuote` in Watchlist).
 *
 * ## Lifecycle
 *
 * Caller (`Watchlist.tsx`) starts on panel open / symbol or source change and
 * must call `stop()` on cleanup. Each venue uses `openReconnectableWs` except
 * mock (interval). Empty symbols or csv return a no-op handle immediately.
 */

import { openReconnectableWs, type WsStatus } from '../streams/reconnect-ws';
import { binanceTickerWsUrls } from './binance-http';
import { coinbaseProduct, okxInst, toUsdt } from './watchlist-tickers';

/** Normalized quote pushed to the UI for one watchlist row. */
export type QuoteUpdate = {
  /** Original watchlist symbol key (not always exchange-native id). */
  symbol: string;
  price: number;
  /** 24h change in percent when known. */
  change?: number;
  /** 24h open — retained so later last-only updates can recompute %. */
  open24h?: number;
  source?: string;
};

/** Connection status plus transport mode for the watchlist badge. */
export type QuoteMuxStatus = WsStatus & { mode?: 'ws' | 'mock' | 'none' };

/** Disposable mux — always call `stop` when symbols/source change or panel closes. */
export type QuoteMuxHandle = {
  stop: () => void;
};

export type StartWatchlistQuotesOpts = {
  /** Active chart/history source id (e.g. `binance-rest`, `okx-…`). */
  sourceId: string;
  symbols: string[];
  onQuote: (u: QuoteUpdate) => void;
  onStatus?: (s: QuoteMuxStatus) => void;
  onError?: (e: Error) => void;
};

/** Max streams per Binance combined URL (keeps query length safe). */
const BINANCE_CHUNK = 40;

/**
 * Start live watchlist quotes for the given symbols/source.
 *
 * Routes by `sourceId` substring. Returns `{ stop }`; no-op when source has no
 * WS (`csv`) or `symbols` is empty. Kraken (and unknown ids) fall through to
 * Binance public tickers for quote coverage.
 */
export function startWatchlistQuotes(opts: StartWatchlistQuotesOpts): QuoteMuxHandle {
  const symbols = opts.symbols.filter(Boolean);
  if (!symbols.length) {
    opts.onStatus?.({ state: 'closed', mode: 'none', detail: 'no symbols' });
    return { stop: () => {} };
  }

  const id = (opts.sourceId || 'binance-rest').toLowerCase();

  if (id.includes('csv')) {
    opts.onStatus?.({ state: 'closed', mode: 'none', detail: 'csv has no live quotes' });
    return { stop: () => {} };
  }

  if (id.includes('mock')) {
    return startMockQuotes(symbols, opts);
  }

  if (id.includes('okx')) return startOkxQuotes(symbols, opts);
  if (id.includes('bybit')) return startBybitQuotes(symbols, opts);
  if (id.includes('coinbase')) return startCoinbaseQuotes(symbols, opts);
  // binance + default (+ kraken falls back to binance for quotes)
  return startBinanceQuotes(symbols, opts);
}

// ── Symbol maps ────────────────────────────────────────────────────

/** Map exchange stream/inst keys → original watchlist symbol strings. */
function mapOrigByKey(
  symbols: string[],
  keyFn: (s: string) => string,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of symbols) {
    m.set(keyFn(s), s);
  }
  return m;
}

// ── Binance combined @ticker ───────────────────────────────────────

/**
 * Binance: one combined stream URL per chunk of `{symbol}@ticker` streams.
 * Payload fields: `c` last, `P` 24h change %, `o` open.
 */
function startBinanceQuotes(
  symbols: string[],
  opts: StartWatchlistQuotesOpts,
): QuoteMuxHandle {
  const byStream = mapOrigByKey(symbols, (s) => `${toUsdt(s).toLowerCase()}@ticker`);
  const streams = [...byStream.keys()];
  if (!streams.length) return { stop: () => {} };

  const stops: Array<() => void> = [];
  for (let i = 0; i < streams.length; i += BINANCE_CHUNK) {
    const chunk = streams.slice(i, i + BINANCE_CHUNK);
    // chunk entries are already `{sym}@ticker`
    const syms = chunk.map((s) => s.replace(/@ticker$/i, ''));
    const urls = binanceTickerWsUrls(syms);
    const url = urls[0] || `wss://stream.binance.com:9443/stream?streams=${chunk.join('/')}`;
    stops.push(
      openReconnectableWs({
        url,
        urls,
        maxAttempts: 12,
        onStatus: (s) => opts.onStatus?.({ ...s, mode: 'ws' }),
        onError: (e) => opts.onError?.(e),
        onMessage: (ev) => {
          try {
            const msg = JSON.parse(String(ev.data)) as {
              stream?: string;
              data?: {
                s?: string;
                c?: string;
                P?: string;
                o?: string;
              };
            };
            const d = msg.data;
            if (!d?.s || d.c == null) return;
            const stream = (msg.stream || `${d.s.toLowerCase()}@ticker`).toLowerCase();
            const orig = byStream.get(stream) || symbols.find((s) => toUsdt(s) === d.s) || d.s;
            const price = parseFloat(d.c);
            if (!Number.isFinite(price)) return;
            const change = d.P != null ? parseFloat(d.P) : undefined;
            const open24h = d.o != null ? parseFloat(d.o) : undefined;
            opts.onQuote({
              symbol: orig,
              price,
              change: Number.isFinite(change!) ? change : undefined,
              open24h: Number.isFinite(open24h!) ? open24h : undefined,
              source: 'binance',
            });
          } catch {
            /* ignore */
          }
        },
      }),
    );
  }

  return {
    stop: () => {
      for (const s of stops) s();
    },
  };
}

// ── OKX tickers ────────────────────────────────────────────────────

/**
 * OKX public WS: subscribe channel `tickers` per `instId` (e.g. `BTC-USDT`).
 * Change derived from `open24h` / `sodUtc0` when present.
 */
function startOkxQuotes(
  symbols: string[],
  opts: StartWatchlistQuotesOpts,
): QuoteMuxHandle {
  const byInst = mapOrigByKey(symbols, okxInst);
  const instIds = [...byInst.keys()];
  const url = 'wss://ws.okx.com:8443/ws/v5/public';

  const stop = openReconnectableWs({
    url,
    maxAttempts: 12,
    onStatus: (s) => opts.onStatus?.({ ...s, mode: 'ws' }),
    onError: (e) => opts.onError?.(e),
    onOpen: (ws) => {
      // OKX allows multi-arg subscribe
      const args = instIds.map((instId) => ({ channel: 'tickers', instId }));
      // batch in chunks of 20
      for (let i = 0; i < args.length; i += 20) {
        ws.send(JSON.stringify({ op: 'subscribe', args: args.slice(i, i + 20) }));
      }
    },
    onMessage: (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          data?: Array<{
            instId?: string;
            last?: string;
            open24h?: string;
            sodUtc0?: string;
          }>;
        };
        for (const t of msg.data || []) {
          if (!t.instId || t.last == null) continue;
          const orig = byInst.get(t.instId);
          if (!orig) continue;
          const price = parseFloat(t.last);
          if (!Number.isFinite(price)) continue;
          const open = parseFloat(t.open24h || t.sodUtc0 || '');
          const open24h = Number.isFinite(open) ? open : undefined;
          const change =
            open24h && open24h !== 0 ? ((price - open24h) / open24h) * 100 : undefined;
          opts.onQuote({
            symbol: orig,
            price,
            change,
            open24h,
            source: 'okx',
          });
        }
      } catch {
        /* ignore */
      }
    },
  });

  return { stop };
}

// ── Bybit tickers ──────────────────────────────────────────────────

/**
 * Bybit spot public WS: topics `tickers.{USDT_PAIR}`.
 * `price24hPcnt` is fractional; multiply by 100 for display percent.
 */
function startBybitQuotes(
  symbols: string[],
  opts: StartWatchlistQuotesOpts,
): QuoteMuxHandle {
  const bySym = mapOrigByKey(symbols, toUsdt);
  const keys = [...bySym.keys()];
  const url = 'wss://stream.bybit.com/v5/public/spot';

  const stop = openReconnectableWs({
    url,
    maxAttempts: 12,
    onStatus: (s) => opts.onStatus?.({ ...s, mode: 'ws' }),
    onError: (e) => opts.onError?.(e),
    onOpen: (ws) => {
      const args = keys.map((s) => `tickers.${s}`);
      for (let i = 0; i < args.length; i += 10) {
        ws.send(JSON.stringify({ op: 'subscribe', args: args.slice(i, i + 10) }));
      }
    },
    onMessage: (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          topic?: string;
          data?: {
            symbol?: string;
            lastPrice?: string;
            price24hPcnt?: string;
            prevPrice24h?: string;
          };
        };
        const d = msg.data;
        if (!d?.symbol || d.lastPrice == null) return;
        const orig = bySym.get(d.symbol);
        if (!orig) return;
        const price = parseFloat(d.lastPrice);
        if (!Number.isFinite(price)) return;
        // Bybit price24hPcnt is a fraction (e.g. 0.0123 = 1.23%)
        let change: number | undefined;
        if (d.price24hPcnt != null) {
          const frac = parseFloat(d.price24hPcnt);
          if (Number.isFinite(frac)) change = frac * 100;
        }
        let open24h: number | undefined;
        if (d.prevPrice24h != null) {
          const o = parseFloat(d.prevPrice24h);
          if (Number.isFinite(o)) open24h = o;
        }
        opts.onQuote({
          symbol: orig,
          price,
          change,
          open24h,
          source: 'bybit',
        });
      } catch {
        /* ignore */
      }
    },
  });

  return { stop };
}

// ── Coinbase ticker ────────────────────────────────────────────────

/**
 * Coinbase Exchange WS: subscribe channel `ticker` for `BASE-USD` product ids.
 * Change from `open_24h` when present.
 */
function startCoinbaseQuotes(
  symbols: string[],
  opts: StartWatchlistQuotesOpts,
): QuoteMuxHandle {
  const byProduct = mapOrigByKey(symbols, coinbaseProduct);
  const products = [...byProduct.keys()];
  const url = 'wss://ws-feed.exchange.coinbase.com';

  const stop = openReconnectableWs({
    url,
    maxAttempts: 12,
    onStatus: (s) => opts.onStatus?.({ ...s, mode: 'ws' }),
    onError: (e) => opts.onError?.(e),
    onOpen: (ws) => {
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          product_ids: products,
          channels: ['ticker'],
        }),
      );
    },
    onMessage: (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          type?: string;
          product_id?: string;
          price?: string;
          open_24h?: string;
        };
        if (msg.type !== 'ticker' || !msg.product_id || msg.price == null) return;
        const orig = byProduct.get(msg.product_id);
        if (!orig) return;
        const price = parseFloat(msg.price);
        if (!Number.isFinite(price)) return;
        const open = msg.open_24h != null ? parseFloat(msg.open_24h) : NaN;
        const open24h = Number.isFinite(open) ? open : undefined;
        const change =
          open24h && open24h !== 0 ? ((price - open24h) / open24h) * 100 : undefined;
        opts.onQuote({
          symbol: orig,
          price,
          change,
          open24h,
          source: 'coinbase',
        });
      } catch {
        /* ignore */
      }
    },
  });

  return { stop };
}

// ── Mock synthetic ─────────────────────────────────────────────────

/** Deterministic-ish seed prices with random walk; status mode `mock`. */
function startMockQuotes(
  symbols: string[],
  opts: StartWatchlistQuotesOpts,
): QuoteMuxHandle {
  const state = new Map<string, { price: number; change: number }>();
  for (const sym of symbols) {
    const seed = [...sym].reduce((a, c) => a + c.charCodeAt(0), 0);
    state.set(sym, { price: 50 + (seed % 200), change: 0 });
  }

  opts.onStatus?.({ state: 'open', mode: 'mock', detail: 'mock walk' });

  const tick = () => {
    for (const sym of symbols) {
      const cur = state.get(sym)!;
      const delta = (Math.random() - 0.5) * 0.4;
      cur.price = Math.max(0.01, cur.price + delta);
      cur.change = Math.max(-15, Math.min(15, cur.change + (Math.random() - 0.5) * 0.15));
      opts.onQuote({
        symbol: sym,
        price: cur.price,
        change: cur.change,
        source: 'mock',
      });
    }
  };

  // First tick soon, then every 500ms (tick-like, not REST interval)
  tick();
  const timer = setInterval(tick, 500);

  return {
    stop: () => {
      clearInterval(timer);
      opts.onStatus?.({ state: 'closed', mode: 'mock' });
    },
  };
}

/**
 * Exported for tests — parse a Binance combined ticker frame into a {@link QuoteUpdate}.
 * Mirrors the live `onMessage` mapping without opening a socket.
 */
export function parseBinanceTickerMessage(
  raw: string,
  byStream: Map<string, string>,
): QuoteUpdate | null {
  try {
    const msg = JSON.parse(raw) as {
      stream?: string;
      data?: { s?: string; c?: string; P?: string; o?: string };
    };
    const d = msg.data;
    if (!d?.s || d.c == null) return null;
    const stream = (msg.stream || `${d.s.toLowerCase()}@ticker`).toLowerCase();
    const symbol = byStream.get(stream) || d.s;
    const price = parseFloat(d.c);
    if (!Number.isFinite(price)) return null;
    const change = d.P != null ? parseFloat(d.P) : undefined;
    const open24h = d.o != null ? parseFloat(d.o) : undefined;
    return {
      symbol,
      price,
      change: Number.isFinite(change!) ? change : undefined,
      open24h: Number.isFinite(open24h!) ? open24h : undefined,
      source: 'binance',
    };
  } catch {
    return null;
  }
}
