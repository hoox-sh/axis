// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from 'bun:test';
import {
  compactPair,
  filterSymbols,
  listQuotes,
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
  });
});
