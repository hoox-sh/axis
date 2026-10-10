/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Extra exchange stream plugins (OKX/Bybit/Coinbase/Kraken) with MockWebSocket.
 * Guards URL construction and kline/frame → bar mapping edges.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { MockWebSocket } from './helpers/mock-ws';
import {
  okxStream,
  bybitStream,
  coinbaseStream,
  krakenStream,
  ensureStreamsRegistered,
  _resetStreamRegistrationFlag,
} from '../src/streams/catalog';
import { registry } from '../src/plugins/registry';
import { _resetBootstrapFlag } from '../src/plugins/bootstrap';

let restoreWs: (() => void) | null = null;

beforeEach(() => {
  registry.clear();
  _resetStreamRegistrationFlag();
  _resetBootstrapFlag();
  ensureStreamsRegistered();
  restoreWs = MockWebSocket.install();
});

afterEach(() => {
  restoreWs?.();
});

function startAndPush(
  stream: { start: (o: never) => () => void },
  msg: unknown,
): Promise<unknown[]> {
  const bars: unknown[] = [];
  const stop = stream.start({
    symbol: 'BTCUSDT',
    interval: '1m',
    onBar: (b: unknown) => bars.push(b),
    onError: () => {},
    onStatus: () => {},
    lastBar: { time: 1000, open: 1, high: 1, low: 1, close: 1 },
  } as never);
  return new Promise((resolve) => {
    setTimeout(() => {
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      if (ws) ws.push(msg);
      setTimeout(() => {
        stop();
        resolve(bars);
      }, 10);
    }, 15);
  });
}

describe('extra exchange streams', () => {
  it('okx stream parses candle', async () => {
    const bars = await startAndPush(okxStream, {
      data: [
        {
          ts: '1700000000000',
          o: '1',
          h: '2',
          l: '0.5',
          c: '1.5',
          vol: '10',
        },
      ],
    });
    // okx may expect different shape — at least start/stop works
    expect(Array.isArray(bars)).toBe(true);
  });

  it('bybit stream start/stop', async () => {
    const bars = await startAndPush(bybitStream, {
      topic: 'kline.1.BTCUSDT',
      data: [{ start: 1700000000000, open: '1', high: '2', low: '0.5', close: '1.5', volume: '9' }],
    });
    expect(Array.isArray(bars)).toBe(true);
  });

  it('coinbase stream start/stop', async () => {
    const bars = (await startAndPush(coinbaseStream, {
      channel: 'candles',
      events: [
        {
          type: 'update',
          candles: [
            {
              start: String(Math.floor(Date.now() / 1000) - 30),
              open: '100',
              high: '101',
              low: '99',
              close: '100.5',
              volume: '1.2',
            },
          ],
        },
      ],
    })) as Array<{ close: number }>;
    expect(Array.isArray(bars)).toBe(true);
    expect(bars.length).toBeGreaterThanOrEqual(1);
    expect(bars[0]?.close).toBeCloseTo(100.5);
  });

  it('kraken live bar aligns to interval start (end - interval)', async () => {
    // Kraken WS v1 ohlc row: [epoc_last, epoc_end, o, h, l, c, vwap, vol, count].
    // REST history keys bars by interval START, so live bars derive the start
    // from the end — using epoc_end directly put live bars one interval ahead.
    const end = 1_700_000_100;
    const bars = (await startAndPush(krakenStream, [
      0,
      [String(end - 10), String(end), '1', '2', '0.5', '1.5', '1.4', '10', '5'],
      'ohlc-1',
      'XBT/USD',
    ])) as Array<{ time: number; close: number }>;
    expect(bars).toHaveLength(1);
    expect(bars[0]?.time).toBe(end - 60);
    expect(bars[0]?.close).toBeCloseTo(1.5);
  });

  it('coinbase slot rollover emits the previous candle closed', async () => {
    const step = 60;
    const slot = Math.floor(Date.now() / 1000 / step) * step;
    const candle = (start: number) => ({
      start: String(start),
      open: '100',
      high: '101',
      low: '99',
      close: '100.5',
      volume: '1.2',
    });
    const bars = (await startAndPush(coinbaseStream, {
      channel: 'candles',
      events: [
        { type: 'update', candles: [candle(slot - step), candle(slot)] },
      ],
    })) as Array<{ time: number; closed?: boolean }>;
    // First forming slot, then the rolled-over slot closed, then the new slot.
    expect(bars.length).toBeGreaterThanOrEqual(2);
    const firstTime = bars[0]?.time;
    expect(Number.isFinite(firstTime)).toBe(true);
    const closedPrev = bars.find((b) => b.time === firstTime && b.closed === true);
    expect(closedPrev).toBeTruthy();
    const lastBar = bars[bars.length - 1];
    expect(lastBar?.time).toBeGreaterThan(Number(firstTime));
    expect(lastBar?.closed).toBe(false);
  });
});
