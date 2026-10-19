/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Engine-owned live plane: the socket wire, the series subscription and the
 * close verification tiers.
 *
 * The transport is faked at the **socket** level (a `WebSocket` stub), so the
 * real client, the real wire and the real stream-plane glue run — the frames
 * are driven by hand, exactly like the engine sends them.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { installChartHostMock } from './helpers/mock-chart-host';

installChartHostMock();

/** A socket whose lifecycle the test drives by hand. */
class ManualSocket {
  static instances: ManualSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  readyState = 0;
  sent: string[] = [];
  closeCalls = 0;

  constructor(public url: string) {
    ManualSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closeCalls += 1;
    this.readyState = 3;
    this.onclose?.();
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  push(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  /** Frames the client sent, decoded. */
  frames(): Array<Record<string, unknown>> {
    return this.sent
      .map((raw) => {
        try {
          return JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return {};
        }
      })
      .filter((f) => f && typeof f === 'object');
  }

  static install(): () => void {
    ManualSocket.instances = [];
    const prev = globalThis.WebSocket;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = ManualSocket;
    return () => {
      (globalThis as unknown as { WebSocket: unknown }).WebSocket = prev;
      ManualSocket.instances = [];
    };
  }
}

const { subscribeHistoryBars, streamVerifyClose, streamWireState, resetStreamWire, streamRouteActive, streamStop, verifyClosedBar, streamSeriesTick, streamEvalScript } =
  await import('../src/streams/stream-live');
const { setStore, store } = await import('../src/store');
const { reconcile } = await import('solid-js/store');

function bar(time: number, close = 1.5) {
  return { time, open: 1, high: 2, low: 0.5, close, volume: 10 } as never;
}

const OHLCV = { open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 };

let restoreSocket: (() => void) | null = null;

async function until(fn: () => boolean, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timed out waiting for condition');
}

beforeEach(() => {
  restoreSocket = ManualSocket.install();
  setStore('symbol', 'BTCUSDT');
  setStore('interval', '1m');
  setStore('exchange', 'binance');
  setStore('bars', [bar(1000)]);
  setStore('endpoint', 'http://engine.test');
  setStore('pluginsConfig', reconcile({
    'engine:server': { endpoint: 'http://engine.test', apiKey: 'key-1' },
  }) as never);
  resetStreamWire();
});

afterEach(() => {
  streamStop();
  restoreSocket?.();
  restoreSocket = null;
});

describe('subscribeHistoryBars', () => {
  it('caps the engine snapshot at 500 bars', () => {
    expect(subscribeHistoryBars(5000, 5000)).toBe(500);
    expect(subscribeHistoryBars(50, 5000)).toBe(50);
    expect(subscribeHistoryBars(10, 5000)).toBe(500);
  });

  it('never asks for more than the rolling window', () => {
    expect(subscribeHistoryBars(10, 120)).toBe(120);
    expect(subscribeHistoryBars(200, 120)).toBe(120);
  });

  it('falls back to the snapshot cap for an invalid rolling window', () => {
    expect(subscribeHistoryBars(10, 0)).toBe(500);
    expect(subscribeHistoryBars(10, Number.NaN)).toBe(500);
  });
});

describe('streamVerifyClose', () => {
  it('matches a closed bar against the local replica', () => {
    expect(streamVerifyClose(1000, { ...OHLCV })).toBe('match');
  });

  it('reports a mismatch when the engine copy differs', () => {
    expect(streamVerifyClose(1000, { ...OHLCV, close: 9 })).toBe('mismatch');
  });

  it('is unknown without a local bar', () => {
    expect(streamVerifyClose(4242, { ...OHLCV })).toBe('unknown');
  });
});

describe('verifyClosedBar', () => {
  it('verifies against the venue first', async () => {
    const calls: string[] = [];
    const out = await verifyClosedBar(
      { seriesKey: 'k', symbol: 'BTCUSDT', interval: '1m', time: 1000, engineOhlcv: { ...OHLCV } },
      {
        fetchKlines: async (opts) => {
          calls.push(opts.skipWorkerProxy ? 'venue' : 'proxy');
          return [[1000 * 1000, '1', '2', '0.5', '1.5', '10']];
        },
      },
    );
    expect(out).toEqual({ result: 'match', verified: 'venue' });
    expect(calls).toEqual(['venue']);
  });

  it('falls back to the Worker proxy when the venue fails', async () => {
    const calls: string[] = [];
    const out = await verifyClosedBar(
      { seriesKey: 'k', symbol: 'BTCUSDT', interval: '1m', time: 1000, engineOhlcv: { ...OHLCV } },
      {
        fetchKlines: async (opts) => {
          calls.push(opts.skipWorkerProxy ? 'venue' : 'proxy');
          if (opts.skipWorkerProxy) throw new Error('venue down');
          return { data: [[1000 * 1000, 1, 2, 0.5, 1.5, 10]] };
        },
      },
    );
    expect(out).toEqual({ result: 'match', verified: 'proxy' });
    expect(calls).toEqual(['venue', 'proxy']);
  });

  it('falls back to the engine copy when both network tiers fail', async () => {
    const out = await verifyClosedBar(
      { seriesKey: 'k', symbol: 'BTCUSDT', interval: '1m', time: 1000, engineOhlcv: { ...OHLCV } },
      { fetchKlines: async () => { throw new Error('offline'); } },
    );
    expect(out).toEqual({ result: 'match', verified: 'engine' });
  });

  it('ignores malformed venue rows', async () => {
    const out = await verifyClosedBar(
      { seriesKey: 'k', symbol: 'BTCUSDT', interval: '1m', time: 1000, engineOhlcv: { ...OHLCV } },
      { fetchKlines: async () => [[1, 2]] },
    );
    expect(out.verified).toBe('engine');
  });
});

describe('the engine socket wire', () => {
  it('subscribes the series and paints the snapshot', async () => {
    const tick = streamSeriesTick();
    await until(() => ManualSocket.instances.length > 0);
    const sock = ManualSocket.instances[0]!;
    sock.open();
    await until(() => sock.frames().some((f) => f.type === 'subscribe'));
    const subId = String(sock.frames().find((f) => f.type === 'subscribe')?.id ?? '');
    expect(subId.startsWith('series:')).toBe(true);
    sock.push({
      type: 'full',
      id: subId,
      sessionId: 's1',
      seq: 1,
      payload: {
        seriesKey: subId,
        count: 2,
        closed_upto: 2,
        bars: [bar(1000), bar(1060)],
      },
    });
    const ok = await tick;
    expect(typeof ok).toBe('boolean');
    expect(store.bars.length).toBe(2);
    expect(streamWireState()).not.toBeNull();
  });

  it('resets the wire and reports what it dropped', async () => {
    const tick = streamSeriesTick();
    await until(() => ManualSocket.instances.length > 0);
    ManualSocket.instances[0]!.open();
    await until(() => ManualSocket.instances[0]!.frames().some((f) => f.type === 'subscribe'));
    const subId = String(ManualSocket.instances[0]!.frames().find((f) => f.type === 'subscribe')?.id ?? '');
    ManualSocket.instances[0]!.push({
      type: 'full',
      id: subId,
      sessionId: 's1',
      seq: 1,
      payload: { seriesKey: subId, count: 1, closed_upto: 1, bars: [bar(1000)] },
    });
    await tick;
    const out = resetStreamWire();
    expect(out.hadWire).toBe(true);
    expect(streamWireState()).toBeNull();
  });

  it('rebuilds the wire when the engine endpoint changes', async () => {
    const tick = streamSeriesTick();
    await until(() => ManualSocket.instances.length > 0);
    ManualSocket.instances[0]!.open();
    await until(() => ManualSocket.instances[0]!.frames().some((f) => f.type === 'subscribe'));
    const subId = String(ManualSocket.instances[0]!.frames().find((f) => f.type === 'subscribe')?.id ?? '');
    ManualSocket.instances[0]!.push({
      type: 'full',
      id: subId,
      sessionId: 's1',
      seq: 1,
      payload: { seriesKey: subId, count: 1, closed_upto: 1, bars: [bar(1000)] },
    });
    await tick;
    setStore('endpoint', 'http://other.test');
    const second = streamSeriesTick();
    await until(() => ManualSocket.instances.length > 1);
    expect(ManualSocket.instances.length).toBe(2);
    ManualSocket.instances[1]!.open();
    second.catch(() => {});
  });

  it('evaluates a script over the same socket', async () => {
    const tick = streamSeriesTick();
    await until(() => ManualSocket.instances.length > 0);
    ManualSocket.instances[0]!.open();
    await until(() => ManualSocket.instances[0]!.frames().some((f) => f.type === 'subscribe'));
    const subId = String(ManualSocket.instances[0]!.frames().find((f) => f.type === 'subscribe')?.id ?? '');
    ManualSocket.instances[0]!.push({
      type: 'full',
      id: subId,
      sessionId: 's1',
      seq: 1,
      payload: { seriesKey: subId, count: 1, closed_upto: 1, bars: [bar(1000)] },
    });
    await tick;
    const evalPromise = streamEvalScript({ id: 'ind-1', code: 'plot(close)' } as never);
    await until(() =>
      ManualSocket.instances[0]!.frames().some(
        (f) => f.type === 'subscribe' && (f.payload as { kind?: string } | undefined)?.kind === 'script',
      ),
    );
    const scriptSub = String(
      ManualSocket.instances[0]!.frames().find(
        (f) => f.type === 'subscribe' && (f.payload as { kind?: string } | undefined)?.kind === 'script',
      )?.id ?? '',
    );
    ManualSocket.instances[0]!.push({
      type: 'full',
      id: scriptSub,
      sessionId: 's2',
      seq: 1,
      payload: { seriesKey: scriptSub, count: 1, closed_upto: 1, plots: { plot_0: [1.5] } },
    });
    await evalPromise;
  });
});

describe('stream wire helpers', () => {
  it('reports no wire before one is built', () => {
    expect(streamWireState()).toBeNull();
    expect(streamRouteActive()).toBe(false);
  });

  it('stops cleanly without a wire', () => {
    expect(() => streamStop()).not.toThrow();
    expect(streamWireState()).toBeNull();
  });
});
