// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import '../tests/setup';
import { describe, expect, test } from 'bun:test';
import {
  compactPair,
  filterSymbols,
  listQuotes,
  loadSymbolCatalog,
  resolveSymbolVenue,
  type SymbolEntry,
  venueLabel,
} from '../src/data/symbol-catalog';

const SAMPLE: SymbolEntry[] = [
  { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', display: 'BTC/USDT' },
  { symbol: 'ETHUSDT', base: 'ETH', quote: 'USDT', display: 'ETH/USDT' },
  { symbol: 'BTCEUR', base: 'BTC', quote: 'EUR', display: 'BTC/EUR' },
  { symbol: 'SOLUSDT', base: 'SOL', quote: 'USDT', display: 'SOL/USDT' },
  { symbol: 'ETHBTC', base: 'ETH', quote: 'BTC', display: 'ETH/BTC' },
];

describe('resolveSymbolVenue', () => {
  test('maps rest sources to venues', () => {
    expect(resolveSymbolVenue('binance-rest')).toBe('binance');
    expect(resolveSymbolVenue('okx-rest')).toBe('okx');
    expect(resolveSymbolVenue('bybit-rest')).toBe('bybit');
    expect(resolveSymbolVenue('coinbase-rest')).toBe('coinbase');
    expect(resolveSymbolVenue('kraken-rest')).toBe('kraken');
    expect(resolveSymbolVenue('mexc-rest')).toBe('mexc');
    expect(resolveSymbolVenue('geckoterminal-ohlcv')).toBe('gecko');
  });

  test('maps streams when source is offline', () => {
    expect(resolveSymbolVenue('mock-walk', 'binance-ws')).toBe('binance');
    expect(resolveSymbolVenue('csv-upload', 'okx-ws')).toBe('okx');
    expect(resolveSymbolVenue('mock-walk', 'mock-poll')).toBe('generic');
  });

  test('source wins over stream for venue sources', () => {
    expect(resolveSymbolVenue('okx-rest', 'binance-ws')).toBe('okx');
  });

  test('ccxt-rest maps to generic until a catalog exchange is passed', () => {
    expect(resolveSymbolVenue('ccxt-rest', 'ccxt-ws')).toBe('generic');
  });
});

describe('loadSymbolCatalog CCXT', () => {
  test('fetches gateway markets and keeps unified BTC/USDT symbols', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = ((url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : String(url);
      expect(u).toContain('/markets');
      expect(u).toContain('exchange=bybit');
      return Promise.resolve(
        new Response(
          JSON.stringify([
            { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT', active: true },
            { symbol: 'ETH/USDT', base: 'ETH', quote: 'USDT', active: false },
          ]),
          { status: 200 },
        ),
      );
    }) as typeof fetch;
    try {
      const r = await loadSymbolCatalog('generic', {
        ccxtExchange: 'bybit',
        gateway: 'pyne',
        forceRefresh: true,
      });
      expect(r.label).toBe('bybit (CCXT)');
      expect(r.symbols.map((s) => s.symbol)).toEqual(['BTC/USDT']);
      expect(r.fallback).toBe(false);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe('filterSymbols', () => {
  test('empty query prefers majors and respects quote filter', () => {
    const all = filterSymbols(SAMPLE, '', { limit: 10 });
    expect(all.map((s) => s.symbol)).toContain('BTCUSDT');

    const usdt = filterSymbols(SAMPLE, '', { quote: 'USDT', limit: 10 });
    expect(usdt.every((s) => s.quote === 'USDT')).toBe(true);
    expect(usdt.find((s) => s.symbol === 'BTCEUR')).toBeUndefined();
  });

  test('ranks exact and prefix matches', () => {
    const r = filterSymbols(SAMPLE, 'btc', { limit: 10 });
    expect(r[0]?.symbol).toBe('BTCUSDT');
    expect(r.map((s) => s.symbol)).toContain('BTCEUR');

    const exact = filterSymbols(SAMPLE, 'ETHUSDT', { limit: 5 });
    expect(exact[0]?.symbol).toBe('ETHUSDT');
  });
});

describe('listQuotes / helpers', () => {
  test('listQuotes prioritizes USDT', () => {
    const q = listQuotes(SAMPLE);
    expect(q[0]).toBe('USDT');
    expect(q).toContain('EUR');
  });

  test('compactPair and venueLabel', () => {
    expect(compactPair('btc', 'usdt')).toBe('BTCUSDT');
    expect(venueLabel('binance')).toBe('Binance');
    expect(venueLabel('generic')).toBe('Popular majors');
    expect(venueLabel('gecko')).toBe('GeckoTerminal');
  });

  test('filterSymbols quote ALL and scoring tiers', () => {
    const all = filterSymbols(SAMPLE, '', { quote: 'ALL', limit: 10 });
    expect(all.length).toBeGreaterThan(0);
    // base-exact, prefix, includes tiers
    expect(filterSymbols(SAMPLE, 'ETH', { limit: 10 })[0]?.base).toBe('ETH');
    expect(filterSymbols(SAMPLE, 'SOLU', { limit: 10 })[0]?.symbol).toBe('SOLUSDT');
    expect(filterSymbols(SAMPLE, 'EUR', { limit: 10 })[0]?.symbol).toBe('BTCEUR');
    expect(filterSymbols(SAMPLE, 'zzz-no-match', { limit: 10 })).toEqual([]);
    // quote boost ordering: USDT before BTC-quoted
    const mixed = filterSymbols(SAMPLE, 'ETH', { limit: 10 });
    expect(mixed[0]?.quote).toBe('USDT');
  });
});

describe('loadSymbolCatalog venues', () => {
  test('binance filters non-trading and maps assets', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = ((..._args: unknown[]) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            symbols: [
              { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING' },
              { symbol: 'OLD', baseAsset: 'O', quoteAsset: 'USDT', status: 'BREAK' },
              { symbol: 'NOPE', baseAsset: 'N', quoteAsset: 'USDT', status: 'TRADING', isSpotTradingAllowed: false },
            ],
          }),
          { status: 200 },
        ),
      )) as unknown as typeof fetch;
    try {
      localStorage.clear();
      const r = await loadSymbolCatalog('binance', { forceRefresh: true });
      expect(r.fallback).toBe(false);
      expect(r.symbols.map((s) => s.symbol)).toEqual(['BTCUSDT']);
      // second call serves from cache
      const cached = await loadSymbolCatalog('binance');
      expect(cached.fromCache).toBe(true);
    } finally {
      globalThis.fetch = orig;
      localStorage.clear();
    }
  });

  test('okx live filter and error paths', async () => {
    const orig = globalThis.fetch;
    try {
      localStorage.clear();
      globalThis.fetch = ((..._args: unknown[]) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              code: '0',
              data: [
                { instId: 'BTC-USDT', baseCcy: 'BTC', quoteCcy: 'USDT', state: 'live' },
                { instId: 'OLD-USDT', baseCcy: 'OLD', quoteCcy: 'USDT', state: 'suspended' },
              ],
            }),
            { status: 200 },
          ),
        )) as unknown as typeof fetch;
      const r = await loadSymbolCatalog('okx', { forceRefresh: true });
      expect(r.symbols.map((s) => s.symbol)).toEqual(['BTCUSDT']);

      globalThis.fetch = ((..._args: unknown[]) =>
        Promise.resolve(new Response('x', { status: 500 }))) as unknown as typeof fetch;
      localStorage.clear();
      const fb = await loadSymbolCatalog('okx', { forceRefresh: true });
      expect(fb.fallback).toBe(true);
      expect(fb.error).toContain('500');

      globalThis.fetch = ((..._args: unknown[]) =>
        Promise.resolve(new Response(JSON.stringify({ code: '1', data: [] }), { status: 200 }))) as unknown as typeof fetch;
      localStorage.clear();
      const fb2 = await loadSymbolCatalog('okx', { forceRefresh: true });
      expect(fb2.fallback).toBe(true);
    } finally {
      globalThis.fetch = orig;
      localStorage.clear();
    }
  });

  test('bybit trading filter and empty-instruments error', async () => {
    const orig = globalThis.fetch;
    try {
      localStorage.clear();
      globalThis.fetch = ((..._args: unknown[]) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              retCode: 0,
              result: {
                list: [
                  { symbol: 'BTCUSDT', baseCoin: 'BTC', quoteCoin: 'USDT', status: 'Trading' },
                  { symbol: 'OLD', baseCoin: 'O', quoteCoin: 'USDT', status: 'Closed' },
                ],
              },
            }),
            { status: 200 },
          ),
        )) as unknown as typeof fetch;
      const r = await loadSymbolCatalog('bybit', { forceRefresh: true });
      expect(r.symbols.map((s) => s.symbol)).toEqual(['BTCUSDT']);

      globalThis.fetch = ((..._args: unknown[]) =>
        Promise.resolve(new Response(JSON.stringify({ retCode: 1 }), { status: 200 }))) as unknown as typeof fetch;
      localStorage.clear();
      expect((await loadSymbolCatalog('bybit', { forceRefresh: true })).fallback).toBe(true);

      globalThis.fetch = ((..._args: unknown[]) =>
        Promise.resolve(new Response('x', { status: 503 }))) as unknown as typeof fetch;
      localStorage.clear();
      expect((await loadSymbolCatalog('bybit', { forceRefresh: true })).fallback).toBe(true);
    } finally {
      globalThis.fetch = orig;
      localStorage.clear();
    }
  });

  test('coinbase maps USD quotes to USDT axis symbols', async () => {
    const orig = globalThis.fetch;
    try {
      localStorage.clear();
      globalThis.fetch = ((..._args: unknown[]) =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'BTC-USD', base_currency: 'BTC', quote_currency: 'USD', status: 'online' },
              { id: 'ETH-EUR', base_currency: 'ETH', quote_currency: 'EUR', status: 'online' },
              { id: 'OFF', base_currency: 'X', quote_currency: 'USD', status: 'offline' },
            ]),
            { status: 200 },
          ),
        )) as unknown as typeof fetch;
      const r = await loadSymbolCatalog('coinbase', { forceRefresh: true });
      expect(r.symbols.find((s) => s.base === 'BTC')?.symbol).toBe('BTCUSDT');
      expect(r.symbols.find((s) => s.base === 'ETH')?.quote).toBe('EUR');

      globalThis.fetch = ((..._args: unknown[]) =>
        Promise.resolve(new Response('[]', { status: 200 }))) as unknown as typeof fetch;
      // non-array body → fallback
      globalThis.fetch = ((..._args: unknown[]) =>
        Promise.resolve(new Response(JSON.stringify({ nope: 1 }), { status: 200 }))) as unknown as typeof fetch;
      localStorage.clear();
      expect((await loadSymbolCatalog('coinbase', { forceRefresh: true })).fallback).toBe(true);
    } finally {
      globalThis.fetch = orig;
      localStorage.clear();
    }
  });

  test('kraken normalizes XBT and skips offline/empty', async () => {
    const orig = globalThis.fetch;
    try {
      localStorage.clear();
      globalThis.fetch = ((..._args: unknown[]) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: [],
              result: {
                XXBTZUSD: { base: 'XXBT', quote: 'ZUSD', status: 'online', wsname: 'XBT/USD' },
                ETHUSD: { base: 'ETH', quote: 'USD', status: 'offline', wsname: 'ETH/USD' },
                BAD: { base: '', quote: '', wsname: '' },
                NOWS: { base: 'SOL', quote: 'USD' },
              },
            }),
            { status: 200 },
          ),
        )) as unknown as typeof fetch;
      const r = await loadSymbolCatalog('kraken', { forceRefresh: true });
      expect(r.symbols.map((s) => s.symbol)).toContain('BTCUSD');
      expect(r.symbols.map((s) => s.symbol)).toContain('SOLUSD');

      globalThis.fetch = ((..._args: unknown[]) =>
        Promise.resolve(
          new Response(JSON.stringify({ error: ['EQuery:Unknown asset pair'] }), { status: 200 }),
        )) as unknown as typeof fetch;
      localStorage.clear();
      expect((await loadSymbolCatalog('kraken', { forceRefresh: true })).fallback).toBe(true);
    } finally {
      globalThis.fetch = orig;
      localStorage.clear();
    }
  });

  test('mexc accepts ENABLED and falls back on empty', async () => {
    const orig = globalThis.fetch;
    try {
      localStorage.clear();
      globalThis.fetch = ((..._args: unknown[]) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              symbols: [
                { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'ENABLED' },
                { symbol: 'OLD', baseAsset: 'O', quoteAsset: 'USDT', status: 'DISABLED' },
              ],
            }),
            { status: 200 },
          ),
        )) as unknown as typeof fetch;
      expect((await loadSymbolCatalog('mexc', { forceRefresh: true })).symbols[0]?.symbol).toBe(
        'BTCUSDT',
      );
    } finally {
      globalThis.fetch = orig;
      localStorage.clear();
    }
  });

  test('gecko and generic return static majors', async () => {
    localStorage.clear();
    const g = await loadSymbolCatalog('gecko', { forceRefresh: true });
    expect(g.fallback).toBe(true);
    expect(g.symbols.length).toBeGreaterThan(5);
    const gen = await loadSymbolCatalog('generic', { forceRefresh: true });
    expect(gen.fallback).toBe(true);
  });

  test('aborted signal and empty catalog fall back with cache preference', async () => {
    localStorage.clear();
    const ctl = new AbortController();
    ctl.abort();
    const r = await loadSymbolCatalog('binance', { signal: ctl.signal });
    expect(r.fallback).toBe(true);
    expect(r.error).toContain('aborted');

    // seed cache, then fail network → serve stale cache with error
    const orig = globalThis.fetch;
    globalThis.fetch = ((..._args: unknown[]) =>
      Promise.resolve(
        new Response(JSON.stringify({ symbols: [] }), { status: 200 }),
      )) as unknown as typeof fetch;
    try {
      localStorage.setItem(
        'axis.symbols.v1.binance',
        JSON.stringify({ ts: Date.now(), symbols: [{ symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', display: 'BTC/USDT' }] }),
      );
      const stale = await loadSymbolCatalog('binance', { forceRefresh: true });
      // empty catalog → error path → stale cache wins
      expect(stale.fromCache).toBe(true);
    } finally {
      globalThis.fetch = orig;
      localStorage.clear();
    }
  });

  test('corrupt cache is ignored and quota errors swallowed', async () => {
    localStorage.clear();
    localStorage.setItem('axis.symbols.v1.binance', 'not-json{{{');
    localStorage.setItem('axis.symbols.v1.stale', JSON.stringify({ ts: 1, symbols: [{ symbol: 'X', base: 'X', quote: 'U', display: 'X/U' }] }));
    const orig = globalThis.fetch;
    globalThis.fetch = ((..._args: unknown[]) => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    try {
      const r = await loadSymbolCatalog('binance', { forceRefresh: true });
      expect(r.fallback).toBe(true);
    } finally {
      globalThis.fetch = orig;
      localStorage.clear();
    }
  });

  test('ccxt gateway error rows are skipped; non-array and aborted handled', async () => {
    const orig = globalThis.fetch;
    try {
      localStorage.clear();
      globalThis.fetch = (async (url: string | URL | Request) => {
        const u = String(url);
        if (!u.includes('/markets')) return new Response('x', { status: 200 });
        return new Response(
          JSON.stringify([
            null,
            { active: false, symbol: 'ETH/USDT' },
            { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT', active: true },
            { base: 'SOL', quote: 'USDT' },
            { symbol: 'LTCUSDT', base: '', quote: '' },
          ]),
          { status: 200 },
        );
      }) as typeof fetch;
      const r = await loadSymbolCatalog('generic', {
        ccxtExchange: 'kraken',
        gateway: 'pyne',
        forceRefresh: true,
      });
      expect(r.symbols.map((s) => s.symbol)).toContain('BTC/USDT');
      // cached ccxt
      const cached = await loadSymbolCatalog('generic', { ccxtExchange: 'kraken' });
      expect(cached.fromCache).toBe(true);

      // gateway non-ok → fallback majors with display symbols
      globalThis.fetch = ((..._args: unknown[]) =>
        Promise.resolve(new Response('x', { status: 500 }))) as unknown as typeof fetch;
      localStorage.clear();
      const fb = await loadSymbolCatalog('generic', { ccxtExchange: 'kraken', forceRefresh: true });
      expect(fb.fallback).toBe(true);

      const ctl = new AbortController();
      ctl.abort();
      localStorage.clear();
      const ab = await loadSymbolCatalog('generic', { ccxtExchange: 'kraken', signal: ctl.signal });
      expect(ab.fallback).toBe(true);
    } finally {
      globalThis.fetch = orig;
      localStorage.clear();
    }
  });
});
