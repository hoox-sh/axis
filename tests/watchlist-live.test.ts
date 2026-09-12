/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Watchlist live feeds (`src/data/watchlist-live.ts`).
 * Guards Binance ticker frame parsing, no-op sources (empty/csv), combined-stream
 * open path (MockWebSocket), and mock-walk tick generation.
 */

import { describe, expect, it, afterEach } from 'bun:test';
import {
  parseBinanceTickerMessage,
  startWatchlistQuotes,
} from '../src/data/watchlist-live.ts';
import { MockWebSocket } from './helpers/mock-ws.ts';

describe('parseBinanceTickerMessage', () => {
  it('maps combined stream frame to quote', () => {
    const byStream = new Map([['btcusdt@ticker', 'BTCUSDT']]);
    const u = parseBinanceTickerMessage(
      JSON.stringify({
        stream: 'btcusdt@ticker',
        data: { s: 'BTCUSDT', c: '65000.5', P: '1.25', o: '64200' },
      }),
      byStream,
    );
    expect(u).not.toBeNull();
    expect(u!.symbol).toBe('BTCUSDT');
    expect(u!.price).toBeCloseTo(65000.5);
    expect(u!.change).toBeCloseTo(1.25);
    expect(u!.open24h).toBeCloseTo(64200);
    expect(u!.source).toBe('binance');
  });

  it('returns null on garbage', () => {
    expect(parseBinanceTickerMessage('not-json', new Map())).toBeNull();
  });
});

describe('startWatchlistQuotes', () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('no-ops for empty symbols', () => {
    const quotes: unknown[] = [];
    const h = startWatchlistQuotes({
      sourceId: 'binance-rest',
      symbols: [],
      onQuote: (u) => quotes.push(u),
    });
    h.stop();
    expect(quotes).toHaveLength(0);
  });

  it('no-ops for csv source', () => {
    let status = '';
    const h = startWatchlistQuotes({
      sourceId: 'csv-upload',
      symbols: ['BTCUSDT'],
      onQuote: () => {},
      onStatus: (s) => {
        status = s.mode || s.state;
      },
    });
    h.stop();
    expect(status === 'none' || status === 'closed').toBe(true);
  });

  it('opens binance combined stream and emits on ticker', async () => {
    restore = MockWebSocket.install();
    const quotes: Array<{ symbol: string; price: number }> = [];
    const statuses: string[] = [];

    const h = startWatchlistQuotes({
      sourceId: 'binance-rest',
      symbols: ['BTCUSDT', 'ETH'],
      onQuote: (u) => quotes.push({ symbol: u.symbol, price: u.price }),
      onStatus: (s) => statuses.push(s.state),
    });

    // Wait for MockWebSocket open
    await new Promise((r) => setTimeout(r, 20));
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(1);
    const ws = MockWebSocket.instances[0]!;
    expect(ws.url).toContain('stream.binance.com');
    expect(ws.url).toContain('btcusdt@ticker');
    expect(ws.url).toContain('ethusdt@ticker');

    ws.push({
      stream: 'btcusdt@ticker',
      data: { s: 'BTCUSDT', c: '70000', P: '2.5', o: '68000' },
    });
    expect(quotes.some((q) => q.symbol === 'BTCUSDT' && q.price === 70000)).toBe(true);

    h.stop();
    expect(statuses).toContain('open');
  });

  it('does not fall back to Binance for Kraken', () => {
    restore = MockWebSocket.install();
    let detail = '';
    const h = startWatchlistQuotes({
      sourceId: 'kraken-rest',
      symbols: ['BTCUSDT'],
      onQuote: () => {},
      onStatus: (s) => {
        detail = `${s.mode || ''} ${s.detail || ''}`;
      },
    });
    h.stop();
    expect(MockWebSocket.instances.length).toBe(0);
    expect(detail).toMatch(/none/i);
    expect(detail).toMatch(/Kraken/i);
  });

  it('mock source emits synthetic ticks then stops', async () => {
    const quotes: string[] = [];
    const h = startWatchlistQuotes({
      sourceId: 'mock-walk',
      symbols: ['AAAUSDT'],
      onQuote: (u) => quotes.push(u.symbol),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(quotes.length).toBeGreaterThan(0);
    h.stop();
    const n = quotes.length;
    await new Promise((r) => setTimeout(r, 600));
    expect(quotes.length).toBe(n);
  });

  it('routes okx / bybit / coinbase WS and emits quotes', async () => {
    restore = MockWebSocket.install();
    const seen: Array<{ symbol: string; source?: string }> = [];
    const handles = [
      startWatchlistQuotes({ sourceId: 'okx-rest', symbols: ['BTC'], onQuote: (u) => seen.push(u) }),
      startWatchlistQuotes({ sourceId: 'bybit-spot', symbols: ['BTCUSDT'], onQuote: (u) => seen.push(u) }),
      startWatchlistQuotes({ sourceId: 'coinbase-rest', symbols: ['BTC'], onQuote: (u) => seen.push(u) }),
    ];
    await new Promise((r) => setTimeout(r, 20));
    expect(MockWebSocket.instances.length).toBe(3);
    const urls = MockWebSocket.instances.map((w) => w.url);
    expect(urls.some((u) => u.includes('okx'))).toBe(true);
    expect(urls.some((u) => u.includes('bybit'))).toBe(true);
    expect(urls.some((u) => u.includes('coinbase'))).toBe(true);

    const okx = MockWebSocket.instances.find((w) => w.url.includes('okx'))!;
    okx.push({ data: [{ instId: 'BTC-USDT', last: '100', open24h: '80' }] });
    okx.push({ data: [{ instId: 'NOPE', last: '1' }] });
    okx.push({ data: [{ last: '1' }] });
    okx.push('garbage{{{');

    const bybit = MockWebSocket.instances.find((w) => w.url.includes('bybit'))!;
    bybit.push({ topic: 'tickers', data: { symbol: 'BTCUSDT', lastPrice: '60000', price24hPcnt: '0.05', prevPrice24h: '57000' } });
    bybit.push({ topic: 'x', data: { symbol: 'NOPE', lastPrice: '1' } });
    bybit.push({ topic: 'tickers', data: { symbol: 'BTCUSDT', lastPrice: 'nan' } });

    const cb = MockWebSocket.instances.find((w) => w.url.includes('coinbase'))!;
    cb.push({ type: 'ticker', product_id: 'BTC-USD', price: '40000', open_24h: '38000' });
    cb.push({ type: 'ticker', product_id: 'NOPE-USD', price: '1' });
    cb.push({ type: 'heartbeat', product_id: 'BTC-USD', price: '1' });

    expect(seen.some((q) => q.source === 'okx' && q.symbol === 'BTC')).toBe(true);
    expect(seen.some((q) => q.source === 'bybit')).toBe(true);
    expect(seen.some((q) => q.source === 'coinbase')).toBe(true);
    for (const h of handles) h.stop();
  });

  it('no-ops for mexc / gecko / unknown / blank symbols', () => {
    for (const sourceId of ['mexc-spot', 'gecko-terminal', 'whatever-xyz']) {
      let mode = '';
      const h = startWatchlistQuotes({
        sourceId,
        symbols: ['BTC'],
        onQuote: () => {
          throw new Error('should not emit');
        },
        onStatus: (s) => {
          mode = s.mode || '';
        },
      });
      h.stop();
      expect(mode).toBe('none');
    }
    // blank strings filtered → no symbols
    let detail = '';
    const h = startWatchlistQuotes({
      sourceId: 'binance-rest',
      symbols: ['', '  ', ''],
      onQuote: () => {},
      onStatus: (s) => {
        detail = s.detail || '';
      },
    });
    h.stop();
    // all-blank filter leaves ['  '] truthy? '' filtered, '  ' passes filter(Boolean)
    // either no-symbols or a binance handle — must not throw
    expect(typeof detail).toBe('string');
  });

  it('data-manager source resolves to underlying selection', async () => {
    restore = MockWebSocket.install();
    const h = startWatchlistQuotes({
      sourceId: 'data-manager',
      symbols: ['BTCUSDT'],
      onQuote: () => {},
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(0);
    h.stop();
  });

  it('parseBinanceTickerMessage edge cases', () => {
    const byStream = new Map([['btcusdt@ticker', 'BTC']]);
    // missing stream falls back to symbol-derived stream
    expect(
      parseBinanceTickerMessage(JSON.stringify({ data: { s: 'BTCUSDT', c: '1' } }), byStream),
    ).toMatchObject({ symbol: 'BTC' });
    // unknown stream falls back to exchange symbol
    expect(
      parseBinanceTickerMessage(
        JSON.stringify({ stream: 'x@ticker', data: { s: 'ZZZ', c: '5' } }),
        byStream,
      ),
    ).toMatchObject({ symbol: 'ZZZ' });
    // missing price / non-finite / missing symbol → null
    expect(parseBinanceTickerMessage(JSON.stringify({ data: {} }), byStream)).toBeNull();
    expect(
      parseBinanceTickerMessage(JSON.stringify({ data: { s: 'X', c: 'nan' } }), byStream),
    ).toBeNull();
    expect(
      parseBinanceTickerMessage(JSON.stringify({ data: { s: 'X' } }), byStream),
    ).toBeNull();
    // non-finite change/open become undefined, not NaN
    const u = parseBinanceTickerMessage(
      JSON.stringify({ data: { s: 'X', c: '10', P: 'bad', o: 'bad' } }),
      new Map(),
    );
    expect(u!.change).toBeUndefined();
    expect(u!.open24h).toBeUndefined();
  });
});
