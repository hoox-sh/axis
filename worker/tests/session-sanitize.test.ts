/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import {
  buildVenueWs,
  sanitizeStreamInterval,
  sanitizeStreamSymbol,
  withoutClient,
} from '../src/durable-objects/session';

describe('SessionDO stream sanitize', () => {
  it('accepts normal CEX symbols', () => {
    expect(sanitizeStreamSymbol('btcusdt')).toBe('BTCUSDT');
    expect(sanitizeStreamSymbol('ETHUSDT')).toBe('ETHUSDT');
  });

  it('rejects path injection and empty', () => {
    expect(sanitizeStreamSymbol('../evil')).toBeNull();
    expect(sanitizeStreamSymbol('BTC/USDT')).toBeNull();
    expect(sanitizeStreamSymbol('')).toBeNull();
    expect(sanitizeStreamSymbol('x'.repeat(40))).toBeNull();
  });

  it('allowlists kline intervals', () => {
    expect(sanitizeStreamInterval('1m')).toBe('1m');
    expect(sanitizeStreamInterval('1d')).toBe('1d');
    expect(sanitizeStreamInterval('1M')).toBe('1M');
    expect(sanitizeStreamInterval('1m/../x')).toBeNull();
    expect(sanitizeStreamInterval('99m')).toBeNull();
  });
});

describe('buildVenueWs', () => {
  it('wires every venue to its own host and the chart interval', () => {
    const binance = buildVenueWs('binance', 'BTCUSDT', '30m');
    expect(binance?.url).toBe('wss://stream.binance.com:9443/ws/btcusdt@kline_30m');
    expect(binance?.subscribe).toBeNull();

    expect(buildVenueWs('okx', 'BTCUSDT', '30m')?.subscribe).toEqual({
      op: 'subscribe',
      args: [{ channel: 'candle30m', instId: 'BTC-USDT' }],
    });
    expect(buildVenueWs('okx', 'BTCUSDT', '3m')?.subscribe).toEqual({
      op: 'subscribe',
      args: [{ channel: 'candle3m', instId: 'BTC-USDT' }],
    });
    expect(buildVenueWs('okx', 'BTCUSDT', '8h')?.subscribe).toEqual({
      op: 'subscribe',
      args: [{ channel: 'candle1D', instId: 'BTC-USDT' }],
    });

    const bybit = buildVenueWs('bybit', 'btcusdt', '30m');
    expect(bybit?.url).toBe('wss://stream.bybit.com/v5/public/spot');
    expect(bybit?.subscribe).toEqual({ op: 'subscribe', args: ['kline.30.BTCUSDT'] });

    expect(buildVenueWs('coinbase', 'BTCUSDT', '1h')?.subscribe).toEqual({
      type: 'subscribe',
      product_ids: ['BTC-USDT'],
      channel: 'candles',
    });

    expect(buildVenueWs('kraken', 'BTCUSDT', '30m')?.subscribe).toEqual({
      event: 'subscribe',
      pair: ['XBT/USDT'],
      subscription: { name: 'ohlc', interval: 30 },
    });
    expect(buildVenueWs('kraken', 'BTCUSD', '1d')?.subscribe).toEqual({
      event: 'subscribe',
      pair: ['XBT/USD'],
      subscription: { name: 'ohlc', interval: 1440 },
    });

    const mexc = buildVenueWs('mexc', 'BTC-USDT', '30m');
    expect(mexc?.url).toBe('wss://wbs.mexc.com/ws');
    expect(mexc?.subscribe).toEqual({
      method: 'SUBSCRIPTION',
      params: ['BTCUSDT@kline@Min30'],
    });

    expect(buildVenueWs('nope' as 'binance', 'BTCUSDT', '1m')).toBeNull();
  });
});

describe('SessionDO withoutClient', () => {
  it('removes only the matching socket and reports emptiness via length', () => {
    const a = {} as WebSocket;
    const b = {} as WebSocket;
    const next = withoutClient([a, b], a);
    expect(next).toEqual([b]);
    expect(withoutClient(next, b)).toEqual([]);
    expect(withoutClient([a], b)).toEqual([a]);
  });
});
