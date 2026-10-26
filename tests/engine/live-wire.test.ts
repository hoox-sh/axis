/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { HIDDEN_WAKE_MS, StreamFallbackError, StreamLiveWire, type WireClient, type WireFrame, type WireHandlers } from '../../src/engine/live-wire';
import type { RunResult } from '../../src/plugins/types';
import type { Bar } from '../../src/store/types';
import { _resetV1Metrics, v1Mark, v1MetricsSnapshot } from '../../src/engine/v1/metrics';
import { setStore, store } from '../../src/store';
import { resetEngineTransport, setEngineTransport } from '../../src/engine/v1/transport';

function makeHarness(opts?: { delayDelta?: boolean; syncApply?: boolean }) {
  const sent: Array<{ kind: string; id: string; opts?: Record<string, unknown> }> = [];
  const statuses: Array<{ sub: string; status: string }> = [];
  const unsubscribed: string[] = [];
  const seriesFull: Bar[][] = [];
  const seriesDelta: Array<{ bars: Bar[]; append: boolean }> = [];
  const closes: Array<{ time: number; ohlcv?: Record<string, number> }> = [];
  const resumes: Array<{ id: string; count: number; lastTime: number; extra?: Record<string, unknown> }> = [];
  const counters = { disconnects: 0, connects: 0, reconnects: 0 };
  let open = true;
  let stopped = false;
  let reconnect: (() => void) | undefined;
  const client: WireClient = {
    get isOpen() {
      return open;
    },
    onFrame: undefined,
    onFrames: undefined,
    async connect() {
      stopped = false;
      counters.connects += 1;
      open = true;
    },
    disconnect() {
      stopped = true;
      open = false;
      counters.disconnects += 1;
    },
    subscribe(id, kind, _meta, opts) {
      sent.push({ kind: `subscribe:${kind}`, id, opts });
    },
    resumeSubscription(id, count, lastTime, extra) {
      resumes.push({ id, count, lastTime, extra });
    },
    unsubscribe(id) {
      unsubscribed.push(id);
    },
    awaitFrame() {
      return new Promise(() => {});
    },
    addReconnectHandler(fn) {
      reconnect = fn;
      return () => {
        reconnect = undefined;
      };
    },
    stats() {
      return { open, openedOnce: true, reconnectAttempts: 3, stopped };
    },
  };
  const handlers: WireHandlers = {
    onStatus: (sub, status) => statuses.push({ sub, status }),
    onSeriesFull: (bars) => seriesFull.push(bars),
    onSeriesDelta: (bars, append) => seriesDelta.push({ bars, append }),
    onCloseVerified: (time, _result, ohlcv) => closes.push({ time, ohlcv }),
  };
  const applied: Array<{ via: string }> = [];
  const applyOrder: string[] = [];
  const applyFn = (
    _script: string,
    _id: string | undefined,
    _full: Record<string, unknown>,
    via: 'stream-full' | 'stream-delta',
  ): RunResult | Promise<RunResult> => {
    const done = (): RunResult => {
      applyOrder.push(`plots:${via}`);
      applied.push({ via });
      return { status: 'success', plots: [], series: {}, events: [], meta: {} };
    };
    if (opts?.syncApply) return done();
    return (async () => {
      if (opts?.delayDelta && via === 'stream-delta') await tick();
      return done();
    })();
  };
  handlers.onSeriesDelta = (bars, append) => {
    applyOrder.push('price');
    seriesDelta.push({ bars, append });
  };
  const wire = new StreamLiveWire(client, handlers, applyFn);
  const emit = (frame: WireFrame) => client.onFrame!(frame);
  const emitBatch = (frames: WireFrame[]) => {
    if (client.onFrames) client.onFrames(frames);
    else for (const frame of frames) client.onFrame!(frame);
  };
  return {
    wire,
    client,
    sent,
    statuses,
    applied,
    applyOrder,
    emit,
    emitBatch,
    unsubscribed,
    counters,
    seriesFull,
    seriesDelta,
    closes,
    resumes,
    fireReconnect: () => reconnect?.(),
    pumpReconnect: () => {
      if (stopped) return;
      counters.reconnects += 1;
      void client.connect();
    },
    dropSocket: () => {
      open = false;
    },
  };
}

const BARS: Bar[] = [{ time: 100, open: 1, high: 1, low: 1, close: 1, volume: 1 }];

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('redesign2 live-wire (F-19)', () => {
  afterEach(() => {
    resetEngineTransport();
  });

  test('ensureSeries resolves snapshot bars and goes live', async () => {
    const h = makeHarness();
    const p = h.wire.ensureSeries('series-1', { symbol: 'BTC/USDT' });
    await tick(); await tick();
    h.emit({ type: 'status', id: 'series-1', payload: { code: 'datafeed-loading' } });
    h.emit({
      type: 'full',
      id: 'series-1',
      seq: 1,
      payload: { seriesKey: 'k', count: 1, closed_upto: 0, bars: BARS },
    });
    const bars = await p;
    expect(bars).toEqual(BARS);
    expect(h.statuses.map((s) => s.status)).toContain('live');
  });

  test('back-to-back status+full never loses the snapshot', async () => {
    const h = makeHarness();
    const p = h.wire.ensureSeries('series-1', {});
    await tick(); await tick();
    h.emit({ type: 'status', id: 'series-1', payload: { code: 'datafeed-ready' } });
    h.emit({ type: 'status', id: 'series-1', payload: { code: 'calculating' } });
    h.emit({
      type: 'full',
      id: 'series-1',
      seq: 3,
      payload: { seriesKey: 'k', count: 1, closed_upto: 0, bars: BARS },
    });
    expect(await p).toEqual(BARS);
    expect(h.statuses.map((s) => s.status)).toContain('datafeed-ready');
  });

  test('ensureSeries falls back on empty snapshot', async () => {
    const h = makeHarness();
    const p = h.wire.ensureSeries('series-1', {});
    await tick(); await tick();
    h.emit({ type: 'full', id: 'series-1', seq: 1, payload: { count: 0 } });
    await expect(p).rejects.toBeInstanceOf(StreamFallbackError);
    expect(h.wire.cooledDown).toBe(true);
    expect(h.wire.snapshotState().lastFail?.reason).toBe('empty-snapshot');
    expect(h.client.isOpen).toBe(true);
    expect(h.counters.disconnects).toBe(0);
    expect(h.wire.snapshotState().stats).toMatchObject({ stopped: false, open: true });
  });

  test('script subscribe error does not cool down the series wire', async () => {
    const h = makeHarness();
    const scriptP = h.wire.evalScript({
      subId: 'id_keltner',
      script: 'indicator() {}',
      meta: {},
      bars: BARS,
    });
    await tick();
    await tick();
    h.emit({ type: 'error', id: 'id_keltner', payload: { code: 'x', message: 'boom' } });
    await expect(scriptP).rejects.toMatchObject({ reason: 'script-subscribe-failed' });
    expect(h.wire.cooledDown).toBe(false);
    expect(h.client.isOpen).toBe(true);

    const seriesP = h.wire.ensureSeries('series-1', {});
    await tick();
    await tick();
    h.emit({ type: 'full', id: 'series-1', seq: 1, payload: { count: 1, bars: BARS } });
    expect(await seriesP).toEqual(BARS);
    expect(h.wire.cooledDown).toBe(false);
    expect(h.wire.isSubscribed('series-1')).toBe(true);
  });

  test('evalScript re-subscribes when history_bars grows and does not cool the wire', async () => {
    const h = makeHarness();
    const first = h.wire.evalScript({
      subId: 's-1',
      script: 'indicator() {}',
      meta: { history_bars: 3 },
      bars: BARS,
    });
    await tick();
    await tick();
    h.emit({
      type: 'full',
      id: 's-1',
      seq: 1,
      payload: { count: 1, plots: [[1]], series: { a: [1] } },
    });
    await first;
    const second = h.wire.evalScript({
      subId: 's-1',
      script: 'indicator() {}',
      meta: { history_bars: 50 },
      bars: BARS,
    });
    await tick();
    await tick();
    expect(h.unsubscribed).toEqual(['s-1']);
    h.emit({
      type: 'full',
      id: 's-1',
      seq: 2,
      payload: { count: 1, plots: [[2]], series: { a: [2] } },
    });
    await second;
    expect(h.sent.filter((s) => s.kind === 'subscribe:script')).toHaveLength(2);
    expect(h.wire.cooledDown).toBe(false);
    await h.wire.evalScript({
      subId: 's-1',
      script: 'indicator() {}',
      meta: { history_bars: 50 },
      bars: BARS,
    });
    expect(h.sent.filter((s) => s.kind === 'subscribe:script')).toHaveLength(2);
    expect(h.wire.cooledDown).toBe(false);
  });

  test('evalScript subscribes once, then applies cached state', async () => {
    const h = makeHarness();
    const first = h.wire.evalScript({ subId: 's-1', script: 'indicator() {}', meta: {}, bars: BARS });
    await tick(); await tick();
    h.emit({
      type: 'full',
      id: 's-1',
      seq: 5,
      payload: { count: 1, plots: [[1]], series: { a: [1] } },
    });
    const r1 = (await first) as RunResult;
    expect(r1.status).toBe('success');
    expect(h.applied).toEqual([{ via: 'stream-full' }]);
    const r2 = (await h.wire.evalScript({ subId: 's-1', script: 'indicator() {}', meta: {}, bars: BARS })) as RunResult;
    expect(r2.status).toBe('success');
    expect(h.applied).toEqual([{ via: 'stream-full' }, { via: 'stream-delta' }]);
    expect(h.sent.filter((s) => s.kind === 'subscribe:script').length).toBe(1);
  });

  test('cooldown forces fallback after a failure', async () => {
    const h = makeHarness();
    const p = h.wire.ensureSeries('series-1', {});
    await tick(); await tick();
    h.emit({ type: 'error', id: 'series-1', payload: { code: 'x', message: 'boom' } });
    await expect(p).rejects.toBeInstanceOf(StreamFallbackError);
    await expect(h.wire.ensureSeries('series-2', {})).rejects.toMatchObject({ reason: 'cooldown' });
  });

  test('cooldown throw does not increment failures or re-arm', async () => {
    const h = makeHarness();
    const p = h.wire.ensureSeries('series-1', {});
    await tick(); await tick();
    h.emit({ type: 'error', id: 'series-1', payload: { code: 'x', message: 'boom' } });
    await expect(p).rejects.toBeInstanceOf(StreamFallbackError);
    expect(h.wire.snapshotState().failures).toBe(1);
    await expect(h.wire.ensureSeries('series-2', {})).rejects.toMatchObject({ reason: 'cooldown' });
    expect(h.wire.snapshotState().failures).toBe(1);
    await expect(h.wire.ensureSeries('series-3', {})).rejects.toMatchObject({ reason: 'cooldown' });
    expect(h.wire.snapshotState().failures).toBe(1);
    expect(h.wire.cooledDown).toBe(true);
  });

  test('fail() keeps the socket connectable during cooldown', async () => {
    const h = makeHarness();
    const p = h.wire.ensureSeries('series-1', {});
    await tick(); await tick();
    h.emit({ type: 'error', id: 'series-1', payload: { code: 'x', message: 'boom' } });
    await expect(p).rejects.toBeInstanceOf(StreamFallbackError);
    expect(h.counters.disconnects).toBe(0);
    expect(h.client.isOpen).toBe(true);
    expect(h.wire.cooledDown).toBe(true);
    expect(h.wire.snapshotState().stats).toMatchObject({ stopped: false, open: true });
    h.pumpReconnect();
    expect(h.counters.reconnects).toBe(1);
    h.dropSocket();
    const connects = h.counters.connects;
    await h.wire.ensureConnected();
    expect(h.client.isOpen).toBe(true);
    expect(h.counters.connects).toBe(connects + 1);
    expect(h.counters.disconnects).toBe(0);
    await expect(h.wire.ensureSeries('series-2', {})).rejects.toMatchObject({ reason: 'cooldown' });
    expect(h.sent.filter((s) => s.kind === 'subscribe:series').length).toBe(1);
  });

  test('series snapshot-timeout does not disconnect; later ensureSeries can subscribe on the same client', async () => {
    _resetV1Metrics();
    resetEngineTransport();
    const realSetTimeout = globalThis.setTimeout;
    const origNow = Date.now;
    const t0 = origNow();
    let now = t0;
    Date.now = () => now;
    globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (typeof ms === 'number' && ms > 1_000) {
        now += ms;
        return realSetTimeout(fn as () => void, 0);
      }
      return realSetTimeout(fn as () => void, ms as number, ...args);
    }) as typeof setTimeout;
    const h = makeHarness();
    try {
      const p = h.wire.ensureSeries('series:binance|spot|BTC/USDT|5m', {});
      await expect(p).rejects.toMatchObject({ reason: 'snapshot-timeout' });
      expect(h.counters.disconnects).toBe(0);
      expect(h.client.isOpen).toBe(true);
      expect(h.wire.snapshotState().stats).toMatchObject({ stopped: false, open: true });
      expect(h.wire.isSubscribed('series:binance|spot|BTC/USDT|5m')).toBe(false);
      expect(h.wire.snapshotState().lastFail?.reason).toBe('snapshot-timeout');
      const seriesSubs = h.sent.filter((s) => s.kind === 'subscribe:series');
      expect(seriesSubs).toHaveLength(4);
      expect(seriesSubs[3]?.opts).toBeUndefined();
      expect(v1MetricsSnapshot().counts.jsonFallback).toBe(1);
    } finally {
      Date.now = origNow;
      globalThis.setTimeout = realSetTimeout;
    }

    expect(h.wire.cooledDown).toBe(true);
    // Four snapshot deadlines plus the cooldown, on the fake clock.
    Date.now = () => origNow() + 700_000;
    try {
      expect(h.wire.cooledDown).toBe(false);
      const p2 = h.wire.ensureSeries('series:binance|spot|BTC/USDT|5m', {});
      await tick();
      await tick();
      h.emit({
        type: 'full',
        id: 'series:binance|spot|BTC/USDT|5m',
        seq: 1,
        payload: { count: 1, bars: BARS },
      });
      expect(await p2).toEqual(BARS);
      expect(h.client.isOpen).toBe(true);
      expect(h.counters.disconnects).toBe(0);
      expect(h.wire.snapshotState().stats).toMatchObject({ stopped: false, open: true });
      expect(h.sent.filter((s) => s.kind === 'subscribe:series').length).toBe(5);
    } finally {
      Date.now = origNow;
    }
  });

  test('after cooldown a later ensureSeries can open again', async () => {
    const h = makeHarness();
    const p = h.wire.ensureSeries('series-1', {});
    await tick(); await tick();
    h.emit({ type: 'error', id: 'series-1', payload: { code: 'x', message: 'boom' } });
    await expect(p).rejects.toBeInstanceOf(StreamFallbackError);
    expect(h.wire.cooledDown).toBe(true);

    const origNow = Date.now;
    Date.now = () => origNow() + 120_000;
    try {
      expect(h.wire.cooledDown).toBe(false);
      const p2 = h.wire.ensureSeries('series-2', {});
      await tick(); await tick();
      h.emit({ type: 'full', id: 'series-2', seq: 1, payload: { count: 1, bars: BARS } });
      expect(await p2).toEqual(BARS);
      expect(h.client.isOpen).toBe(true);
      expect(h.wire.snapshotState().stats).toMatchObject({ stopped: false, open: true });
    } finally {
      Date.now = origNow;
    }
  });

  test('a new wire can open after another wire failed', async () => {
    const h = makeHarness();
    const p = h.wire.ensureSeries('series-1', {});
    await tick(); await tick();
    h.emit({ type: 'error', id: 'series-1', payload: { code: 'x', message: 'boom' } });
    await expect(p).rejects.toBeInstanceOf(StreamFallbackError);

    const h2 = makeHarness();
    const p2 = h2.wire.ensureSeries('series-1', {});
    await tick(); await tick();
    h2.emit({ type: 'full', id: 'series-1', seq: 1, payload: { count: 1, bars: BARS } });
    expect(await p2).toEqual(BARS);
    expect(h2.client.isOpen).toBe(true);
  });

  test('ensureSeries subscribes once and returns cached bars', async () => {
    const h = makeHarness();
    const p = h.wire.ensureSeries('series-1', {});
    await tick(); await tick();
    h.emit({ type: 'full', id: 'series-1', seq: 1, payload: { count: 1, bars: BARS } });
    expect(await p).toEqual(BARS);
    expect(h.wire.isSubscribed('series-1')).toBe(true);
    const again = await h.wire.ensureSeries('series-1', { symbol: 'ignored' });
    expect(again).toEqual(BARS);
    expect(h.sent.filter((s) => s.kind === 'subscribe:series').length).toBe(1);
  });

  test('concurrent ensureSeries join one in-flight snapshot', async () => {
    const h = makeHarness();
    const p1 = h.wire.ensureSeries('series-1', {});
    const p2 = h.wire.ensureSeries('series-1', {});
    await tick(); await tick();
    h.emit({ type: 'full', id: 'series-1', seq: 1, payload: { count: 1, bars: BARS } });
    expect(await p1).toEqual(BARS);
    expect(await p2).toEqual(BARS);
    expect(h.sent.filter((s) => s.kind === 'subscribe:series').length).toBe(1);
  });

  test('datafeed-loading extends the snapshot wait to the 120s cap', async () => {
    const delays: number[] = [];
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (typeof ms === 'number' && ms > 1_000) delays.push(ms);
      return realSetTimeout(fn as () => void, ms as number, ...args);
    }) as typeof setTimeout;
    try {
      const h = makeHarness();
      const p = h.wire.ensureSeries('series-1', {});
      await tick();
      await tick();
      h.emit({ type: 'status', id: 'series-1', payload: { code: 'datafeed-loading' } });
      await tick();
      expect(delays.some((d) => d >= 100_000)).toBe(true);
      h.emit({
        type: 'full',
        id: 'series-1',
        seq: 1,
        payload: { count: 1, bars: BARS },
      });
      expect(await p).toEqual(BARS);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  test('awaitFull ignores leftover delta and waits for full', async () => {
    const h = makeHarness();
    const p = h.wire.ensureSeries('series-1', {});
    await tick(); await tick();
    h.emit({ type: 'delta', id: 'series-1', seq: 2, payload: { bars: [] } });
    h.emit({
      type: 'full',
      id: 'series-1',
      seq: 3,
      payload: { seriesKey: 'k', count: 1, closed_upto: 0, bars: BARS },
    });
    expect(await p).toEqual(BARS);
    expect(h.wire.isSubscribed('series-1')).toBe(true);
  });

  test('routeFrame applies remote deltas and degrades on rejection', async () => {
    const h = makeHarness();
    const first = h.wire.evalScript({ subId: 's-1', script: 'x', meta: {}, bars: BARS });
    await tick(); await tick();
    h.emit({
      type: 'full',
      id: 's-1',
      seq: 1,
      payload: { count: 2, plots: [[1], [2]], series: { a: [1, 2] } },
    });
    await first;
    h.wire.routeFrame({ type: 'delta', id: 's-1', sessionId: 'ses', seq: 99, payload: { base_index: 0, count: 1, tail_len: 1 } });
    expect(h.statuses.map((s) => s.status)).toContain('degraded');
  });
});

describe('live-wire diagnostics (MCP stream.get / stream.reset)', () => {
  test('snapshotState lists subscriptions with seq — never frame payloads', async () => {
    const h = makeHarness();
    const p = h.wire.ensureSeries('series:binance|spot|BTCUSDT|1m', {});
    await tick(); await tick();
    h.emit({
      type: 'full',
      id: 'series:binance|spot|BTCUSDT|1m',
      seq: 7,
      payload: { count: 1, bars: BARS },
    });
    await p;

    const state = h.wire.snapshotState();
    expect(state.open).toBe(true);
    expect(state.cooledDown).toBe(false);
    expect(state.failures).toBe(0);
    expect(state.lastFail).toBeNull();
    expect(state.stats).toMatchObject({ reconnectAttempts: 3, stopped: false });
    expect(state.subs).toEqual([
      { subId: 'series:binance|spot|BTCUSDT|1m', kind: 'series', seq: 7, merged: true },
    ]);
    const json = JSON.stringify(state);
    expect(json).not.toContain('"bars"');
    expect(json).not.toContain('close');
  });

  test('script subscriptions report kind script + merged applier', async () => {
    const h = makeHarness();
    const p = h.wire.evalScript({ subId: 's-1', script: 'x', meta: {}, bars: BARS });
    await tick(); await tick();
    h.emit({ type: 'full', id: 's-1', seq: 2, payload: { count: 1, plots: [[1]], series: {} } });
    await p;
    const state = h.wire.snapshotState();
    expect(state.subs).toEqual([{ subId: 's-1', kind: 'script', seq: 2, merged: true }]);
  });

  test('reset unsubscribes every sub, disconnects once and clears state', async () => {
    const h = makeHarness();
    const p = h.wire.ensureSeries('series:binance|spot|BTCUSDT|1m', {});
    await tick(); await tick();
    h.emit({ type: 'full', id: 'series:binance|spot|BTCUSDT|1m', seq: 1, payload: { count: 1, bars: BARS } });
    await p;

    const out = h.wire.reset();
    expect(out).toMatchObject({ unsubscribed: 1, wasOpen: true });
    expect(h.unsubscribed).toEqual(['series:binance|spot|BTCUSDT|1m']);
    expect(h.counters.disconnects).toBe(1);
    const after = h.wire.snapshotState();
    expect(after.subs).toEqual([]);
    expect(after.failures).toBe(0);
    expect(after.cooledDown).toBe(false);
  });

  test('reset clears a failure cooldown so the caller can start over', async () => {
    const h = makeHarness();
    const p = h.wire.ensureSeries('series-1', {});
    await tick(); await tick();
    h.emit({ type: 'error', id: 'series-1', payload: { code: 'x', message: 'boom' } });
    await expect(p).rejects.toBeInstanceOf(StreamFallbackError);
    expect(h.wire.cooledDown).toBe(true);

    h.wire.reset();
    expect(h.wire.cooledDown).toBe(false);
    expect(h.wire.snapshotState().failures).toBe(0);
    expect(h.counters.disconnects).toBe(1);
    expect(h.wire.snapshotState().stats).toMatchObject({ stopped: true, open: false });
  });
});

describe('live-wire P1 series + study push', () => {
  test('the inbox drops forming tips and still delivers the snapshot', async () => {
    const h = makeHarness();
    const p = h.wire.ensureSeries('series:k', {});
    await tick();
    await tick();
    for (let i = 0; i < 40; i++) {
      h.emit({
        type: 'delta',
        id: 'series:k',
        sessionId: 'ses',
        seq: i + 1,
        payload: {
          forming: true,
          bars: [{ time: 100, open: 1, high: 1, low: 1, close: i, volume: 1 }],
          base_index: 0,
          count: 1,
          tail_len: 1,
        },
      });
    }
    h.emit({
      type: 'close',
      id: 'series:k',
      sessionId: 'ses',
      seq: 90,
      payload: { index: 0, time: 100, ohlcv: { open: 1, high: 1, low: 1, close: 1, volume: 1 } },
    });
    // Latest forming tip + close; tips coalesce to one slot.
    expect(h.wire.inboxDepth('series:k')).toBe(2);
    h.emit({
      type: 'full',
      id: 'series:k',
      sessionId: 'ses',
      seq: 100,
      payload: { count: 1, bars: BARS },
    });
    const bars = await p;
    expect(bars.length).toBeGreaterThan(0);
    const queued = h.wire.inboxDepth('series:k');
    expect(queued).toBeLessThanOrEqual(32);
  });

  test('a queue of closes is kept and resumes once', async () => {
    const h = makeHarness();
    const p = h.wire.ensureSeries('series:k', {});
    await tick();
    await tick();
    h.emit({ type: 'full', id: 'series:k', seq: 1, payload: { count: 1, bars: BARS } });
    await p;
    h.resumes.length = 0;
    for (let i = 0; i < 40; i++) {
      h.emit({
        type: 'close',
        id: 'series:k',
        seq: i + 2,
        payload: { index: 0, time: 100, ohlcv: { open: 1, high: 1, low: 1, close: 1, volume: 1 } },
      });
    }
    expect(h.wire.inboxDepth('series:k')).toBe(40);
    expect(h.resumes).toHaveLength(1);
    expect(h.resumes[0]?.id).toBe('series:k');
    expect(h.statuses.at(-1)).toMatchObject({ sub: 'series:k', status: 'degraded' });
    h.emit({
      type: 'close',
      id: 'series:k',
      seq: 80,
      payload: { index: 0, time: 100, ohlcv: { open: 1, high: 1, low: 1, close: 1, volume: 1 } },
    });
    expect(h.resumes).toHaveLength(1);
    h.emit({ type: 'full', id: 'series:k', seq: 90, payload: { count: 1, bars: BARS } });
    await tick();
    h.resumes.length = 0;
    for (let i = 0; i < 40; i++) {
      h.emit({
        type: 'close',
        id: 'series:k',
        seq: 100 + i,
        payload: { index: 0, time: 100, ohlcv: { open: 1, high: 1, low: 1, close: 1, volume: 1 } },
      });
    }
    expect(h.resumes).toHaveLength(1);
  });

  test('snapshot, ticks, close, gap, then replay paint as one generation each', async () => {
    _resetV1Metrics();
    const h = makeHarness();
    const sub = 'series:k';
    const p = h.wire.ensureSeries(sub, {});
    await tick();
    await tick();
    h.emit({
      type: 'full',
      id: sub,
      sessionId: 'ses',
      seq: 1,
      payload: { count: 1, bars: BARS },
    });
    await p;
    expect(h.seriesFull).toEqual([BARS]);
    expect(h.seriesDelta).toEqual([]);

    const tip: Bar = { time: 100, open: 1, high: 2, low: 1, close: 2, volume: 1 };
    h.emit({
      type: 'delta',
      id: sub,
      sessionId: 'ses',
      seq: 2,
      payload: { bars: [tip], forming: true, base_index: 0, count: 1, tail_len: 1 },
    });
    expect(h.seriesDelta).toEqual([{ bars: [tip], append: true }]);

    const closed: Bar = { ...tip, high: 3, close: 3, closed: true };
    h.emit({
      type: 'delta',
      id: sub,
      sessionId: 'ses',
      seq: 3,
      payload: { bars: [closed], forming: false, base_index: 0, count: 1, tail_len: 1 },
    });
    h.emit({
      type: 'close',
      id: sub,
      sessionId: 'ses',
      seq: 3,
      payload: { time: 100, ohlcv: { open: 1, high: 2, low: 1, close: 3, volume: 1 } },
    });
    expect(h.seriesDelta).toEqual([
      { bars: [tip], append: true },
      { bars: [closed], append: true },
    ]);
    expect(h.closes).toEqual([{ time: 100, ohlcv: { open: 1, high: 2, low: 1, close: 3, volume: 1 } }]);

    h.resumes.length = 0;
    const skipped: Bar = { time: 160, open: 3, high: 4, low: 3, close: 4, volume: 1 };
    h.emit({
      type: 'delta',
      id: sub,
      sessionId: 'ses',
      seq: 6,
      payload: { bars: [skipped], forming: true, base_index: 1, count: 2, tail_len: 1 },
    });
    expect(h.seriesDelta).toHaveLength(2);
    expect(h.resumes).toHaveLength(1);
    expect(h.resumes[0]).toMatchObject({ id: sub, extra: { seq: 3 } });
    expect(h.statuses.map((s) => s.status)).toContain('degraded');
    expect(v1MetricsSnapshot().counts.seqGap).toBe(1);
    expect(v1MetricsSnapshot().counts.resync).toBe(1);

    h.emit({
      type: 'delta',
      id: sub,
      sessionId: 'ses',
      seq: 7,
      payload: { bars: [skipped], forming: true, base_index: 1, count: 2, tail_len: 1 },
    });
    expect(h.seriesDelta).toHaveLength(2);
    expect(h.resumes).toHaveLength(1);

    const replay: Bar[] = [closed, skipped];
    h.emit({
      type: 'full',
      id: sub,
      sessionId: 'ses',
      seq: 6,
      payload: { count: 2, bars: replay },
    });
    expect(h.seriesFull).toEqual([BARS, replay]);
    expect(h.wire.snapshotState().subs[0]?.seq).toBe(6);

    const next: Bar = { time: 160, open: 3, high: 5, low: 3, close: 5, volume: 1 };
    h.emit({
      type: 'delta',
      id: sub,
      sessionId: 'ses',
      seq: 7,
      payload: { bars: [next], forming: true, base_index: 1, count: 2, tail_len: 1 },
    });
    expect(h.seriesDelta.at(-1)).toEqual({ bars: [next], append: true });
    expect(h.wire.snapshotState().subs[0]?.seq).toBe(7);
    expect(h.statuses.at(-1)?.status).toBe('live');
  });

  test('an AXB1 subscribe still paints JSON when the server ignores encoding', async () => {
    _resetV1Metrics();
    setEngineTransport('worker');
    const h = makeHarness();
    const p = h.wire.ensureSeries('series:k', {});
    await tick();
    await tick();
    expect(h.sent[0]?.opts).toEqual({ encoding: 'axb1' });
    h.emit({
      type: 'full',
      id: 'series:k',
      seq: 1,
      payload: { count: 1, bars: BARS },
    });
    await p;
    const tip: Bar = { time: 100, open: 1, high: 2, low: 1, close: 2, volume: 1 };
    h.emit({
      type: 'delta',
      id: 'series:k',
      seq: 2,
      payload: { bars: [tip], forming: true, base_index: 0, count: 1, tail_len: 1 },
    });
    expect(h.seriesFull).toEqual([BARS]);
    expect(h.seriesDelta).toEqual([{ bars: [tip], append: true }]);
    expect(v1MetricsSnapshot().counts.jsonFallback).toBe(0);
  });

  test('series delta paints without an applier and advances seq', async () => {
    const h = makeHarness();
    const p = h.wire.ensureSeries('series:binance|spot|BTC/USDT|1m', {});
    await tick(); await tick();
    h.emit({
      type: 'full',
      id: 'series:binance|spot|BTC/USDT|1m',
      sessionId: 'ses',
      seq: 1,
      payload: { count: 1, bars: BARS },
    });
    await p;
    const tip: Bar = { time: 160, open: 2, high: 2, low: 2, close: 2, volume: 2 };
    h.emit({
      type: 'delta',
      id: 'series:binance|spot|BTC/USDT|1m',
      sessionId: 'ses',
      seq: 2,
      payload: { bars: [tip], base_index: 1, count: 2, tail_len: 1 },
    });
    expect(h.seriesDelta).toEqual([{ bars: [tip], append: true }]);
    expect(h.wire.snapshotState().subs).toEqual([
      { subId: 'series:binance|spot|BTC/USDT|1m', kind: 'series', seq: 2, merged: true },
    ]);
  });

  test('a stale full does not paint over a newer series seq', async () => {
    const h = makeHarness();
    const p = h.wire.ensureSeries('series:k', {});
    await tick();
    await tick();
    h.emit({
      type: 'full',
      id: 'series:k',
      sessionId: 'ses',
      seq: 4,
      payload: { count: 1, bars: BARS },
    });
    await p;
    h.emit({
      type: 'full',
      id: 'series:k',
      sessionId: 'ses',
      seq: 2,
      payload: { count: 1, bars: [{ time: 1, open: 9, high: 9, low: 9, close: 9, volume: 9 }] },
    });
    expect(h.seriesFull).toHaveLength(1);
    expect(h.wire.snapshotState().subs[0]?.seq).toBe(4);
  });

  test('script delta applies through the bridge without a re-subscribe', async () => {
    const h = makeHarness();
    const first = h.wire.evalScript({ subId: 's-1', script: 'indicator() {}', meta: {}, bars: BARS });
    await tick(); await tick();
    h.emit({
      type: 'full',
      id: 's-1',
      sessionId: 'ses',
      seq: 5,
      payload: { count: 1, plots: [[1]], series: { a: [1] } },
    });
    await first;
    expect(h.applied).toEqual([{ via: 'stream-full' }]);
    h.emit({
      type: 'full',
      id: 's-1',
      sessionId: 'old',
      seq: 3,
      payload: { count: 1, plots: [[9]], series: { a: [9] } },
    });
    await tick();
    expect(h.applied).toEqual([{ via: 'stream-full' }]);
    expect(h.wire.snapshotState().subs[0]?.seq).toBe(5);
    h.emit({
      type: 'delta',
      id: 's-1',
      sessionId: 'ses',
      seq: 6,
      payload: { base_index: 0, count: 1, tail_len: 1, plots: [[2]], series: { a: [2] } },
    });
    await tick();
    expect(h.applied).toEqual([{ via: 'stream-full' }, { via: 'stream-delta' }]);
    expect(h.sent.filter((s) => s.kind === 'subscribe:script').length).toBe(1);
    expect(h.wire.snapshotState().subs[0]?.seq).toBe(6);
  });

  test('a mid-stream snapshot replaces a pending forming tip as one generation', async () => {
    const h = makeHarness({ delayDelta: true });
    const first = h.wire.evalScript({ subId: 's-1', script: 'indicator() {}', meta: {}, bars: BARS });
    await tick();
    await tick();
    h.emit({
      type: 'full',
      id: 's-1',
      sessionId: 'ses',
      seq: 5,
      payload: { count: 1, plots: [[1]], series: { a: [1] } },
    });
    await first;
    h.emit({
      type: 'delta',
      id: 's-1',
      sessionId: 'ses',
      seq: 6,
      payload: {
        base_index: 0,
        count: 1,
        tail_len: 1,
        forming: true,
        plots: [[6]],
        series: { a: [6] },
      },
    });
    h.emit({
      type: 'full',
      id: 's-1',
      sessionId: 'ses',
      seq: 10,
      payload: { count: 1, plots: [[10]], series: { a: [10] } },
    });
    await tick();
    expect(h.applied.filter((a) => a.via === 'stream-full')).toHaveLength(2);
    expect(h.applied.at(-1)).toEqual({ via: 'stream-full' });
    expect(h.wire.snapshotState().subs[0]?.seq).toBe(10);
    h.emit({
      type: 'delta',
      id: 's-1',
      sessionId: 'ses',
      seq: 11,
      payload: { base_index: 0, count: 1, tail_len: 1, plots: [[11]], series: { a: [11] } },
    });
    await tick();
    await tick();
    expect(h.applied.at(-1)).toEqual({ via: 'stream-delta' });
    expect(h.wire.snapshotState().subs[0]?.seq).toBe(11);
  });

  test('a hidden tab applies one tip when no bar closed', async () => {
    const h = makeHarness();
    const first = h.wire.evalScript({ subId: 's-1', script: 'indicator() {}', meta: {}, bars: BARS });
    await tick();
    await tick();
    h.emit({
      type: 'full',
      id: 's-1',
      sessionId: 'ses',
      seq: 5,
      payload: { count: 1, plots: [[1]], series: { a: [1] }, closed_upto: 10 },
    });
    await first;
    h.wire.notePageVisibility(true);
    for (let seq = 6; seq <= 9; seq++) {
      h.emit({
        type: 'delta',
        id: 's-1',
        sessionId: 'ses',
        seq,
        payload: {
          base_index: 0,
          count: 1,
          tail_len: 1,
          plots: [[seq]],
          series: { a: [seq] },
          closed_upto: 10,
          forming: true,
        },
      });
    }
    expect(h.applied).toEqual([{ via: 'stream-full' }]);
    expect(h.counters.disconnects).toBe(0);
    h.wire.notePageVisibility(false);
    await new Promise((r) => setTimeout(r, HIDDEN_WAKE_MS + 20));
    await tick();
    expect(h.applied).toEqual([{ via: 'stream-full' }, { via: 'stream-delta' }]);
    expect(h.resumes).toEqual([]);
    expect(h.wire.snapshotState().subs[0]?.seq).toBe(9);
    h.wire.reset();
  });

  test('a hidden tab resumes once when a bar closed', async () => {
    const h = makeHarness();
    const first = h.wire.evalScript({ subId: 's-1', script: 'indicator() {}', meta: {}, bars: BARS });
    await tick();
    await tick();
    h.emit({
      type: 'full',
      id: 's-1',
      sessionId: 'ses',
      seq: 5,
      payload: { count: 1, plots: [[1]], series: { a: [1] }, closed_upto: 10 },
    });
    await first;
    h.wire.notePageVisibility(true);
    h.emit({
      type: 'delta',
      id: 's-1',
      sessionId: 'ses',
      seq: 6,
      payload: {
        base_index: 0,
        count: 1,
        tail_len: 1,
        plots: [[6]],
        series: { a: [6] },
        closed_upto: 12,
        forming: true,
      },
    });
    h.emit({
      type: 'delta',
      id: 's-1',
      sessionId: 'ses',
      seq: 8,
      payload: {
        base_index: 0,
        count: 1,
        tail_len: 1,
        plots: [[8]],
        series: { a: [8] },
        closed_upto: 12,
        forming: true,
      },
    });
    h.wire.notePageVisibility(false);
    await new Promise((r) => setTimeout(r, HIDDEN_WAKE_MS + 20));
    expect(h.applied).toEqual([{ via: 'stream-full' }]);
    expect(h.resumes).toHaveLength(1);
    expect(h.resumes[0]).toMatchObject({ id: 's-1', extra: { seq: 5, closed_upto: 10 } });
    expect(h.counters.disconnects).toBe(0);
    h.wire.reset();
  });

  test('an unknown opcode resumes that sub in JSON and leaves the socket up', async () => {
    _resetV1Metrics();
    resetEngineTransport();
    const h = makeHarness();
    const first = h.wire.evalScript({ subId: 's-1', script: 'indicator() {}', meta: {}, bars: BARS });
    await tick();
    await tick();
    h.emit({
      type: 'full',
      id: 's-1',
      sessionId: 'ses',
      seq: 5,
      payload: { count: 1, plots: [[1]], series: { a: [1] }, closed_upto: 10 },
    });
    await first;
    h.client.onUnknownOpcode?.({ id: 's-1', opcode: 127, seq: 9 });
    h.client.onUnknownOpcode?.({ id: 's-1', opcode: 127, seq: 10 });
    expect(h.resumes).toHaveLength(1);
    expect(h.resumes[0]?.extra).toEqual({ seq: 5, closed_upto: 10 });
    expect(h.counters.disconnects).toBe(0);
    expect(v1MetricsSnapshot().counts.jsonFallback).toBe(1);
    h.wire.reset();
    _resetV1Metrics();
  });

  test('a thrown paint aborts the batch and resumes once', async () => {
    let paints = 0;
    const sent: string[] = [];
    const statuses: string[] = [];
    const client: WireClient = {
      get isOpen() {
        return true;
      },
      onFrame: undefined,
      async connect() {},
      disconnect() {},
      subscribe() {},
      resumeSubscription(id) {
        sent.push(id);
      },
      unsubscribe() {},
      awaitFrame() {
        return new Promise(() => {});
      },
      addReconnectHandler() {
        return () => {};
      },
    };
    const wire = new StreamLiveWire(
      client,
      {
        onStatus: (_sub, _status, extra) => statuses.push(extra?.message ?? ''),
        onSeriesFull: () => {},
        onSeriesDelta: () => {},
        onCloseVerified: () => {},
      },
      (() => {
        paints += 1;
        if (paints > 1) throw new Error('paint failed');
        return Promise.resolve({ status: 'success', plots: [], series: {}, events: [], meta: {} });
      }) as never,
    );
    const first = wire.evalScript({ subId: 's-1', script: 'indicator() {}', meta: {}, bars: BARS });
    await tick();
    await tick();
    client.onFrame?.({
      type: 'full',
      id: 's-1',
      sessionId: 'ses',
      seq: 1,
      payload: { count: 1, plots: [[1]], series: { a: [1] } },
    });
    await first;
    client.onFrame?.({
      type: 'delta',
      id: 's-1',
      sessionId: 'ses',
      seq: 2,
      payload: { base_index: 0, count: 1, tail_len: 1, plots: [[2]], series: { a: [2] } },
    });
    client.onFrame?.({
      type: 'delta',
      id: 's-1',
      sessionId: 'ses',
      seq: 3,
      payload: { base_index: 0, count: 1, tail_len: 1, plots: [[3]], series: { a: [3] } },
    });
    expect(sent).toEqual(['s-1']);
    expect(statuses.some((m) => m.startsWith('apply aborted'))).toBe(true);
    wire.reset();
  });

  test('forming: true script delta applies as executionContext tip', async () => {
    const seen: Array<{ via: string; executionContext: unknown }> = [];
    const client: WireClient = {
      get isOpen() {
        return true;
      },
      onFrame: undefined,
      async connect() {},
      disconnect() {},
      subscribe() {},
      resumeSubscription() {},
      unsubscribe() {},
      awaitFrame() {
        return new Promise(() => {});
      },
      addReconnectHandler() {
        return () => {};
      },
    };
    const wire = new StreamLiveWire(
      client,
      {
        onStatus: () => {},
        onSeriesFull: () => {},
        onSeriesDelta: () => {},
        onCloseVerified: () => {},
      },
      (async (_script, _id, full, via) => {
        seen.push({
          via,
          executionContext: (full as { executionContext?: string }).executionContext,
        });
        return { status: 'success', plots: [], series: {}, events: [], meta: {} };
      }) as never,
    );
    const first = wire.evalScript({
      subId: 's-tip',
      script: 'indicator() {}',
      meta: {},
      bars: BARS,
    });
    await tick();
    await tick();
    client.onFrame?.({
      type: 'full',
      id: 's-tip',
      sessionId: 'ses',
      seq: 1,
      payload: { count: 1, plots: [[1]], series: { a: [1] } },
    });
    await first;
    client.onFrame?.({
      type: 'delta',
      id: 's-tip',
      sessionId: 'ses',
      seq: 2,
      payload: {
        base_index: 0,
        count: 1,
        tail_len: 1,
        forming: true,
        plots: [[2]],
        series: { a: [2] },
      },
    });
    await tick();
    expect(seen).toEqual([
      { via: 'stream-full', executionContext: 'snapshot' },
      { via: 'stream-delta', executionContext: 'tip' },
    ]);
  });

  test('a snapshot counted shorter than its plots still accepts the session delta', async () => {
    const h = makeHarness();
    const bars = [100, 160, 220, 280].map((time) => ({
      time,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
    }));
    const first = h.wire.evalScript({ subId: 's-1', script: 'indicator() {}', meta: {}, bars });
    await tick();
    await tick();
    h.emit({
      type: 'full',
      id: 's-1',
      sessionId: 'ses',
      seq: 1,
      payload: {
        // Subscribe asked for 2 bars. The shared session already has 4,
        // and the next candle's delta is numbered from 4.
        count: 2,
        plots: [1, 2, 3, 4],
        series: { upper: [1, 2, 3, 4], lower: [0, 0, 0, 0] },
        bar_times: [100, 160, 220, 280],
      },
    });
    await first;
    h.resumes.length = 0;
    h.emit({
      type: 'delta',
      id: 's-1',
      sessionId: 'ses',
      seq: 2,
      payload: {
        base_index: 4,
        count: 5,
        tail_len: 1,
        plots: [5],
        series: { upper: [5], lower: [0] },
      },
    });
    await tick();
    expect(h.applied.map((a) => a.via)).toEqual(['stream-full', 'stream-delta']);
    expect(h.resumes).toEqual([]);
    expect(h.statuses.some((s) => s.status === 'degraded')).toBe(false);
  });

  test('a snapshot whose bar times do not match the plots still accepts the next delta', async () => {
    const h = makeHarness();
    const first = h.wire.evalScript({ subId: 's-1', script: 'indicator() {}', meta: {}, bars: BARS });
    await tick();
    await tick();
    h.emit({
      type: 'full',
      id: 's-1',
      sessionId: 'ses',
      seq: 1,
      payload: {
        count: 1,
        plots: [[1]],
        series: { upper: [1] },
        // Engine series is longer than the script window. Keeping these
        // stamps used to reject every delta and freeze Donchian at this bar.
        bar_times: [100, 160],
      },
    });
    await first;
    h.resumes.length = 0;
    h.emit({
      type: 'delta',
      id: 's-1',
      sessionId: 'ses',
      seq: 2,
      payload: { base_index: 0, count: 1, tail_len: 1, plots: [[2]], series: { upper: [2] } },
    });
    await tick();
    expect(h.applied.map((a) => a.via)).toEqual(['stream-full', 'stream-delta']);
    expect(h.resumes).toEqual([]);
    expect(h.statuses.some((s) => s.status === 'degraded')).toBe(false);
  });

  test('a replay refusal resumes once in JSON and then stops painting', async () => {
    resetEngineTransport();
    const h = makeHarness();
    const first = h.wire.evalScript({ subId: 's-1', script: 'indicator() {}', meta: {}, bars: BARS });
    await tick();
    await tick();
    h.emit({
      type: 'full',
      id: 's-1',
      sessionId: 'ses',
      seq: 5,
      payload: { count: 1, plots: [[1]], series: { a: [1] } },
    });
    await first;
    h.emit({
      type: 'delta',
      id: 's-1',
      sessionId: 'ses',
      seq: 8,
      payload: { base_index: 0, count: 1, tail_len: 1, plots: [[2]], series: { a: [2] } },
    });
    await tick();
    expect(h.resumes).toHaveLength(1);
    h.emit({
      type: 'error',
      id: 's-1',
      payload: { code: 'replay-unavailable', message: 'no replay' },
    });
    expect(h.resumes).toHaveLength(2);
    expect(h.resumes[1]?.extra).toEqual({ seq: 5 });
    expect(h.statuses.map((s) => s.status)).toContain('degraded');
    h.emit({
      type: 'error',
      id: 's-1',
      payload: { code: 'replay-unavailable', message: 'no replay' },
    });
    expect(h.resumes).toHaveLength(2);
    h.emit({
      type: 'delta',
      id: 's-1',
      sessionId: 'ses',
      seq: 9,
      payload: { base_index: 0, count: 1, tail_len: 1, plots: [[3]], series: { a: [3] } },
    });
    await tick();
    expect(h.applied).toEqual([{ via: 'stream-full' }]);
  });

  test('a script delta with a seq gap resubscribes instead of painting', async () => {
    const h = makeHarness();
    const first = h.wire.evalScript({ subId: 's-1', script: 'indicator() {}', meta: {}, bars: BARS });
    await tick(); await tick();
    h.emit({
      type: 'full',
      id: 's-1',
      sessionId: 'ses',
      seq: 5,
      payload: { count: 1, plots: [[1]], series: { a: [1] } },
    });
    await first;
    expect(h.applied).toEqual([{ via: 'stream-full' }]);
    // Frames 6..7 were missed while the tab was idle: force-merging delta 8
    // would silently drop bars, and any axis-less salvage would tail-pin.
    // The wire holds the last good paint and asks for a fresh full instead.
    h.emit({
      type: 'delta',
      id: 's-1',
      sessionId: 'ses',
      seq: 8,
      payload: { base_index: 0, count: 1, tail_len: 1, plots: [[2]], series: { a: [2] } },
    });
    await tick();
    expect(h.applied).toEqual([{ via: 'stream-full' }]);
    expect(h.statuses.map((s) => s.status)).toContain('degraded');
    expect(h.resumes).toHaveLength(1);
    expect(h.resumes[0]).toMatchObject({ id: 's-1' });
    h.emit({
      type: 'delta',
      id: 's-1',
      sessionId: 'ses',
      seq: 9,
      payload: { base_index: 0, count: 1, tail_len: 1, plots: [[3]], series: { a: [3] } },
    });
    await tick();
    expect(h.applied).toEqual([{ via: 'stream-full' }]);
    expect(h.resumes).toHaveLength(1);
  });

  test('an axis-less merge over a moved window resubscribes instead of painting', async () => {
    // Hermetic window: the tail extrapolator reads the live store, so pin
    // it to the subscribe window (another file may have left bars behind;
    // bun shares module state across test files).
    const prevBars = store.bars;
    setStore('bars', BARS.map((b) => ({ ...b })));
    try {
const h = makeHarness();
    const first = h.wire.evalScript({ subId: 's-1', script: 'indicator() {}', meta: {}, bars: BARS });
    await tick(); await tick();
    h.emit({
    type: 'full',
    id: 's-1',
    sessionId: 'ses',
    seq: 1,
    payload: {
      count: 1,
      plots: [[1]],
      series: { a: [1] },
      bar_times: [100],
    },
    });
    await first;
    expect(h.applied).toEqual([{ via: 'stream-full' }]);
    // New candle while the chart has not painted it yet: the single-stamp
    // cached axis cannot extrapolate the tail (no step, no known times), so
    // the values-only salvage merges without an axis and covers 2 bars of a
    // 1-bar subscribe window. Painting would tail-pin; resubscribe instead
    // so a real full restores the pane instead of freezing it.
    h.emit({
    type: 'delta',
    id: 's-1',
    sessionId: 'ses',
    seq: 2,
    payload: { base_index: 1, count: 2, tail_len: 1, plots: [[2]], series: { a: [2] } },
    });
    await tick();
    expect(h.applied).toEqual([{ via: 'stream-full' }]);
    expect(h.statuses.map((st) => st.status)).toContain('degraded');
    expect(h.resumes).toHaveLength(1);
    expect(h.resumes[0]).toMatchObject({ id: 's-1' });
    // The next consistent delta merges against the axis-less cache and
    // paints normally (the runner still refuses it while the window
    // disagrees) — and it must not re-request: one resub per snapshot.
    h.emit({
    type: 'delta',
    id: 's-1',
    sessionId: 'ses',
    seq: 3,
    payload: { base_index: 1, count: 2, tail_len: 1, plots: [[3]], series: { a: [3] } },
    });
    await tick();
    expect(h.applied).toEqual([{ via: 'stream-full' }, { via: 'stream-delta' }]);
    expect(h.resumes).toHaveLength(1);
    } finally {
      setStore('bars', prevBars as Bar[]);
    }
  });

  test('a full send buffer marks the sub and resumes when it drains', async () => {
    const h = makeHarness();
    const p = h.wire.ensureSeries('series:k', {});
    await tick();
    await tick();
    h.emit({ type: 'full', id: 'series:k', seq: 4, payload: { count: 1, bars: BARS } });
    await p;
    h.client.onBackpressure?.(true);
    expect(h.statuses.at(-1)).toMatchObject({
      sub: 'series:k',
      status: 'degraded',
    });
    h.resumes.length = 0;
    h.client.onBackpressure?.(false);
    expect(h.resumes.map((r) => r.id)).toEqual(['series:k']);
  });

  test('reconnect resumes every live subscription', async () => {
    resetEngineTransport();
    const h = makeHarness();
    const p = h.wire.ensureSeries('series:k', {});
    await tick(); await tick();
    h.emit({ type: 'full', id: 'series:k', seq: 4, payload: { count: 1, bars: BARS } });
    await p;
    h.fireReconnect();
    expect(h.resumes).toEqual([
      { id: 'series:k', count: 1, lastTime: 100, extra: { seq: 4, encoding: 'axb1' } },
    ]);
  });

  test('json omits encoding; the worker transport negotiates axb1', async () => {
    setEngineTransport('json');

    const plain = makeHarness();
    const series = plain.wire.ensureSeries('series:json', {});
    await tick();
    await tick();
    expect(plain.sent[0]).toMatchObject({ kind: 'subscribe:series', id: 'series:json' });
    expect(plain.sent[0]?.opts).toBeUndefined();
    plain.emit({ type: 'full', id: 'series:json', seq: 1, payload: { count: 1, bars: BARS } });
    await series;
    const script = plain.wire.evalScript({
      subId: 's-json',
      script: 'indicator() {}',
      meta: {},
      bars: BARS,
    });
    await tick();
    await tick();
    expect(plain.sent.find((s) => s.kind === 'subscribe:script')?.opts).toEqual({
      script: 'indicator() {}',
    });
    plain.emit({
      type: 'full',
      id: 's-json',
      sessionId: 'ses',
      seq: 1,
      payload: { count: 1, plots: [[1]], series: { a: [1] } },
    });
    await script;
    plain.emit({
      type: 'delta',
      id: 's-json',
      sessionId: 'ses',
      seq: 4,
      payload: { base_index: 0, count: 1, tail_len: 1, plots: [[2]], series: { a: [2] } },
    });
    await tick();
    expect(plain.resumes[0]?.extra).toEqual({ seq: 1 });

    setEngineTransport('worker');
    const worker = makeHarness();
    const wSeries = worker.wire.ensureSeries('series:w', {});
    await tick();
    await tick();
    expect(worker.sent[0]?.opts).toEqual({ encoding: 'axb1' });
    worker.emit({ type: 'full', id: 'series:w', seq: 1, payload: { count: 1, bars: BARS } });
    await wSeries;
    worker.fireReconnect();
    expect(worker.resumes).toEqual([
      { id: 'series:w', count: 1, lastTime: 100, extra: { seq: 1, encoding: 'axb1' } },
    ]);
    const wScript = worker.wire.evalScript({
      subId: 's-w',
      script: 'indicator() {}',
      meta: {},
      bars: BARS,
    });
    await tick();
    await tick();
    expect(worker.sent.find((s) => s.kind === 'subscribe:script')?.opts).toEqual({
      script: 'indicator() {}',
      encoding: 'axb1',
    });
    worker.emit({
      type: 'full',
      id: 's-w',
      sessionId: 'ses',
      seq: 5,
      payload: { count: 1, plots: [[1]], series: { a: [1] } },
    });
    await wScript;
    worker.resumes.length = 0;
    worker.emit({
      type: 'delta',
      id: 's-w',
      sessionId: 'ses',
      seq: 8,
      payload: { base_index: 0, count: 1, tail_len: 1, plots: [[2]], series: { a: [2] } },
    });
    await tick();
    expect(worker.resumes).toEqual([
      { id: 's-w', count: 1, lastTime: 100, extra: { seq: 5, encoding: 'axb1' } },
    ]);
  });
});

const raf = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    queueMicrotask(() => resolve());
  });

describe('live-wire mixed delta batch', () => {
  test('series+script deltas in one batch paint price then plots without yielding', async () => {
    const h = makeHarness({ syncApply: true });
    const seriesP = h.wire.ensureSeries('series:k', {});
    await tick();
    await tick();
    h.emit({
      type: 'full',
      id: 'series:k',
      sessionId: 'ses',
      seq: 1,
      payload: { count: 1, bars: BARS },
    });
    await seriesP;

    const scriptP = h.wire.evalScript({
      subId: 's-1',
      script: 'indicator() {}',
      meta: {},
      bars: BARS,
    });
    await tick();
    await tick();
    h.emit({
      type: 'full',
      id: 's-1',
      sessionId: 'ses',
      seq: 1,
      payload: { count: 1, plots: [[1]], series: { a: [1] } },
    });
    await scriptP;
    h.applyOrder.length = 0;
    h.applied.length = 0;
    h.seriesDelta.length = 0;

    const tip: Bar = { time: 100, open: 1, high: 2, low: 1, close: 2, volume: 1 };
    h.emitBatch([
      {
        type: 'delta',
        id: 'series:k',
        sessionId: 'ses',
        seq: 2,
        payload: { bars: [tip], forming: true, base_index: 0, count: 1, tail_len: 1 },
      },
      {
        type: 'delta',
        id: 's-1',
        sessionId: 'ses',
        seq: 2,
        payload: { base_index: 0, count: 1, tail_len: 1, plots: [[2]], series: { a: [2] } },
      },
    ]);
    expect(h.applyOrder).toEqual(['price', 'plots:stream-delta']);
    expect(h.seriesDelta).toEqual([{ bars: [tip], append: true }]);
    expect(h.applied).toEqual([{ via: 'stream-delta' }]);
  });

  test('a new tip time paints one cached script; same-slot forming only closes metrics', async () => {
    _resetV1Metrics({ warmup: 0 });
    const h = makeHarness({ syncApply: true });
    const seriesP = h.wire.ensureSeries('series:k', {});
    await tick();
    await tick();
    h.emit({
      type: 'full',
      id: 'series:k',
      sessionId: 'ses',
      seq: 1,
      payload: { count: 1, bars: BARS },
    });
    await seriesP;

    const scriptP = h.wire.evalScript({
      subId: 's-1',
      script: 'indicator() {}',
      meta: {},
      bars: BARS,
    });
    await tick();
    await tick();
    h.emit({
      type: 'full',
      id: 's-1',
      sessionId: 'ses',
      seq: 1,
      payload: { count: 1, plots: [[1]], series: { a: [1] } },
    });
    await scriptP;
    h.applyOrder.length = 0;
    h.applied.length = 0;

    const tip: Bar = { time: 100, open: 1, high: 2, low: 1, close: 2, volume: 1 };
    h.emitBatch([
      {
        type: 'delta',
        id: 'series:k',
        sessionId: 'ses',
        seq: 2,
        payload: { bars: [tip], forming: true, base_index: 0, count: 1, tail_len: 1 },
      },
      {
        type: 'delta',
        id: 'series:k',
        sessionId: 'ses',
        seq: 3,
        payload: {
          bars: [{ ...tip, close: 3 }],
          forming: true,
          base_index: 0,
          count: 1,
          tail_len: 1,
        },
      },
    ]);
    expect(h.applyOrder).toEqual(['price', 'price']);
    expect(h.applied).toEqual([]);
    await raf();
    // First new tip time paints one cached script.
    expect(h.applied).toEqual([{ via: 'stream-delta' }]);
    expect(h.applyOrder).toEqual(['price', 'price', 'plots:stream-delta']);

    h.applied.length = 0;
    h.applyOrder.length = 0;
    _resetV1Metrics({ warmup: 0 });
    // Same-slot forming tips must not reapply scripts (the p50 regression).
    v1Mark('batch:post');
    h.emitBatch([
      {
        type: 'delta',
        id: 'series:k',
        sessionId: 'ses',
        seq: 4,
        payload: {
          bars: [{ ...tip, close: 4 }],
          forming: true,
          base_index: 0,
          count: 1,
          tail_len: 1,
        },
      },
    ]);
    h.emitBatch([
      {
        type: 'delta',
        id: 'series:k',
        sessionId: 'ses',
        seq: 5,
        payload: {
          bars: [{ ...tip, close: 5 }],
          forming: true,
          base_index: 0,
          count: 1,
          tail_len: 1,
        },
      },
    ]);
    await raf();
    expect(h.applied).toEqual([]);
    expect(h.applyOrder).toEqual(['price', 'price']);
    // Light metrics close still ends queueWait once for the coalesced frame.
    expect(v1MetricsSnapshot().queueWait.n).toBe(1);

    h.applied.length = 0;
    h.applyOrder.length = 0;
    // A new tip time paints again.
    h.emitBatch([
      {
        type: 'delta',
        id: 'series:k',
        sessionId: 'ses',
        seq: 6,
        payload: {
          bars: [{ time: 160, open: 3, high: 4, low: 3, close: 4, volume: 1 }],
          forming: true,
          base_index: 1,
          count: 2,
          tail_len: 1,
        },
      },
    ]);
    await raf();
    expect(h.applied).toEqual([{ via: 'stream-delta' }]);
  });

  test('series script kick paints at most one script sub', async () => {
    const h = makeHarness({ syncApply: true });
    const seriesP = h.wire.ensureSeries('series:k', {});
    await tick();
    await tick();
    h.emit({
      type: 'full',
      id: 'series:k',
      sessionId: 'ses',
      seq: 1,
      payload: { count: 1, bars: BARS },
    });
    await seriesP;

    for (const subId of ['s-a', 's-b']) {
      const scriptP = h.wire.evalScript({
        subId,
        script: 'indicator() {}',
        meta: {},
        bars: BARS,
      });
      await tick();
      await tick();
      h.emit({
        type: 'full',
        id: subId,
        sessionId: 'ses',
        seq: 1,
        payload: { count: 1, plots: [[1]], series: { a: [1] } },
      });
      await scriptP;
    }
    h.applied.length = 0;
    h.applyOrder.length = 0;

    h.emitBatch([
      {
        type: 'delta',
        id: 'series:k',
        sessionId: 'ses',
        seq: 2,
        payload: {
          bars: [{ time: 100, open: 1, high: 2, low: 1, close: 2, volume: 1 }],
          forming: true,
          base_index: 0,
          count: 1,
          tail_len: 1,
        },
      },
    ]);
    await raf();
    // One paint closes the burst; the other sub waits for its wire frame.
    expect(h.applied).toEqual([{ via: 'stream-delta' }]);
    await tick();
    expect(h.applied).toEqual([{ via: 'stream-delta' }]);
  });

  test('holdUntilFull skips the series script kick for that sub', async () => {
    _resetV1Metrics({ warmup: 0 });
    const h = makeHarness({ syncApply: true });
    const seriesP = h.wire.ensureSeries('series:k', {});
    await tick();
    await tick();
    h.emit({
      type: 'full',
      id: 'series:k',
      sessionId: 'ses',
      seq: 1,
      payload: { count: 1, bars: BARS },
    });
    await seriesP;

    const scriptP = h.wire.evalScript({
      subId: 's-1',
      script: 'indicator() {}',
      meta: {},
      bars: BARS,
    });
    await tick();
    await tick();
    h.emit({
      type: 'full',
      id: 's-1',
      sessionId: 'ses',
      seq: 1,
      payload: { count: 1, plots: [[1]], series: { a: [1] } },
    });
    await scriptP;

    // Seq gap holds deltas until the next full.
    h.emit({
      type: 'delta',
      id: 's-1',
      sessionId: 'ses',
      seq: 99,
      payload: { base_index: 0, count: 1, tail_len: 1, plots: [[9]], series: { a: [9] } },
    });
    h.applied.length = 0;
    h.applyOrder.length = 0;
    v1Mark('batch:post');
    h.emitBatch([
      {
        type: 'delta',
        id: 'series:k',
        sessionId: 'ses',
        seq: 2,
        payload: {
          bars: [{ time: 100, open: 1, high: 2, low: 1, close: 2, volume: 1 }],
          forming: true,
          base_index: 0,
          count: 1,
          tail_len: 1,
        },
      },
    ]);
    await raf();
    await tick();
    expect(h.applied).toEqual([]);
    // No eligible script to paint; light close still ends queueWait.
    expect(v1MetricsSnapshot().queueWait.n).toBe(1);
  });

  test('a real script paint cancels the pending series kick', async () => {
    const h = makeHarness({ syncApply: true });
    const seriesP = h.wire.ensureSeries('series:k', {});
    await tick();
    await tick();
    h.emit({
      type: 'full',
      id: 'series:k',
      sessionId: 'ses',
      seq: 1,
      payload: { count: 1, bars: BARS },
    });
    await seriesP;

    const scriptP = h.wire.evalScript({
      subId: 's-1',
      script: 'indicator() {}',
      meta: {},
      bars: BARS,
    });
    await tick();
    await tick();
    h.emit({
      type: 'full',
      id: 's-1',
      sessionId: 'ses',
      seq: 1,
      payload: { count: 1, plots: [[1]], series: { a: [1] } },
    });
    await scriptP;
    h.applied.length = 0;
    h.applyOrder.length = 0;

    // Series-only schedules a kick, then a script delta lands before rAF.
    h.emitBatch([
      {
        type: 'delta',
        id: 'series:k',
        sessionId: 'ses',
        seq: 2,
        payload: {
          bars: [{ time: 100, open: 1, high: 2, low: 1, close: 2, volume: 1 }],
          forming: true,
          base_index: 0,
          count: 1,
          tail_len: 1,
        },
      },
    ]);
    h.emit({
      type: 'delta',
      id: 's-1',
      sessionId: 'ses',
      seq: 2,
      payload: {
        base_index: 0,
        count: 1,
        tail_len: 1,
        plots: [[2]],
        series: { a: [2] },
        forming: true,
      },
    });
    expect(h.applied).toEqual([{ via: 'stream-delta' }]);
    h.applied.length = 0;
    await raf();
    // Pending kick must not re-paint after the wire already closed the burst.
    expect(h.applied).toEqual([]);
  });
});
