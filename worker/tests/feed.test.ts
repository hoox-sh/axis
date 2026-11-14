/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import {
  INTERVAL_TO_MS,
  binanceInterval,
  feedKeyToBinanceSymbol,
  feedKeyToString,
  parseFeedKey,
} from '../src/feed/feed-key';
import {
  barsFromKlines,
  buildDeltaFrame,
  buildSnapshotFrame,
  type FeedBar,
} from '../src/feed/frames';

const VALID = 'mexc|spot|BTC/USDT|1m|none|public';

describe('parseFeedKey', () => {
  it('accepts the canonical slash form', () => {
    const key = parseFeedKey(VALID);
    expect(key).toEqual({
      venue: 'mexc',
      market: 'spot',
      symbol: 'BTC/USDT',
      interval: '1m',
      adjustment: 'none',
      authScope: 'public',
    });
  });

  it('accepts compact symbol form and normalises to pair form', () => {
    const key = parseFeedKey('mexc|spot|BTCUSDT|1m|none|public');
    expect(key?.symbol).toBe('BTC/USDT');
    expect(feedKeyToString(key!)).toBe(VALID);
  });

  it('normalises mixed compact quotes (ETHBTC → ETH/BTC)', () => {
    const key = parseFeedKey('mexc|spot|ETHBTC|4h|none|public');
    expect(key?.symbol).toBe('ETH/BTC');
  });

  it('rejects unsupported venues and non-spot markets', () => {
    expect(parseFeedKey('okx|spot|BTC/USDT|1m|none|public')).toBeNull();
    expect(parseFeedKey('binance|spot|BTC/USDT|1m|none|public')).toBeNull();
    expect(parseFeedKey('bybit|spot|BTC/USDT|1m|none|public')).not.toBeNull();
    expect(parseFeedKey('mexc|spot|BTC/USDT|1m|none|public')).not.toBeNull();
    expect(parseFeedKey('binance|linear|BTC/USDT|1m|none|public')).toBeNull();
    expect(parseFeedKey('binance|usdm|BTC/USDT|1m|none|public')).toBeNull();
  });

  it('rejects wrong adjustment and non-public scope', () => {
    expect(parseFeedKey('mexc|spot|BTC/USDT|1m|split|public')).toBeNull();
    expect(parseFeedKey('mexc|spot|BTC/USDT|1m|none|user:abc')).toBeNull();
    expect(parseFeedKey('mexc|spot|BTC/USDT|1m|none|Public')).toBeNull();
    expect(parseFeedKey('mexc|spot|BTC/USDT|1m|none|')).toBeNull();
  });

  it('rejects intervals outside the whitelist', () => {
    for (const bad of ['1s', '1x', '7m', '1M', '1mo', '60m', '', '1mm']) {
      expect(parseFeedKey(`mexc|spot|BTC/USDT|${bad}|none|public`)).toBeNull();
    }
    for (const good of Object.keys(INTERVAL_TO_MS)) {
      expect(parseFeedKey(`mexc|spot|BTC/USDT|${good}|none|public`)).not.toBeNull();
    }
  });

  it('rejects traversal, whitespace, and wrong casing', () => {
    expect(parseFeedKey('..|spot|BTC/USDT|1m|none|public')).toBeNull();
    expect(parseFeedKey('mexc|spot|BTC/../USDT|1m|none|public')).toBeNull();
    expect(parseFeedKey(' mexc|spot|BTC/USDT|1m|none|public')).toBeNull();
    expect(parseFeedKey('mexc|spot|BTC/USDT|1m|none|public ')).toBeNull();
    expect(parseFeedKey('Binance|spot|BTC/USDT|1m|none|public')).toBeNull();
    expect(parseFeedKey('mexc|spot|btc/usdt|1m|none|public')).toBeNull();
  });

  it('rejects malformed keys and bad segment counts', () => {
    expect(parseFeedKey('')).toBeNull();
    expect(parseFeedKey('mexc|spot|BTC/USDT|1m|none')).toBeNull();
    expect(parseFeedKey('mexc|spot|BTC/USDT|1m|none|public|extra')).toBeNull();
    expect(parseFeedKey('mexc|spot|BTC//USDT|1m|none|public')).toBeNull();
    expect(parseFeedKey('mexc|spot|BTC/USDT-1|1m|none|public')).toBeNull();
    expect(parseFeedKey('mexc|spot|ZZZ9ZZZ9|1m|none|public')).toBeNull(); // no known quote suffix
  });

  it('maps pair form back to the Binance wire symbol', () => {
    const key = parseFeedKey(VALID);
    expect(key).not.toBeNull();
    expect(feedKeyToBinanceSymbol(key!)).toBe('BTCUSDT');
  });

  it('binanceInterval is a passthrough', () => {
    expect(binanceInterval('3m')).toBe('3m');
    expect(binanceInterval('1w')).toBe('1w');
  });
});

const bar = (time: number, closed: boolean): FeedBar => ({
  time,
  open: 100 + time,
  high: 110 + time,
  low: 90 + time,
  close: 105 + time,
  volume: 12.5,
  closed,
});

describe('buildSnapshotFrame', () => {
  it('emits the wire shape with seq, from/to and closed flags', () => {
    const bars = [bar(1000, true), bar(1060, true), bar(1120, false)];
    const frame = JSON.parse(buildSnapshotFrame(VALID, 7, bars));
    expect(frame.kind).toBe('snapshot');
    expect(frame.feed).toBe(VALID);
    expect(frame.seq).toBe(7);
    expect(frame.from).toBe(1000);
    expect(frame.to).toBe(1120);
    expect(frame.bars).toHaveLength(3);
    expect(frame.bars[2].closed).toBe(false);
    expect(frame.bars[0].closed).toBe(true);
  });

  it('rejects empty bars, bad seq, and non-finite values', () => {
    expect(() => buildSnapshotFrame(VALID, 1, [])).toThrow();
    expect(() => buildSnapshotFrame(VALID, 0, [bar(1, true)])).toThrow();
    expect(() => buildSnapshotFrame(VALID, 1.5, [bar(1, true)])).toThrow();
    expect(() => buildSnapshotFrame(VALID, 1, [{ ...bar(1, true), close: Number.NaN }])).toThrow();
  });
});

describe('buildDeltaFrame', () => {
  it('emits the delta wire shape', () => {
    const frame = JSON.parse(
      buildDeltaFrame(VALID, 42, true, 1120, {
        times: [1120],
        open: [1],
        high: [2],
        low: [0.5],
        close: [1.5],
        volume: [99],
      }),
    );
    expect(frame).toEqual({
      kind: 'delta',
      feed: VALID,
      seq: 42,
      forming: true,
      upTo: 1120,
      times: [1120],
      open: [1],
      high: [2],
      low: [0.5],
      close: [1.5],
      volume: [99],
    });
  });

  it('rejects mismatched array lengths and bad seq', () => {
    const base = { times: [1], open: [1], high: [1], low: [1], close: [1], volume: [1] };
    expect(() => buildDeltaFrame(VALID, 1, false, 1, { ...base, volume: [1, 2] })).toThrow();
    expect(() => buildDeltaFrame(VALID, 0, false, 1, base)).toThrow();
  });
});

describe('barsFromKlines', () => {
  const now = 10_000_000_000;
  const intervalMs = 60_000;
  const row = (openTime: number, closeTime: number) => [
    openTime,
    '100.5',
    '110.25',
    '99.5',
    '105.75',
    '1234.5',
    closeTime,
    '0',
    10,
    '0',
    '0',
    '0',
  ];

  it('parses 20 klines into ordered bars with second timestamps', () => {
    const rows = Array.from({ length: 20 }, (_, i) => {
      const open = now - (20 - i) * intervalMs;
      return row(open, open + intervalMs - 1);
    });
    const bars = barsFromKlines(rows, intervalMs, now);
    expect(bars).toHaveLength(20);
    expect(bars[0]?.time).toBe(Math.floor((now - 20 * intervalMs) / 1000));
    expect(bars[0]?.open).toBe(100.5);
    expect(bars[0]?.close).toBe(105.75);
    expect(bars.every((b) => b.closed)).toBe(true);
    for (let i = 1; i < bars.length; i += 1) {
      expect(bars[i]!.time).toBeGreaterThan(bars[i - 1]!.time);
    }
  });

  it('marks the in-progress kline as not closed', () => {
    const open = now - 30_000;
    const bars = barsFromKlines([row(open, open + intervalMs - 1)], intervalMs, now);
    expect(bars).toHaveLength(1);
    expect(bars[0]?.closed).toBe(false);
  });

  it('skips malformed rows', () => {
    const good = row(now - intervalMs, now - 1);
    const rows: unknown[] = [
      good,
      ['not', 'a', 'kline'],
      [Number.NaN, '1', '2', '3', '4', '5', now],
      [now - 2 * intervalMs, 'x', '2', '3', '4', '5', now],
      'garbage',
      null,
    ];
    const bars = barsFromKlines(rows, intervalMs, now);
    expect(bars).toHaveLength(1);
    expect(bars[0]?.time).toBe(Math.floor((now - intervalMs) / 1000));
  });

  it('returns [] for non-array input', () => {
    expect(barsFromKlines(null, 60_000, now)).toEqual([]);
    expect(barsFromKlines({ code: -1121 }, 60_000, now)).toEqual([]);
  });
});
