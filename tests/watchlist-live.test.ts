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
});
