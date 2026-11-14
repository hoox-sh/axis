/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Feed client primitives: key codec, seq tracking, delta merge, WS parsing.
 */

import './setup';
import { describe, expect, it } from 'bun:test';
import {
  applyFeedDelta,
  decodeFeedKey,
  encodeFeedKey,
  FeedSeqTracker,
  parseFeedMessage,
  type FeedDelta,
  type FeedSnapshot,
} from '../src/engine/feed-client';
import type { Bar } from '../src/store/types';

const FEED = 'binance|spot|BTC/USDT|1m|none|public';

function makeBar(time: number, close: number, closed?: boolean): Bar {
  return {
    time,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    volume: 10,
    ...(closed === undefined ? {} : { closed }),
  };
}

function makeDelta(overrides: Partial<FeedDelta> = {}): FeedDelta {
  return {
    feed: FEED,
    seq: 1,
    forming: true,
    upTo: 100,
    times: [100],
    open: [99],
    high: [101],
    low: [98],
    close: [100],
    volume: [10],
    ...overrides,
  };
}

describe('encodeFeedKey / decodeFeedKey', () => {
  it('round-trips canonical parts', () => {
    const parts = {
      venue: 'Binance',
      market: 'Spot',
      symbol: 'btc/usdt',
      interval: '1m',
      adjustment: 'none' as const,
      authScope: 'public',
    };
    const key = encodeFeedKey(parts);
    expect(key).toBe(FEED);
    expect(decodeFeedKey(key)).toEqual({
      venue: 'binance',
      market: 'spot',
      symbol: 'BTC/USDT',
      interval: '1m',
      adjustment: 'none',
      authScope: 'public',
    });
    const decoded = decodeFeedKey(key);
    expect(decoded).not.toBeNull();
    expect(encodeFeedKey(decoded!)).toBe(key);
  });

  it('round-trips an authenticated user scope', () => {
    const key = encodeFeedKey({
      venue: 'coinbase',
      market: 'spot',
      symbol: 'ETH/USD',
      interval: '4h',
      adjustment: 'split',
      authScope: 'user:abc123_HASH-9',
    });
    expect(key).toBe('coinbase|spot|ETH/USD|4h|split|user:abc123_HASH-9');
    expect(decodeFeedKey(key)?.authScope).toBe('user:abc123_HASH-9');
  });

  it('rejects malformed keys on decode', () => {
    expect(decodeFeedKey('binance|spot|BTC/USDT|..|none|public')).toBeNull();
    expect(decodeFeedKey('binance|spot|BTC/USDT|1m|none')).toBeNull();
    expect(decodeFeedKey('binance|spot|BTC/USDT|1m|none|public|extra')).toBeNull();
    expect(decodeFeedKey('Binance|spot|BTC/USDT|1m|none|public')).toBeNull(); // non-canonical venue
    expect(decodeFeedKey('binance|spot|btc/usdt|1m|none|public')).toBeNull(); // non-canonical symbol
    expect(decodeFeedKey('binance|spot|BTCUSDT|1m|none|public')).toBeNull(); // missing slash
    expect(decodeFeedKey('binance|spot|BTC/USDT|1m|bogus|public')).toBeNull(); // bad adjustment
    expect(decodeFeedKey('binance|spot|BTC/USDT|1m|none|user:')).toBeNull(); // empty user hash
    expect(decodeFeedKey('binance|spot|BTC/USDT|1m|none|user scope')).toBeNull(); // bad scope chars
    expect(decodeFeedKey('')).toBeNull();
  });

  it('throws on empty parts at encode time', () => {
    const base = {
      venue: 'binance',
      market: 'spot',
      symbol: 'BTC/USDT',
      interval: '1m',
      adjustment: 'none' as const,
      authScope: 'public',
    };
    expect(() => encodeFeedKey({ ...base, venue: '' })).toThrow();
    expect(() => encodeFeedKey({ ...base, market: '   ' })).toThrow();
    expect(() => encodeFeedKey({ ...base, symbol: '' })).toThrow();
    expect(() => encodeFeedKey({ ...base, interval: '' })).toThrow();
    expect(() => encodeFeedKey({ ...base, authScope: '' })).toThrow();
    expect(() => encodeFeedKey({ ...base, adjustment: '' as never })).toThrow();
    expect(() => encodeFeedKey({ ...base, adjustment: 'bogus' as never })).toThrow();
    expect(() => encodeFeedKey({ ...base, symbol: 'BTCUSDT' })).toThrow();
  });
});

describe('FeedSeqTracker', () => {
  it('accepts the first seq as ours and then requires lastSeq + 1', () => {
    const tracker = new FeedSeqTracker();
    expect(tracker.expected).toBe(0);
    expect(tracker.lastSeq).toBeNull();

    expect(tracker.push(41)).toBe('apply');
    expect(tracker.lastSeq).toBe(41);
    expect(tracker.expected).toBe(42);

    expect(tracker.push(42)).toBe('apply');
    expect(tracker.expected).toBe(43);
  });

  it('classifies duplicates and gaps without advancing state', () => {
    const tracker = new FeedSeqTracker();
    tracker.push(10);
    expect(tracker.push(10)).toBe('duplicate');
    expect(tracker.push(7)).toBe('duplicate');
    expect(tracker.expected).toBe(11);

    expect(tracker.push(12)).toBe('gap');
    expect(tracker.expected).toBe(11);
    expect(tracker.lastSeq).toBe(10);

    expect(tracker.push(11)).toBe('apply');
    expect(tracker.expected).toBe(12);
  });

  it('rejects non-integer or negative seqs as gaps', () => {
    const tracker = new FeedSeqTracker();
    expect(tracker.push(1.5)).toBe('gap');
    expect(tracker.push(-1)).toBe('gap');
    expect(tracker.expected).toBe(0);
  });

  it('reset clears tracking so the next push is accepted', () => {
    const tracker = new FeedSeqTracker();
    tracker.push(99);
    tracker.reset();
    expect(tracker.lastSeq).toBeNull();
    expect(tracker.expected).toBe(0);
    expect(tracker.push(1234)).toBe('apply');
    expect(tracker.lastSeq).toBe(1234);
  });
});

describe('applyFeedDelta', () => {
  it('appends new bars and marks the previous tip closed on roll-over', () => {
    const bars = [makeBar(100, 100, false)];
    const delta = makeDelta({
      times: [200],
      open: [101],
      high: [110],
      low: [100],
      close: [105],
      volume: [20],
    });
    const result = applyFeedDelta(bars, null, delta);
    expect(result).not.toBeNull();
    expect(result!.appended).toBe(1);
    expect(result!.replacedTip).toBe(false);
    expect(result!.bars).toHaveLength(2);
    expect(result!.bars[0]!.closed).toBe(true);
    expect(result!.bars[1]).toMatchObject({ time: 200, close: 105, closed: false });
    // Input untouched.
    expect(bars[0]!.closed).toBe(false);
  });

  it('overwrites a forming tip bar in place', () => {
    const bars = [makeBar(100, 100, false)];
    const delta = makeDelta({
      times: [100],
      open: [102],
      high: [103],
      low: [101],
      close: [102.5],
    });
    const result = applyFeedDelta(bars, null, delta);
    expect(result).not.toBeNull();
    expect(result!.appended).toBe(0);
    expect(result!.replacedTip).toBe(true);
    expect(result!.bars).toHaveLength(1);
    expect(result!.bars[0]).toMatchObject({ time: 100, close: 102.5, open: 102, closed: false });
  });

  it('applies a multi-point batch: overwrite then appends with roll-over closes', () => {
    const bars = [makeBar(100, 100, false)];
    const delta = makeDelta({
      times: [100, 200, 300],
      open: [100, 105, 110],
      high: [106, 111, 120],
      low: [99, 104, 109],
      close: [105, 110, 118],
      volume: [11, 12, 13],
      forming: false,
    });
    const result = applyFeedDelta(bars, null, delta);
    expect(result).not.toBeNull();
    expect(result!.appended).toBe(2);
    expect(result!.replacedTip).toBe(true);
    expect(result!.bars.map((b) => b.time)).toEqual([100, 200, 300]);
    // 100 was overwritten then closed by the 200 roll-over; forming=false => tip closed too.
    expect(result!.bars.map((b) => b.closed)).toEqual([true, true, true]);
    expect(result!.bars[0]!.close).toBe(105);
  });

  it('keeps the tip open while the venue says forming', () => {
    const bars: Bar[] = [];
    const result = applyFeedDelta(bars, null, makeDelta({ forming: true }));
    expect(result).not.toBeNull();
    expect(result!.bars).toHaveLength(1);
    expect(result!.bars[0]!.closed).toBe(false);
  });

  it('rejects deltas whose first point is older than the last bar', () => {
    const bars = [makeBar(200, 100, true)];
    const delta = makeDelta({ times: [100] });
    expect(applyFeedDelta(bars, null, delta)).toBeNull();
  });

  it('rejects an equal-time update against an already-closed tip bar', () => {
    const bars = [makeBar(100, 100, true)];
    const delta = makeDelta({ times: [100] });
    expect(applyFeedDelta(bars, null, delta)).toBeNull();
  });

  it('rejects non-increasing times inside the delta', () => {
    const bars = [makeBar(100, 100, false)];
    const delta = makeDelta({
      times: [100, 100],
      open: [1, 2],
      high: [1, 2],
      low: [1, 2],
      close: [1, 2],
      volume: [1, 2],
    });
    expect(applyFeedDelta(bars, null, delta)).toBeNull();
  });

  it('rejects mismatched snapshot feed', () => {
    const bars = [makeBar(100, 100, false)];
    const snapshot: FeedSnapshot = {
      feed: 'coinbase|spot|BTC/USD|1m|none|public',
      seq: 1,
      from: 100,
      to: 100,
      bars,
    };
    expect(applyFeedDelta(bars, snapshot, makeDelta())).toBeNull();
    expect(applyFeedDelta(bars, { ...snapshot, feed: FEED }, makeDelta())).not.toBeNull();
  });

  it('seeds an empty bar array from a delta', () => {
    const result = applyFeedDelta(
      [],
      null,
      makeDelta({
        times: [100, 200],
        open: [1, 2],
        high: [1, 2],
        low: [1, 2],
        close: [1, 2],
        volume: [1, 2],
        forming: false,
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.bars.map((b) => b.time)).toEqual([100, 200]);
    expect(result!.appended).toBe(2);
  });
});

describe('parseFeedMessage', () => {
  const validDeltaRaw = {
    kind: 'delta',
    feed: FEED,
    seq: 7,
    forming: true,
    upTo: 100,
    times: [100],
    open: [99],
    high: [101],
    low: [98],
    close: [100],
    volume: [10],
  };

  it('accepts a valid delta', () => {
    const parsed = parseFeedMessage(validDeltaRaw);
    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe('delta');
    if (parsed!.kind === 'delta') {
      expect(parsed!.delta).toEqual({
        feed: FEED,
        seq: 7,
        forming: true,
        upTo: 100,
        times: [100],
        open: [99],
        high: [101],
        low: [98],
        close: [100],
        volume: [10],
      });
    }
  });

  it('accepts a valid snapshot', () => {
    const parsed = parseFeedMessage({
      kind: 'snapshot',
      feed: FEED,
      seq: 3,
      from: 100,
      to: 200,
      bars: [
        { time: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, closed: true },
        { time: 200, open: 1.5, high: 2.5, low: 1, close: 2, volume: 12 },
      ],
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.kind).toBe('snapshot');
    if (parsed!.kind === 'snapshot') {
      expect(parsed!.snapshot.bars).toHaveLength(2);
      expect(parsed!.snapshot.bars[0]!.closed).toBe(true);
      expect(parsed!.snapshot.bars[1]!.volume).toBe(12);
    }
  });

  it('rejects truncated or garbage input', () => {
    expect(parseFeedMessage(null)).toBeNull();
    expect(parseFeedMessage('nope')).toBeNull();
    expect(parseFeedMessage([1, 2, 3])).toBeNull();
    expect(parseFeedMessage({ kind: 'delta' })).toBeNull();
    expect(parseFeedMessage({ ...validDeltaRaw, volume: undefined })).toBeNull();
    expect(
      parseFeedMessage({
        ...validDeltaRaw,
        times: [100, 90],
        open: [1, 2],
        high: [1, 2],
        low: [1, 2],
        close: [1, 2],
        volume: [1, 2],
      }),
    ).toBeNull(); // not increasing
    expect(parseFeedMessage({ ...validDeltaRaw, seq: 1.5 })).toBeNull();
    expect(parseFeedMessage({ ...validDeltaRaw, seq: -1 })).toBeNull();
    expect(parseFeedMessage({ ...validDeltaRaw, high: [1, 2] })).toBeNull(); // length mismatch
    expect(parseFeedMessage({ ...validDeltaRaw, close: [Number.NaN] })).toBeNull();
    expect(parseFeedMessage({ ...validDeltaRaw, forming: 'yes' })).toBeNull();
    expect(parseFeedMessage({ ...validDeltaRaw, feed: '' })).toBeNull();
    expect(parseFeedMessage({ ...validDeltaRaw, times: [] })).toBeNull();
    expect(parseFeedMessage({ kind: 'mystery', feed: FEED })).toBeNull();
  });

  it('rejects snapshots with bad bars or ranges', () => {
    const base = { kind: 'snapshot', feed: FEED, seq: 1, from: 100, to: 200 };
    expect(
      parseFeedMessage({ ...base, bars: [{ time: 100, open: 1, high: 2, low: 1, close: 1.5 }] }),
    ).not.toBeNull();
    expect(parseFeedMessage({ ...base, to: 50 })).toBeNull(); // to < from
    expect(
      parseFeedMessage({ ...base, bars: [{ time: 100, open: 1, high: 2, low: 1 }] }),
    ).toBeNull(); // missing close
    expect(
      parseFeedMessage({
        ...base,
        bars: [
          { time: 200, open: 1, high: 2, low: 1, close: 1.5 },
          { time: 100, open: 1, high: 2, low: 1, close: 1.5 },
        ],
      }),
    ).toBeNull(); // times not increasing
    expect(
      parseFeedMessage({
        ...base,
        bars: [{ time: 100, open: 1, high: 2, low: 1, close: 1.5, volume: 'lots' }],
      }),
    ).toBeNull();
  });
});
