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
 * Independent of chart kline streams (src/streams/multiplex.ts).
 */

import { openReconnectableWs, type WsStatus } from '../streams/reconnect-ws';
import { coinbaseProduct, okxInst, toUsdt } from './watchlist-tickers';

export type QuoteUpdate = {
  symbol: string;
  price: number;
  change?: number;
  open24h?: number;
  source?: string;
};

export type QuoteMuxStatus = WsStatus & { mode?: 'ws' | 'mock' | 'none' };

export type QuoteMuxHandle = {
  stop: () => void;
};

export type StartWatchlistQuotesOpts = {
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
 * Returns stop(); no-op when source has no WS (csv) or empty symbols.
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
    const url = `wss://stream.binance.com:9443/stream?streams=${chunk.join('/')}`;
    stops.push(
      openReconnectableWs({
        url,
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

/** Exported for tests — parse a Binance combined ticker frame. */
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
