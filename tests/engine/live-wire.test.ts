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
  const client: WireClient = {
    isOpen: true,
    onFrame: undefined,
    async connect() {},
    disconnect() {},
    subscribe(id, kind) {
      sent.push({ kind: `subscribe:${kind}`, id });
    },
    resumeSubscription() {},
    unsubscribe() {},
    awaitFrame() {
      return new Promise(() => {});
    },
    addReconnectHandler() {
      return () => {};
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
  return { wire, sent, statuses, applied, emit };
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
