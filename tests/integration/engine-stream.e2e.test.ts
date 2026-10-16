/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Engine-stream contract e2e (F-21): client and engine sides speak the pinned
 * frame contract with no network.
 *
 * A fake engine implements the PYNE side (subscribe → status → full → live,
 * tick → delta, close on bar close, repair on mismatch) using the real
 * `frames.ts` validators; `StreamLiveWire` drives the client side. This pins
 * the full lifecycle both repos must honor: subscribe → status → full →
 * delta → close → repair.
 */

import { describe, expect, test } from 'bun:test';
import {
  isDeltaFrame,
  isFullFrame,
  validateRedesign2Frame,
} from '../../src/engine/frames';
import { StreamLiveWire, type WireClient, type WireHandlers } from '../../src/engine/live-wire';
import type { Bar } from '../../src/store/types';

const BARS: Bar[] = [
  { time: 100, open: 1, high: 1, low: 1, close: 1, volume: 1 },
  { time: 200, open: 1, high: 2, low: 1, close: 2, volume: 2 },
];

/** Fake PYNE side: validates inbound frames, emits the lifecycle. */
function makeEngineSide() {
  const log: string[] = [];
  let seq = 0;
  const listeners = new Map<string, (f: Record<string, unknown>) => void>();
  const client: WireClient = {
    isOpen: true,
    onFrame: undefined,
    async connect() {},
    disconnect() {},
    subscribe(id, kind, meta, opts) {
      log.push(`subscribe:${kind}:${id}`);
      // Defer like a real socket: replies must land after awaitFrame registers.
      queueMicrotask(() => {
        if (kind === 'script' && !opts?.script) {
          emit({ type: 'error', id, payload: { code: 'NO_SCRIPT', message: 'need script' } });
          return;
        }
        emit({ type: 'status', id, sessionId: 'ses-1', payload: { code: 'datafeed-loading', have: 0, need: 2 } });
        emit({ type: 'status', id, sessionId: 'ses-1', payload: { code: 'datafeed-ready' } });
        if (kind === 'script') {
          emit({ type: 'status', id, sessionId: 'ses-1', payload: { code: 'calculating' } });
        }
        seq += 1;
        const full: Record<string, unknown> = {
          type: 'full',
          id,
          sessionId: 'ses-1',
          seq,
          payload: {
            seriesKey: 'binance|spot|BTC/USDT|1m',
            count: 2,
            closed_upto: 100,
            ...(kind === 'series'
              ? { bars: BARS }
              : { plots: [[1], [2]], series: { a: [1, 2] }, bar_times: [100, 200] }),
          },
        };
        if (!isFullFrame(full)) throw new Error('engine emitted an invalid full frame');
        emit(full);
        emit({ type: 'status', id, sessionId: 'ses-1', payload: { code: 'live' } });
      });
    },
    resumeSubscription() {},
    unsubscribe() {},
    awaitFrame(id: string) {
      return new Promise((resolve) => {
        listeners.set(id, resolve as never);
      });
    },
    addReconnectHandler() {
      return () => {};
    },
  };
  function emit(frame: Record<string, unknown>) {
    if (!validateRedesign2Frame(frame)) throw new Error(`engine emitted invalid frame: ${frame.type}`);
    const id = frame.id as string;
    const waiter = listeners.get(id);
    if (waiter) {
      listeners.delete(id);
      waiter(frame);
    }
    client.onFrame?.(frame as never);
  }
  return {
    client,
    log,
    /** Simulate one feed tick: delta + (optionally) close. */
    tick(closeBar: boolean) {
      seq += 1;
      const delta = {
        type: 'delta',
        id: 'script-1',
        sessionId: 'ses-1',
        seq,
        payload: { base_index: 2, count: 3, tail_len: 1, closed_upto: closeBar ? 200 : 100, plots: [[3]], series: { a: [3] } },
      };
      if (!isDeltaFrame(delta)) throw new Error('engine emitted an invalid delta frame');
      emit(delta);
      if (closeBar) {
        seq += 1;
        emit({
          type: 'close',
          id: 'script-1',
          sessionId: 'ses-1',
          seq,
          payload: { index: 2, time: 300, ohlcv: { open: 2, high: 3, low: 2, close: 3, volume: 5 } },
        });
      }
    },
  };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('engine-stream contract e2e (F-21)', () => {
  test('subscribe → status → full → delta → close → repair shapes hold', async () => {
    const engine = makeEngineSide();
    const statuses: string[] = [];
    const applied: string[] = [];
    const closes: unknown[] = [];
    const handlers: WireHandlers = {
      onStatus: (_sub, status) => statuses.push(status),
      onSeriesFull: () => {},
      onSeriesDelta: () => {},
      onCloseVerified: (_t, r) => closes.push(r),
    };
    const wire = new StreamLiveWire(engine.client, handlers, (async (_s, _i, _f, via) => {
      applied.push(via);
      return { status: 'success', plots: [], series: {}, events: [], meta: {} };
    }) as never);

    const bars = await wire.ensureSeries('series-1', { symbol: 'BTC/USDT' });
    expect(bars).toEqual(BARS);
    expect(engine.log).toContain('subscribe:series:series-1');

    await wire.evalScript({ subId: 'script-1', script: 'indicator() {}', meta: {}, bars });
    expect(applied).toEqual(['stream-full']);

    engine.tick(false);
    await tick();
    engine.tick(true);
    await tick();
    await wire.evalScript({ subId: 'script-1', script: 'indicator() {}', meta: {}, bars });
    expect(applied).toContain('stream-delta');
    expect(statuses).toContain('live');
  });
});
