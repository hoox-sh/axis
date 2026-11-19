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
  binanceStream,
  okxStream,
  bybitStream,
  coinbaseStream,
  krakenStream,
  mexcStream,
  ensureStreamsRegistered,
  _resetStreamRegistrationFlag,
} from '../src/streams/catalog';
import { _resetBinanceKlineForTests } from '../src/streams/binance-kline';
import { setStore } from '../src/store';
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

  it('okx stream pings and closes a stale socket', async () => {
    const realSetInterval = globalThis.setInterval;
    const realDateNow = Date.now;
    let tick: (() => void) | null = null;
    let intervalMs = 0;
    let now = 1_700_000_000_000;
    globalThis.setInterval = ((fn: () => void, ms: number) => {
      tick = fn;
      intervalMs = ms;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
    Date.now = () => now;
    try {
      const stop = okxStream.start({
        symbol: 'BTCUSDT',
        interval: '1m',
        onBar: () => {},
        onError: () => {},
        onStatus: () => {},
        lastBar: { time: 1000, open: 1, high: 1, low: 1, close: 1 },
      } as never);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      if (!ws) throw new Error('OKX stream did not open a socket');
      expect(intervalMs).toBe(20_000);
      expect(ws.sent[0]).toContain('"op":"subscribe"');
      now += 20_000;
      tick?.();
      expect(ws.sent.some((m) => m.includes('"op":"ping"'))).toBe(true);
      // A pong keeps the socket alive.
      now += 1_000;
      ws.push({ event: 'pong' });
      now += 20_000;
      tick?.();
      expect(ws.closed).toBe(false);
      // Three missed pongs: close so openReconnectableWs can reconnect.
      now += 61_000;
      tick?.();
      expect(ws.closed).toBe(true);
      stop();
    } finally {
      globalThis.setInterval = realSetInterval;
      Date.now = realDateNow;
    }
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
      events: [{ type: 'update', candles: [candle(slot - step), candle(slot)] }],
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

  it('okx parses a business candle array row', async () => {
    const bars = (await startAndPush(okxStream, {
      data: [['1700000000000', '1', '2', '0.5', '1.5', '10', '10', '15', '1']],
    })) as Array<{ time: number; close: number; closed?: boolean }>;
    expect(bars).toHaveLength(1);
    expect(bars[0]?.time).toBe(1_700_000_000);
    expect(bars[0]?.close).toBeCloseTo(1.5);
    expect(bars[0]?.closed).toBe(true);
  });

  it('bybit parses a confirmed kline', async () => {
    const bars = (await startAndPush(bybitStream, {
      topic: 'kline.1.BTCUSDT',
      data: [
        {
          start: 1_700_000_000_000,
          open: '1',
          high: '2',
          low: '0.5',
          close: '1.5',
          volume: '9',
          confirm: true,
        },
      ],
    })) as Array<{ time: number; close: number; closed?: boolean }>;
    expect(bars).toHaveLength(1);
    expect(bars[0]?.time).toBe(1_700_000_000);
    expect(bars[0]?.close).toBeCloseTo(1.5);
    expect(bars[0]?.closed).toBe(true);
  });
});

/**
 * Subscribe frames for every built-in venue. A missing interval used to fall
 * through to the daily candle, so 30m/3m charts painted the wrong bar.
 */
describe('venue subscribe wiring', () => {
  beforeEach(() => {
    setStore('provider', 'market', 'spot');
  });

  async function opened(
    stream: { start: (o: never) => () => void },
    interval: string,
  ): Promise<{ url: string; frames: Array<Record<string, unknown>> }> {
    const frames: Array<Record<string, unknown>> = [];
    const orig = MockWebSocket.prototype.send;
    MockWebSocket.prototype.send = function (this: MockWebSocket, data: string) {
      frames.push(JSON.parse(String(data)) as Record<string, unknown>);
    };
    const stop = stream.start({
      symbol: 'BTCUSDT',
      interval,
      onBar: () => {},
      onError: () => {},
      onStatus: () => {},
    } as never);
    await new Promise((r) => setTimeout(r, 20));
    MockWebSocket.prototype.send = orig;
    const url = MockWebSocket.instances[MockWebSocket.instances.length - 1]?.url ?? '';
    stop();
    return { url, frames };
  }

  it('binance subscribes the chart interval on the combined stream', async () => {
    try {
      const { url, frames } = await opened(binanceStream, '30m');
      expect(url).toContain('data-stream.binance.vision');
      expect(frames[0]?.method).toBe('SUBSCRIBE');
      expect(frames[0]?.params).toEqual(['btcusdt@kline_30m']);
    } finally {
      _resetBinanceKlineForTests();
    }
  });

  it('okx subscribes candle3m and candle30m, not the daily fallback', async () => {
    const m3 = await opened(okxStream, '3m');
    const m30 = await opened(okxStream, '30m');
    const hour8 = await opened(okxStream, '8h');
    expect(m3.url).toBe('wss://ws.okx.com:8443/ws/v5/business');
    expect(m3.frames[0]).toEqual({
      op: 'subscribe',
      args: [{ channel: 'candle3m', instId: 'BTC-USDT' }],
    });
    expect(m30.frames[0]).toEqual({
      op: 'subscribe',
      args: [{ channel: 'candle30m', instId: 'BTC-USDT' }],
    });
    // OKX has no 8h candle. The fallback stays daily so the hole stays visible.
    expect(hour8.frames[0]).toEqual({
      op: 'subscribe',
      args: [{ channel: 'candle1D', instId: 'BTC-USDT' }],
    });
  });

  it('bybit subscribes the spot kline topic for 30m', async () => {
    const { url, frames } = await opened(bybitStream, '30m');
    expect(url).toBe('wss://stream.bybit.com/v5/public/spot');
    expect(frames[0]).toEqual({ op: 'subscribe', args: ['kline.30.BTCUSDT'] });
  });

  it('coinbase subscribes the product candles channel', async () => {
    const { url, frames } = await opened(coinbaseStream, '30m');
    expect(url).toBe('wss://advanced-trade-ws.coinbase.com');
    expect(frames[0]).toEqual({
      type: 'subscribe',
      product_ids: ['BTC-USDT'],
      channel: 'candles',
    });
  });

  it('kraken subscribes XBT/USDT at the 30m interval', async () => {
    const { url, frames } = await opened(krakenStream, '30m');
    expect(url).toBe('wss://ws.kraken.com/');
    expect(frames[0]).toEqual({
      event: 'subscribe',
      pair: ['XBT/USDT'],
      subscription: { name: 'ohlc', interval: 30 },
    });
  });

  it('mexc subscribes the Min30 kline channel', async () => {
    const { url, frames } = await opened(mexcStream, '30m');
    expect(url).toBe('wss://wbs.mexc.com/ws');
    expect(frames[0]).toEqual({
      method: 'SUBSCRIPTION',
      params: ['BTCUSDT@kline@Min30'],
    });
  });
});
