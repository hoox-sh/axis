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
  const counters = { disconnects: 0 };
  let reconnect: (() => void) | undefined;
  const client: WireClient = {
    isOpen: true,
    onFrame: undefined,
    async connect() {},
    disconnect() {
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
      return { open: true, openedOnce: true, reconnectAttempts: 3, stopped: false };
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
