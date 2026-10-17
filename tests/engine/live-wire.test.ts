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
  const counters = { disconnects: 0 };
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
    resumeSubscription() {},
    unsubscribe(id) {
      unsubscribed.push(id);
    },
    awaitFrame() {
      return new Promise(() => {});
    },
    addReconnectHandler() {
      return () => {};
    },
    stats() {
      return { open: true, openedOnce: true, reconnectAttempts: 3, stopped: false };
    },
  };
  const handlers: WireHandlers = {
    onStatus: (sub, status) => statuses.push({ sub, status }),
    onSeriesFull: () => {},
    onSeriesDelta: () => {},
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
  return { wire, client, sent, statuses, applied, emit, unsubscribed, counters };
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
      { subId: 'series:binance|spot|BTCUSDT|1m', kind: 'series', seq: 7, merged: false },
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
