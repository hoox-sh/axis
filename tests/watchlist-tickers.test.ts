/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import './setup';
import { describe, expect, it, afterEach } from 'bun:test';
import {
  coinbaseProduct,
  fetchWatchlistTickers,
  okxInst,
  toUsdt,
  WATCHLIST_INTERVALS,
  WATCHLIST_REFRESH_OPTIONS,
} from '../src/data/watchlist-tickers';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';

afterEach(() => {
  // mockFetch restore is returned per-test; nothing global here
});

describe('toUsdt / okxInst / coinbaseProduct', () => {
  it('normalizes bare symbols to USDT', () => {
    expect(toUsdt('btc')).toBe('BTCUSDT');
    expect(toUsdt('BTC/USDT')).toBe('BTCUSDT');
    expect(toUsdt('btc-usdt')).toBe('BTCUSDT');
    expect(toUsdt('ETHUSD')).toBe('ETHUSD');
    expect(toUsdt('ETHUSDC')).toBe('ETHUSDC');
    expect(toUsdt('BTCUSDT')).toBe('BTCUSDT');
  });

  it('builds OKX instIds', () => {
    expect(okxInst('BTCUSDT')).toBe('BTC-USDT');
    expect(okxInst('ETHUSD')).toBe('ETH-USD');
    expect(okxInst('BTC')).toBe('BTC-USDT');
  });

  it('builds coinbase products', () => {
    expect(coinbaseProduct('BTCUSDT')).toBe('BTC-USD');
    expect(coinbaseProduct('BTC')).toBe('BTC-USD');
    expect(coinbaseProduct('ETHUSDC')).toBe('ETH-USD');
  });

  it('exposes interval constants', () => {
    expect(WATCHLIST_INTERVALS).toContain('1m');
    expect(WATCHLIST_INTERVALS).toContain('1d');
    expect(WATCHLIST_REFRESH_OPTIONS.map((o) => o.value)).toContain(60);
  });
});

describe('fetchWatchlistTickers routing', () => {
  it('returns empty for no symbols', async () => {
    expect(await fetchWatchlistTickers([], 'binance')).toEqual({});
  });

  it('mock source is deterministic without network', async () => {
    const a = await fetchWatchlistTickers(['BTC', 'ETH'], 'mock-feed');
    expect(Object.keys(a)).toEqual(['BTC', 'ETH']);
    expect(a.BTC!.source).toBe('mock');
    expect(Number.isFinite(a.BTC!.price)).toBe(true);
  });

  it('csv / upload / kraken / gecko / unknown return empty', async () => {
    expect(await fetchWatchlistTickers(['BTC'], 'csv-file')).toEqual({});
    expect(await fetchWatchlistTickers(['BTC'], 'upload')).toEqual({});
    expect(await fetchWatchlistTickers(['BTC'], 'kraken-spot')).toEqual({});
    expect(await fetchWatchlistTickers(['BTC'], 'gecko')).toEqual({});
    expect(await fetchWatchlistTickers(['BTC'], 'some-unknown-venue')).toEqual({});
  });

  it('binance maps exchange symbols back to watchlist keys', async () => {
    const restore = mockFetch(async () =>
      jsonResponse([
        { symbol: 'BTCUSDT', lastPrice: '50000', priceChangePercent: '2.5', openPrice: '48750' },
        { symbol: 'ETHUSDT', lastPrice: '3000', priceChangePercent: '-1.0' },
      ]),
    );
    try {
      const out = await fetchWatchlistTickers(['btc', 'ETH'], 'binance-rest');
      expect(out.btc!.price).toBe(50000);
      expect(out.btc!.open24h).toBe(48750);
      expect(out.btc!.source).toBe('binance');
      expect(out.ETH!.open24h).toBeUndefined();
    } finally {
      restore();
    }
  });

  it('binance throws on unexpected body → outer catch returns empty', async () => {
    const restore = mockFetch(async () => jsonResponse({ nope: true }));
    try {
      expect(await fetchWatchlistTickers(['BTC'], 'binance')).toEqual({});
    } finally {
      restore();
    }
  });

  it('okx computes change from open24h and skips missing', async () => {
    const restore = mockFetch(async () =>
      jsonResponse({
        data: [
          { instId: 'BTC-USDT', last: '100', open24h: '80' },
          { instId: 'ETH-USDT', last: '50', sodUtc0: '50' },
        ],
      }),
    );
    try {
      const out = await fetchWatchlistTickers(['BTC', 'ETH', 'SOL'], 'okx-spot');
      expect(out.BTC!.change).toBeCloseTo(25, 5);
      expect(out.ETH!.change).toBe(0);
      expect(out.SOL).toBeUndefined();
      expect(out.BTC!.source).toBe('okx');
    } finally {
      restore();
    }
  });

  it('okx non-ok → empty', async () => {
    const restore = mockFetch(async () => new Response('x', { status: 500 }));
    try {
      expect(await fetchWatchlistTickers(['BTC'], 'okx')).toEqual({});
    } finally {
      restore();
    }
  });

  it('bybit converts fraction to percent', async () => {
    const restore = mockFetch(async () =>
      jsonResponse({
        result: { list: [{ symbol: 'BTCUSDT', lastPrice: '60000', price24hPcnt: '0.05' }] },
      }),
    );
    try {
      const out = await fetchWatchlistTickers(['BTC', 'DOGE'], 'bybit-spot');
      expect(out.BTC!.change).toBeCloseTo(5, 5);
      expect(out.DOGE).toBeUndefined();
    } finally {
      restore();
    }
  });

  it('bybit non-ok → empty', async () => {
    const restore = mockFetch(async () => new Response('x', { status: 429 }));
    try {
      expect(await fetchWatchlistTickers(['BTC'], 'bybit')).toEqual({});
    } finally {
      restore();
    }
  });

  it('coinbase caps at 12 and tolerates ticker failures', async () => {
    const restore = mockFetch(async (input) => {
      const url = String(input);
      if (url.includes('/products/BTC-USD/ticker')) {
        return jsonResponse({ price: '40000' });
      }
      if (url.includes('/products/BTC-USD/stats')) {
        return jsonResponse({ open: '38000', last: '40000' });
      }
      return new Response('nf', { status: 404 });
    });
    try {
      const many = Array.from({ length: 15 }, (_, i) => `SYM${i}`);
      const out = await fetchWatchlistTickers(['BTC', ...many], 'coinbase');
      expect(out.BTC!.price).toBe(40000);
      expect(out.BTC!.change).toBeCloseTo(((40000 - 38000) / 38000) * 100, 3);
    } finally {
      restore();
    }
  });

  it('coinbase skips zero-price tickers', async () => {
    const restore = mockFetch(async () => jsonResponse({ price: '0' }));
    try {
      expect(await fetchWatchlistTickers(['BTC'], 'coinbase')).toEqual({});
    } finally {
      restore();
    }
  });

  it('mexc single-symbol path maps rows', async () => {
    const restore = mockFetch(async () =>
      jsonResponse({ symbol: 'BTCUSDT', lastPrice: '42', priceChangePercent: '1.5', openPrice: '40' }),
    );
    try {
      const out = await fetchWatchlistTickers(['BTC'], 'mexc-spot');
      expect(out.BTC!.price).toBe(42);
      expect(out.BTC!.source).toBe('mexc');
      expect(out.BTC!.open24h).toBe(40);
    } finally {
      restore();
    }
  });

  it('mexc full-book path for >8 symbols', async () => {
    const restore = mockFetch(async () =>
      jsonResponse([
        { symbol: 'BTCUSDT', lastPrice: '1', priceChangePercent: '0' },
        { symbol: 'ETHUSDT', lastPrice: '2', priceChangePercent: '0' },
      ]),
    );
    try {
      const syms = Array.from({ length: 10 }, (_, i) => (i === 0 ? 'BTC' : `X${i}`));
      const out = await fetchWatchlistTickers(syms, 'mexc');
      expect(out.BTC!.price).toBe(1);
      expect(out.X1).toBeUndefined();
    } finally {
      restore();
    }
  });

  it('mexc unexpected body → empty', async () => {
    const restore = mockFetch(async () => jsonResponse(42));
    try {
      expect(await fetchWatchlistTickers(['BTC'], 'mexc')).toEqual({});
    } finally {
      restore();
    }
  });
});
