import { describe, expect, test } from 'bun:test';
import { marketIdentityKey, sameMarketIdentity } from '../../src/engine/market-identity';
import {
  Redesign2BarCloseVerifier,
  compareClosedOhlcv,
  verifyRequestFor,
} from '../../src/engine/bar-close-verify';

describe('redesign2 market identity and verification', () => {
  test('identity keys are case-insensitive and stable', () => {
    const a = { exchange: 'Binance', market: 'Spot', symbol: 'BTCUSDT', interval: '1m' };
    const b = { exchange: 'binance', market: 'spot', symbol: 'BTCUSDT', interval: '1m' };
    expect(marketIdentityKey(a)).toBe(marketIdentityKey(b));
    expect(sameMarketIdentity(a, b)).toBe(true);
  });

  test('bar close verification enforces pending state', () => {
    const verifier = new Redesign2BarCloseVerifier();
    expect(verifier.isPending).toBe(false);
    verifier.begin();
    expect(() => verifier.begin()).toThrow();
    expect(verifier.finish('match')).toBe('match');
    expect(verifier.isPending).toBe(false);
  });
});

describe('redesign2 closed-bar compare (F-17)', () => {
  const bar = { open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 };

  test('identical bars match', () => {
    expect(compareClosedOhlcv(bar, { ...bar })).toBe('match');
  });

  test('any field difference is a mismatch', () => {
    expect(compareClosedOhlcv(bar, { ...bar, close: 1.500001 })).toBe('mismatch');
    expect(compareClosedOhlcv(bar, { ...bar, volume: 11 })).toBe('mismatch');
  });

  test('non-finite values are unknown', () => {
    expect(compareClosedOhlcv(bar, { ...bar, close: NaN })).toBe('unknown');
  });

  test('verify request carries series key and bar time', () => {
    expect(verifyRequestFor('binance|spot|BTC/USDT|1m', 123)).toEqual({
      seriesKey: 'binance|spot|BTC/USDT|1m',
      time: 123,
    });
  });
});