/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import { StreamFallbackError, StreamLiveWire, type WireClient, type WireFrame, type WireHandlers } from '../../src/engine/live-wire';
import type { RunResult } from '../../src/plugins/types';
import type { Bar } from '../../src/store/types';

function makeHarness() {
  const sent: Array<{ kind: string; id: string }> = [];
  const statuses: Array<{ sub: string; status: string }> = [];
  const unsubscribed: string[] = [];
  const seriesFull: Bar[][] = [];
  const seriesDelta: Array<{ bars: Bar[]; append: boolean }> = [];
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
    subscribe(id, kind) {
      sent.push({ kind: `subscribe:${kind}`, id });
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
    onCloseVerified: () => {},
  };
  const applied: Array<{ via: string }> = [];
  const wire = new StreamLiveWire(
    client,
    handlers,
    (async (_script, _id, _full, via) => {
      applied.push({ via });
      return { status: 'success', plots: [], series: {}, events: [], meta: {} };
    }) as never,
  );
  const emit = (frame: WireFrame) => client.onFrame!(frame);
  return {
    wire,
    client,
    sent,
    statuses,
    applied,
    emit,
    unsubscribed,
    counters,
    seriesFull,
    seriesDelta,
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
    const realSetTimeout = globalThis.setTimeout;
    const origNow = Date.now;
    const t0 = origNow();
    let now = t0;
    Date.now = () => now;
    globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (typeof ms === 'number' && ms > 1_000) {
        now = t0 + 130_000;
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
    } finally {
      Date.now = origNow;
      globalThis.setTimeout = realSetTimeout;
    }

    expect(h.wire.cooledDown).toBe(true);
    Date.now = () => origNow() + 200_000;
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
      expect(h.sent.filter((s) => s.kind === 'subscribe:series').length).toBe(2);
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

  test('reconnect resumes every live subscription', async () => {
    const h = makeHarness();
    const p = h.wire.ensureSeries('series:k', {});
    await tick(); await tick();
    h.emit({ type: 'full', id: 'series:k', seq: 4, payload: { count: 1, bars: BARS } });
    await p;
    h.fireReconnect();
    expect(h.resumes).toEqual([{ id: 'series:k', count: 1, lastTime: 100, extra: { seq: 4 } }]);
  });
});
