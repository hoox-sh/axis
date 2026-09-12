/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Coverage for `src/streams/catalog.ts` gaps:
 * okx array-candle mapping, coinbase USD product branch, full mexc lifecycle,
 * ccxt-ws gateway flows, and dynamic stream registry helpers.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { MockWebSocket } from './helpers/mock-ws';
import type { Bar } from '../src/store/types';
import {
  okxStream,
  coinbaseStream,
  mexcStream,
  ccxtWsStream,
  registerDynamicStream,
  unregisterDynamicStream,
  listDynamicStreamIds,
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
  restoreWs = null;
});

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function safeParse(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function startOkxWith(symbol: string, interval: string, msg: unknown): Promise<Bar[]> {
  const bars: Bar[] = [];
  const stop = okxStream.start({
    symbol,
    interval,
    onBar: (b) => bars.push(b),
    onError: () => {},
    onStatus: () => {},
  });
  await wait(20);
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  ws?.push(msg as never);
  await wait(10);
  stop();
  return bars;
}

describe('catalog coverage: okx array candles (262-271)', () => {
  it('parses array candle with string confirm 1 as closed', async () => {
    const bars = await startOkxWith('BTCUSDT', '1m', {
      data: [['1700000000000', '1', '2', '0.5', '1.5', '10', '0', '0', '1']],
    });
    expect(bars).toHaveLength(1);
    expect(bars[0]?.time).toBe(1700000000);
    expect(bars[0]?.close).toBe(1.5);
    expect(bars[0]?.closed).toBe(true);
  });

  it('parses numeric and boolean confirms', async () => {
    const n1 = await startOkxWith('BTCUSDT', '1m', {
      data: [['1700000000000', '1', '2', '0.5', '1.5', '10', '0', '0', 1]],
    });
    expect(n1[0]?.closed).toBe(true);
    const b1 = await startOkxWith('BTCUSDT', '1m', {
      data: [['1700000000000', '1', '2', '0.5', '1.5', '10', '0', '0', true]],
    });
    expect(b1[0]?.closed).toBe(true);
    const open = await startOkxWith('BTCUSDT', '1m', {
      data: [['1700000000000', '1', '2', '0.5', '1.5', '10', '0', '0', '0']],
    });
    expect(open[0]?.closed).toBe(false);
  });

  it('ignores non-array rows and malformed json', async () => {
    const bars: Bar[] = [];
    const stop = okxStream.start({
      symbol: 'BTCUSDT',
      interval: '1m',
      onBar: (b) => bars.push(b),
      onError: () => {},
      onStatus: () => {},
    });
    await wait(20);
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    ws.push({ data: [{ ts: 'x' }] });
    ws.push({ nodata: true });
    ws.push('not-json{{{');
    await wait(10);
    expect(bars).toHaveLength(0);
    stop();
  });
});

describe('catalog coverage: coinbase product branch (393)', () => {
  async function startCoinbase(symbol: string): Promise<{ bars: Bar[]; sent: string[]; stop: () => void }> {
    const bars: Bar[] = [];
    const sent: string[] = [];
    const origSend = MockWebSocket.prototype.send;
    MockWebSocket.prototype.send = function (d: string) {
      sent.push(String(d));
    };
    const stop = coinbaseStream.start({
      symbol,
      interval: '1m',
      onBar: (b) => bars.push(b),
      onError: () => {},
      onStatus: () => {},
      lastBar: null,
    });
    await wait(20);
    MockWebSocket.prototype.send = origSend;
    return { bars, sent, stop };
  }

  it('maps XXXUSD to XXX-USD', async () => {
    const { sent, stop } = await startCoinbase('BTCUSD');
    const sub = sent.map(safeParse).find((p) => p?.['product_ids']);
    expect(sub?.['product_ids']).toEqual(['BTC-USD']);
    stop();
  });

  it('maps bare symbols to XXX-USD fallback', async () => {
    const { sent, stop } = await startCoinbase('ETH');
    const sub = sent.map(safeParse).find((p) => p?.['product_ids']);
    expect(sub?.['product_ids']).toEqual(['ETH-USD']);
    stop();
  });

  it('still folds candles for USD product', async () => {
    const bars: Bar[] = [];
    const stop = coinbaseStream.start({
      symbol: 'BTCUSD',
      interval: '1m',
      onBar: (b) => bars.push(b),
      onError: () => {},
      onStatus: () => {},
      lastBar: null,
    });
    await wait(20);
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    ws.push({
      events: [{ candles: [{ start: String(Math.floor(Date.now() / 1000) - 10), open: '10', high: '11', low: '9', close: '10.5', volume: '2' }] }],
    });
    await wait(10);
    expect(bars.length).toBeGreaterThanOrEqual(1);
    stop();
  });
});

describe('catalog coverage: mexc lifecycle (541-596)', () => {
  it('subscribes, parses d.k and k shapes, handles edges, pings, and stops', async () => {
    const bars: Bar[] = [];
    const statuses: string[] = [];
    const sent: string[] = [];
    const origSend = MockWebSocket.prototype.send;
    MockWebSocket.prototype.send = function (d: string) {
      sent.push(String(d));
    };

    const origSetInterval = globalThis.setInterval;
    const origClearInterval = globalThis.clearInterval;
    const pingFns: Array<() => void> = [];
    const cleared: unknown[] = [];
    (globalThis as unknown as { setInterval: unknown }).setInterval = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
      if (ms === 15_000) {
        pingFns.push(fn as () => void);
        return 987001 as unknown as ReturnType<typeof setInterval>;
      }
      return (origSetInterval as (...a: unknown[]) => unknown)(fn, ms, ...rest) as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
    (globalThis as unknown as { clearInterval: unknown }).clearInterval = ((id?: unknown) => {
      cleared.push(id);
      if (typeof id === 'number' && id >= 987000) return;
      return (origClearInterval as (id?: unknown) => void)(id);
    }) as typeof clearInterval;

    try {
      const stop = mexcStream.start({
        symbol: 'BTCUSDT',
        interval: '1m',
        onBar: (b) => bars.push(b),
        onError: () => {},
        onStatus: (s) => statuses.push(s.state),
      });
      await wait(25);
      expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(1);
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;

      // SUBSCRIPTION sent with expected channel
      const subs = sent.map(safeParse);
      const sub = subs.find((p) => p?.['method'] === 'SUBSCRIPTION');
      expect(sub?.['params']).toEqual(['BTCUSDT@kline@Min1']);
      expect(pingFns).toHaveLength(1);

      // Second open clears prior ping (covers `if (ping) clearInterval`)
      ws.onopen?.();
      expect(cleared.length).toBeGreaterThanOrEqual(1);
      expect(pingFns).toHaveLength(2);

      // PING path + PING catch when send throws
      pingFns[0]?.();
      expect(sent.some((s) => s.includes('PING'))).toBe(true);
      MockWebSocket.prototype.send = function () {
        throw new Error('closed');
      };
      pingFns[1]?.();
      MockWebSocket.prototype.send = function (d: string) {
        sent.push(String(d));
      };

      // Valid d.k
      ws.push({ d: { k: { t: 1700000000000, o: '1', h: '2', l: '0.5', c: '1.5', v: '10' } } });
      // Valid top-level k
      ws.push({ k: { t: 1700000060000, o: '1.5', h: '2.5', l: '1', c: '2', v: '5' } });
      // Volume non-finite falls back to 0 but still emits
      ws.push({ k: { t: 1700000120000, o: '2', h: '3', l: '1.5', c: '2.5', v: 'bad' } });
      await wait(10);
      expect(bars.length).toBeGreaterThanOrEqual(3);
      expect(bars[bars.length - 1]?.volume).toBe(0);

      const before = bars.length;
      // Edges: missing k, bad t, bad ohlc, malformed
      ws.push({ foo: 1 });
      ws.push({ k: { t: 0, o: '1', h: '2', l: '0.5', c: '1.5', v: '1' } });
      ws.push({ k: { t: 'bad', o: '1', h: '2', l: '0.5', c: '1.5', v: '1' } });
      ws.push({ k: { t: 1700000000000, o: 'bad', h: '2', l: '0.5', c: '1.5', v: '1' } });
      ws.push('not-json{{{');
      await wait(10);
      expect(bars).toHaveLength(before);

      stop();
      // Double stop covers ping-undefined path and idempotent stopWs
      stop();
      expect(statuses).toContain('open');
    } finally {
      MockWebSocket.prototype.send = origSend;
      (globalThis as unknown as { setInterval: unknown }).setInterval = origSetInterval;
      (globalThis as unknown as { clearInterval: unknown }).clearInterval = origClearInterval;
    }
  });
});

describe('catalog coverage: ccxt-ws (629-672)', () => {
  it('errors when exchange is not configured', () => {
    const errors: Error[] = [];
    const stop = ccxtWsStream.start({
      symbol: 'BTCUSDT',
      interval: '1m',
      config: {},
      onBar: () => {},
      onError: (e) => errors.push(e),
      onStatus: () => {},
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/exchange id not configured/);
    expect(() => stop()).not.toThrow();
  });

  it('happy path maps frames, tolerates malformed, and fires status/error', async () => {
    MockWebSocket.instances = [];
    const bars: Bar[] = [];
    const statuses: string[] = [];
    const errors: Error[] = [];
    const stop = ccxtWsStream.start({
      symbol: 'BTCUSDT',
      interval: '1m',
      config: { exchange: 'binance', gateway: 'auto' },
      onBar: (b) => bars.push(b),
      onError: (e) => errors.push(e),
      onStatus: (s) => statuses.push(s.state),
    });
    await wait(40);
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(1);
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    expect(ws.url).toContain('exchange=binance');
    expect(ws.url).toContain('symbol=BTCUSDT');
    expect(ws.url).toContain('timeframe=1m');
    expect(statuses).toContain('open');

    ws.push({ time: 1700000000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, closed: true });
    await wait(10);
    expect(bars).toHaveLength(1);
    expect(bars[0]?.close).toBe(1.5);

    ws.push('not-json{{{');
    await wait(10);
    expect(bars).toHaveLength(1);

    (ws as unknown as { onerror: ((ev: unknown) => void) | null }).onerror?.({ type: 'error' });
    expect(errors.length).toBeGreaterThanOrEqual(1);

    ws.close();
    await wait(5);
    expect(statuses).toContain('closed');

    // close-throw path in stop()
    (ws as unknown as { close: () => void }).close = () => {
      throw new Error('close boom');
    };
    expect(() => stop()).not.toThrow();
  });

  it('gateway throw routes to onError catch', async () => {
    const errors: Error[] = [];
    const stop = ccxtWsStream.start({
      symbol: 'BTCUSDT',
      interval: '1m',
      config: { exchange: 'binance', gateway: 'direct' },
      onBar: () => {},
      onError: (e) => errors.push(e),
      onStatus: () => {},
    });
    await wait(40);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    stop();
  });

  it('stop before async resolve prevents socket creation', async () => {
    MockWebSocket.instances = [];
    const errors: Error[] = [];
    const stop = ccxtWsStream.start({
      symbol: 'BTCUSDT',
      interval: '1m',
      config: { exchange: 'binance', gateway: 'auto' },
      onBar: () => {},
      onError: (e) => errors.push(e),
      onStatus: () => {},
    });
    stop();
    await wait(40);
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});

describe('catalog coverage: dynamic registry (728-737)', () => {
  it('unregister and list dynamic ids', () => {
    registerDynamicStream({ id: 'dyn-a', name: 'A', kind: 'stream', start: () => () => {} });
    registerDynamicStream({ id: 'dyn-b', name: 'B', kind: 'stream', start: () => () => {} });
    let ids = listDynamicStreamIds();
    expect(ids).toContain('dyn-a');
    expect(ids).toContain('dyn-b');
    expect(ids).not.toContain('binance-ws');

    expect(unregisterDynamicStream('dyn-a')).toBe(true);
    ids = listDynamicStreamIds();
    expect(ids).not.toContain('dyn-a');
    expect(ids).toContain('dyn-b');

    expect(unregisterDynamicStream('missing-id')).toBe(false);
  });

  it('registerDynamicStream rejects invalid plugins', () => {
    expect(() => registerDynamicStream({ id: '', name: 'x', kind: 'stream', start: () => () => {} })).toThrow();
  });
});
