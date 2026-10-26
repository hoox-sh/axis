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

const {
  subscribeHistoryBars,
  scriptHistoryBars,
  streamVerifyClose,
  streamWireState,
  resetStreamWire,
  streamRouteActive,
  streamStop,
  verifyClosedBar,
  streamSeriesTick,
  streamEvalScript,
} = await import('../src/streams/stream-live');
const { setStore, store } = await import('../src/store');
const { reconcile } = await import('solid-js/store');
const { setEngineApiKey } = await import('../src/storage/vault');

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
  // The store is shared across test files in one process: pin the engine id
  // (the API key lives in that engine's config bag) and the chart identity.
  setStore('activePlugins', reconcile({ ...(store.activePlugins ?? {}), engine: 'server' }) as never);
  setStore('engine', 'server');
  setStore('symbol', 'BTCUSDT');
  setStore('interval', '1m');
  setStore('exchange', 'binance');
  setStore('bars', [bar(1000)]);
  setStore('rollingWindowBars', 10_000);
  setStore('endpoint', 'http://engine.test');
  setStore('pluginsConfig', reconcile({
    'engine:server': { endpoint: 'http://engine.test', apiKey: 'key-1' },
  }) as never);
  // The engine key is read from the secret vault first — put it there too so
  // the test does not depend on the legacy config bag.
  setEngineApiKey('server', 'key-1');
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

describe('scriptHistoryBars', () => {
  it('tracks the chart window, not a flickering bars.length', () => {
    setStore('rollingWindowBars', 5000);
    setStore('bars', [bar(1), bar(2), bar(3)]);
    expect(scriptHistoryBars()).toBe(5000);
    // A 1-bar trim/grow must not change the subscribe depth (live-wire used to
    // bounce scripts to idle/released on history_bars flicker).
    setStore('bars', Array.from({ length: 4999 }, (_, i) => bar(i + 1)));
    expect(scriptHistoryBars()).toBe(5000);
    setStore('bars', Array.from({ length: 5000 }, (_, i) => bar(i + 1)));
    expect(scriptHistoryBars()).toBe(5000);
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

  it('subscribes a script with its input values and the chart depth', async () => {
    // The engine evaluates the subscribed script with the values it was
    // subscribed with: without them the script's defaults are used and an
    // input change never reaches the chart.
    setStore('bars', [bar(1000), bar(2000), bar(3000)]);
    try {
      const evalPromise = streamEvalScript({
        id: 'ind-inputs',
        code: 'plot(close)',
        inputValues: { length: 20 },
      } as never);
      await until(() => ManualSocket.instances.length > 0);
      ManualSocket.instances[0]!.open();
      await until(() =>
        ManualSocket.instances[0]?.frames().some(
          (f) =>
            f.type === 'subscribe' &&
            (f.payload as { kind?: string } | undefined)?.kind === 'script',
        ),
      );
      const frame = ManualSocket.instances[0]!.frames().find(
        (f) =>
          f.type === 'subscribe' &&
          (f.payload as { kind?: string } | undefined)?.kind === 'script',
      );
      const payload = frame?.payload as
        | { inputs?: Record<string, unknown>; meta?: { history_bars?: number } }
        | undefined;
      expect(payload?.inputs).toEqual({ length: 20 });
      // Three painted bars must not freeze the script at that prefix — the
      // subscription covers the chart window the dataset will fill.
      expect(payload?.meta?.history_bars).toBe(10_000);
      const scriptSub = String(frame?.id ?? '');
      ManualSocket.instances[0]!.push({
        type: 'full',
        id: scriptSub,
        sessionId: 's3',
        seq: 1,
        payload: { seriesKey: scriptSub, count: 1, closed_upto: 1, plots: { plot_0: [1.5] } },
      });
      await evalPromise;
    } finally {
      setStore('bars', []);
    }
  });

  it('re-subscribes when the script inputs change', async () => {
    const first = streamEvalScript({
      id: 'ind-inputs-2',
      code: 'plot(close)',
      inputValues: { length: 20 },
    } as never);
    await until(() => ManualSocket.instances.length > 0);
    ManualSocket.instances[0]!.open();
    await until(() =>
      ManualSocket.instances[0]?.frames().some(
        (f) =>
          f.type === 'subscribe' &&
          (f.payload as { kind?: string } | undefined)?.kind === 'script',
      ),
    );
    const scriptSub = String(
      ManualSocket.instances[0]!.frames().find(
        (f) =>
          f.type === 'subscribe' &&
          (f.payload as { kind?: string } | undefined)?.kind === 'script',
      )?.id ?? '',
    );
    ManualSocket.instances[0]!.push({
      type: 'full',
      id: scriptSub,
      sessionId: 's4',
      seq: 1,
      payload: { seriesKey: scriptSub, count: 1, closed_upto: 1, plots: { plot_0: [1.5] } },
    });
    await first;

    const second = streamEvalScript({
      id: 'ind-inputs-2',
      code: 'plot(close)',
      inputValues: { length: 50 },
    } as never);
    await until(() =>
      ManualSocket.instances[0]!.frames().some(
        (f) =>
          f.type === 'subscribe' &&
          (f.payload as { kind?: string } | undefined)?.kind === 'script' &&
          (f.payload as { inputs?: Record<string, unknown> } | undefined)?.inputs?.length ===
            50,
      ),
    );
    const subs = ManualSocket.instances[0]!.frames().filter(
      (f) =>
        f.type === 'subscribe' &&
        (f.payload as { kind?: string } | undefined)?.kind === 'script',
    );
    expect(subs.length).toBeGreaterThanOrEqual(2);
    expect(
      ManualSocket.instances[0]!.frames().some((f) => f.type === 'unsubscribe'),
    ).toBe(true);
    const scriptSub2 = String(subs[subs.length - 1]!.id);
    ManualSocket.instances[0]!.push({
      type: 'full',
      id: scriptSub2,
      sessionId: 's5',
      seq: 1,
      payload: { seriesKey: scriptSub2, count: 1, closed_upto: 1, plots: { plot_0: [2.5] } },
    });
    await second;
  });

  it('re-subscribes when the chart window grows, and not when the depth is unchanged', async () => {
    setStore('rollingWindowBars', 3);
    setStore('bars', [bar(1000), bar(2000), bar(3000)]);
    const first = streamEvalScript({
      id: 'ind-depth',
      code: 'plot(close)',
      inputValues: { length: 20 },
    } as never);
    await until(() => ManualSocket.instances.length > 0);
    ManualSocket.instances[0]!.open();
    await until(() =>
      ManualSocket.instances[0]?.frames().some(
        (f) =>
          f.type === 'subscribe' &&
          (f.payload as { kind?: string } | undefined)?.kind === 'script',
      ),
    );
    const firstFrame = ManualSocket.instances[0]!.frames().find(
      (f) =>
        f.type === 'subscribe' &&
        (f.payload as { kind?: string } | undefined)?.kind === 'script',
    );
    expect(
      (firstFrame?.payload as { meta?: { history_bars?: number } } | undefined)?.meta?.history_bars,
    ).toBe(3);
    const scriptSub = String(firstFrame?.id ?? '');
    ManualSocket.instances[0]!.push({
      type: 'full',
      id: scriptSub,
      sessionId: 's-depth',
      seq: 1,
      payload: { seriesKey: scriptSub, count: 1, closed_upto: 1, plots: { plot_0: [1.5] } },
    });
    await first;

    setStore('rollingWindowBars', 50);
    const second = streamEvalScript({
      id: 'ind-depth',
      code: 'plot(close)',
      inputValues: { length: 20 },
    } as never);
    await until(() =>
      ManualSocket.instances[0]!.frames().filter(
        (f) =>
          f.type === 'subscribe' &&
          (f.payload as { kind?: string } | undefined)?.kind === 'script',
      ).length >= 2,
    );
    const subs = ManualSocket.instances[0]!.frames().filter(
      (f) =>
        f.type === 'subscribe' &&
        (f.payload as { kind?: string } | undefined)?.kind === 'script',
    );
    expect(
      (subs[subs.length - 1]?.payload as { meta?: { history_bars?: number } } | undefined)?.meta
        ?.history_bars,
    ).toBe(50);
    const scriptSub2 = String(subs[subs.length - 1]!.id);
    ManualSocket.instances[0]!.push({
      type: 'full',
      id: scriptSub2,
      sessionId: 's-depth-2',
      seq: 1,
      payload: { seriesKey: scriptSub2, count: 1, closed_upto: 1, plots: { plot_0: [2] } },
    });
    await second;

    const before = ManualSocket.instances[0]!.frames().length;
    const third = streamEvalScript({
      id: 'ind-depth',
      code: 'plot(close)',
      inputValues: { length: 20 },
    } as never);
    await third;
    const added = ManualSocket.instances[0]!.frames().slice(before);
    expect(added.some((f) => f.type === 'subscribe' || f.type === 'unsubscribe')).toBe(false);
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
