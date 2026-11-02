/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Symbol picker recents and favorites — normalize, cap, and per-venue storage.
 */

import './setup';
import { beforeEach, describe, expect, it } from 'bun:test';
import {
  SYMBOL_FAVORITE_LIMIT,
  SYMBOL_PICKS_KEY,
  SYMBOL_RECENT_LIMIT,
  emptySymbolPicks,
  loadSymbolPicks,
  normalizePickSymbol,
  rememberSymbol,
  saveSymbolPicks,
  symbolPicksScope,
  toggleFavorite,
  visibleSymbolPicks,
} from '../src/ui/symbol-picks';

beforeEach(() => {
  localStorage.removeItem(SYMBOL_PICKS_KEY);
});

describe('normalizePickSymbol', () => {
  it('keeps an uppercase venue symbol and rejects junk', () => {
    expect(normalizePickSymbol(' btcusdt ')).toBe('BTCUSDT');
    expect(normalizePickSymbol('ETH-USD')).toBe('ETH-USD');
    expect(normalizePickSymbol('BTC/USDT:USDT')).toBe('BTC/USDT:USDT');
    expect(normalizePickSymbol('not a symbol!')).toBe('');
    expect(normalizePickSymbol('')).toBe('');
  });
});

describe('symbolPicksScope', () => {
  it('scopes CCXT by exchange and otherwise by venue', () => {
    expect(symbolPicksScope('binance')).toBe('binance');
    expect(symbolPicksScope('generic', 'Bybit')).toBe('ccxt:bybit');
    expect(symbolPicksScope('', '')).toBe('generic');
  });
});

describe('rememberSymbol and toggleFavorite', () => {
  it('puts the latest pick first and caps recents', () => {
    let picks = emptySymbolPicks();
    picks = rememberSymbol(picks, 'ETHUSDT');
    picks = rememberSymbol(picks, 'BTCUSDT');
    picks = rememberSymbol(picks, 'ethusdt');
    expect(picks.recent[0]).toBe('ETHUSDT');
    expect(picks.recent.filter((s) => s === 'ETHUSDT')).toHaveLength(1);

    for (let i = 0; i < 20; i++) picks = rememberSymbol(picks, `S${i}USDT`);
    expect(picks.recent).toHaveLength(SYMBOL_RECENT_LIMIT);
    expect(picks.recent[0]).toBe('S19USDT');
  });

  it('toggles a favorite and hides it from the recent chip row', () => {
    let picks = rememberSymbol(emptySymbolPicks(), 'SOLUSDT');
    picks = toggleFavorite(picks, 'SOLUSDT');
    expect(picks.favorites).toEqual(['SOLUSDT']);
    expect(visibleSymbolPicks(picks).recent).toEqual([]);
    picks = toggleFavorite(picks, 'SOLUSDT');
    expect(picks.favorites).toEqual([]);
    expect(visibleSymbolPicks(picks).recent).toEqual(['SOLUSDT']);
  });

  it('caps favorites', () => {
    let picks = emptySymbolPicks();
    for (let i = 0; i < SYMBOL_FAVORITE_LIMIT + 4; i++) {
      picks = toggleFavorite(picks, `F${i}USDT`);
    }
    expect(picks.favorites).toHaveLength(SYMBOL_FAVORITE_LIMIT);
    expect(picks.favorites[0]).toBe(`F${SYMBOL_FAVORITE_LIMIT + 3}USDT`);
  });

  it('ignores an invalid symbol', () => {
    const picks = rememberSymbol(emptySymbolPicks(), 'bad symbol');
    expect(picks.recent).toEqual([]);
    expect(toggleFavorite(picks, '###').favorites).toEqual([]);
  });
});

describe('storage', () => {
  it('round-trips one venue without clobbering another', () => {
    saveSymbolPicks('binance', {
      recent: ['BTCUSDT'],
      favorites: ['ETHUSDT'],
    });
    saveSymbolPicks('okx', { recent: ['BTC-USDT'], favorites: [] });
    expect(loadSymbolPicks('binance')).toEqual({
      recent: ['BTCUSDT'],
      favorites: ['ETHUSDT'],
    });
    expect(loadSymbolPicks('okx').recent).toEqual(['BTC-USDT']);
  });

  it('drops corrupt entries', () => {
    localStorage.setItem(
      SYMBOL_PICKS_KEY,
      JSON.stringify({
        binance: { recent: ['BTCUSDT', 'nope!', 3, 'ETHUSDT'], favorites: 'no' },
      }),
    );
    expect(loadSymbolPicks('binance')).toEqual({
      recent: ['BTCUSDT', 'ETHUSDT'],
      favorites: [],
    });
    expect(loadSymbolPicks('missing')).toEqual({ recent: [], favorites: [] });
  });
});
