/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import { verifyClosedBar } from '../../src/streams/stream-live';

const OHLCV = { open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 };
const ROW = [1700000000000, 1, 2, 0.5, 1.5, 10];

describe('redesign2 three-tier close verification (F-28)', () => {
  const input = {
    seriesKey: 'binance|spot|BTC/USDT|1m',
    symbol: 'BTCUSDT',
    interval: '1m',
    time: 1700000000,
    engineOhlcv: OHLCV,
  };

  test('venue tier wins when reachable', async () => {
    const out = await verifyClosedBar(input, {
      fetchKlines: async () => [ROW],
    });
    expect(out).toEqual({ result: 'match', verified: 'venue' });
  });

  test('venue mismatch reports mismatch at venue strength', async () => {
    const out = await verifyClosedBar(
      { ...input, engineOhlcv: { ...OHLCV, close: 99 } },
      { fetchKlines: async () => [ROW] },
    );
    expect(out).toEqual({ result: 'mismatch', verified: 'venue' });
  });

  test('falls back to proxy when direct fails', async () => {
    let calls = 0;
    const out = await verifyClosedBar(input, {
      fetchKlines: async (opts) => {
        calls += 1;
        if (opts.skipWorkerProxy) throw new Error('no direct route');
        return [ROW];
      },
    });
    expect(calls).toBe(2);
    expect(out).toEqual({ result: 'match', verified: 'proxy' });
  });

  test('falls back to engine copy when the venue is unreachable', async () => {
    const out = await verifyClosedBar(input, {
      fetchKlines: async () => {
        throw new Error('offline');
      },
    });
    expect(out.verified).toBe('engine');
  });
});
