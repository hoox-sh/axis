/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import { currentSeriesKey, marketIdentityKey, pairFormSymbol, sameMarketIdentity } from '../../src/engine/market-identity';

describe('redesign2 market identity (F-04)', () => {
  test('produces the canonical exchange|market|SYMBOL|interval key', () => {
    expect(
      marketIdentityKey({ exchange: 'Binance', market: 'Spot', symbol: 'btc/usdt', interval: '1m' }),
    ).toBe('binance|spot|BTC/USDT|1m');
  });

  test('interval passes through verbatim (trimmed only)', () => {
    expect(
      marketIdentityKey({ exchange: 'binance', market: 'swap', symbol: 'ETH/USDT', interval: '1h' }),
    ).toBe('binance|swap|ETH/USDT|1h');
  });

  test('market dimension distinguishes otherwise identical keys', () => {
    const spot = { exchange: 'binance', market: 'spot', symbol: 'BTC/USDT', interval: '1m' };
    const future = { exchange: 'binance', market: 'future', symbol: 'BTC/USDT', interval: '1m' };
    expect(sameMarketIdentity(spot, future)).toBe(false);
    expect(sameMarketIdentity(spot, { ...spot, symbol: 'btc/usdt' })).toBe(true);
  });

  test('pairFormSymbol maps load form via catalog, passes through otherwise', () => {
    const catalog = [{ symbol: 'BTCUSDT', display: 'BTC/USDT' }];
    expect(pairFormSymbol('BTCUSDT', catalog)).toBe('BTC/USDT');
    expect(pairFormSymbol('BTC/USDT', catalog)).toBe('BTC/USDT');
    expect(pairFormSymbol('UNKNOWNXYZ', catalog)).toBe('UNKNOWNXYZ');
  });

  test('currentSeriesKey defaults market to spot', () => {
    const catalog = [{ symbol: 'BTCUSDT', display: 'BTC/USDT' }];
    expect(
      currentSeriesKey({ exchange: 'Binance', symbol: 'BTCUSDT', interval: '1m', catalog }),
    ).toBe('binance|spot|BTC/USDT|1m');
  });
});
