/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Live multiplex start/stop lifecycle on active stream plugins.
 * Invariant: stop cleans handlers; restart does not leak prior sockets;
 * stop-during-reconnect and double-start are safe.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { registry } from '../src/plugins/registry';
import { ensureBuiltins, _resetBootstrapFlag } from '../src/plugins/bootstrap';
import { _resetSourceRegistrationFlag } from '../src/sources/catalog';
import {
  _resetStreamRegistrationFlag,
  registerDynamicStream,
} from '../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import { setStore, store, clearLogs } from '../src/store';
import {
  startLive,
  stopLive,
  getAvailableStreams,
  _resetMultiplexForTests,
  _getLiveEpochForTests,
} from '../src/streams/multiplex';

beforeEach(() => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  ensureBuiltins();
  clearLogs();
  _resetMultiplexForTests();
  setStore('bars', [
    { time: 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
  ]);
  setStore('scripts', []);
  setStore('symbol', 'BTCUSDT');
  setStore('interval', '1m');
  setStore('live', { active: false, needsRerun: false, lastBarTime: 0, streamId: 'mock-poll' });
  setStore('source', 'mock-walk');
  setStore('stream', { status: 'disconnected' });
  stopLive();
});

afterEach(() => {
  stopLive();
  _resetMultiplexForTests();
});

describe('multiplex', () => {
  it('getAvailableStreams non-empty', () => {
    expect(getAvailableStreams().length).toBeGreaterThan(0);
  });

  it('startLive with dynamic stream appends bars and stopLive cleans up', async () => {
    let stopped = false;
    registerDynamicStream({
      id: 'test-mux-stream',
      name: 'Mux Test',
      kind: 'stream',
      start({ onBar, onStatus }) {
        onStatus({ state: 'open', detail: 'test' });
        const t = setInterval(() => {
          onBar({
            time: Math.floor(Date.now() / 1000),
            open: 2,
            high: 2,
            low: 2,
            close: 2,
            volume: 1,
          });
        }, 30);
        return () => {
          stopped = true;
          clearInterval(t);
        };
      },
    });

    const before = store.bars.length;
    startLive('test-mux-stream', 'BTCUSDT', '1m');
    expect(store.live.active).toBe(true);
    expect(store.stream.status).toBe('connected');

    await new Promise((r) => setTimeout(r, 80));
    expect(store.bars.length).toBeGreaterThanOrEqual(before);

    stopLive();
    expect(stopped).toBe(true);
    expect(store.live.active).toBe(false);
    expect(store.stream.status).toBe('disconnected');
  });

  it('startLive falls back when stream id unknown', () => {
    setStore('source', 'mock-walk');
    startLive('totally-missing', 'BTCUSDT', '1m');
    expect(store.live.streamId).toBe('mock-poll');
    expect(store.live.active).toBe(true);
    stopLive();
  });

  it('double-start stops prior session without leaking stop handlers', () => {
    const stops: string[] = [];
    let activeSessions = 0;
    registerDynamicStream({
      id: 'double-start-stream',
      name: 'Double',
      kind: 'stream',
      start({ onStatus, symbol }) {
        activeSessions += 1;
        onStatus({ state: 'open', detail: symbol });
        return () => {
          activeSessions -= 1;
          stops.push(symbol);
        };
      },
    });

    startLive('double-start-stream', 'AAA', '1m');
    expect(store.live.active).toBe(true);
    expect(activeSessions).toBe(1);

    startLive('double-start-stream', 'BBB', '5m');
    expect(store.live.active).toBe(true);
    expect(activeSessions).toBe(1);
    expect(stops).toEqual(['AAA']);
    expect(store.stream.status).toBe('connected');

    stopLive();
    expect(activeSessions).toBe(0);
    expect(stops).toEqual(['AAA', 'BBB']);
    expect(store.live.active).toBe(false);
  });

  it('stop during reconnect cancels session; no late status flips active', async () => {
    let stopFn: (() => void) | null = null;
    let fireClosed: (() => void) | null = null;
    let fireReconnect: (() => void) | null = null;
    registerDynamicStream({
      id: 'reconnect-stream',
      name: 'RC',
      kind: 'stream',
      start({ onStatus }) {
        onStatus({ state: 'open' });
        fireReconnect = () => onStatus({ state: 'reconnecting', detail: 'attempt 1/8' });
        fireClosed = () => onStatus({ state: 'closed' });
        stopFn = () => {
          /* stream stop */
        };
        return () => {
          stopFn?.();
        };
      },
    });

    startLive('reconnect-stream', 'BTCUSDT', '1m');
    expect(store.live.active).toBe(true);
    expect(store.stream.status).toBe('connected');

    fireReconnect?.();
    expect(store.stream.status).toBe('connecting');
    expect(store.telemetry.stream.state).toBe('degraded');

    stopLive();
    expect(store.live.active).toBe(false);
    expect(store.stream.status).toBe('disconnected');

    // Late callbacks from the dead session must not revive live
    fireReconnect?.();
    fireClosed?.();
    expect(store.live.active).toBe(false);
    expect(store.stream.status).toBe('disconnected');
  });

  it('mid-reconnect symbol/interval change restarts cleanly', async () => {
    const started: string[] = [];
    let pushReconnect: (() => void) | null = null;
    registerDynamicStream({
      id: 'symbol-change-stream',
      name: 'SC',
      kind: 'stream',
      start({ onStatus, symbol, interval }) {
        started.push(`${symbol}@${interval}`);
        onStatus({ state: 'open', detail: `${symbol} ${interval}` });
        pushReconnect = () =>
          onStatus({ state: 'reconnecting', detail: `retry ${symbol}` });
        return () => {
          pushReconnect = null;
        };
      },
    });

    startLive('symbol-change-stream', 'ETHUSDT', '1m');
    expect(started).toEqual(['ETHUSDT@1m']);
    pushReconnect?.();
    expect(store.stream.status).toBe('connecting');

    // Change symbol while "reconnecting"
    startLive('symbol-change-stream', 'BTCUSDT', '5m');
    expect(started).toEqual(['ETHUSDT@1m', 'BTCUSDT@5m']);
    expect(store.live.active).toBe(true);
    expect(store.stream.status).toBe('connected');
    expect(store.telemetry.stream.detail).toMatch(/BTCUSDT/);

    stopLive();
    expect(store.live.active).toBe(false);
  });

  it('stream onError clears live.active and keeps error telemetry', async () => {
    registerDynamicStream({
      id: 'err-live-stream',
      name: 'ErrLive',
      kind: 'stream',
      start({ onStatus, onError }) {
        onStatus({ state: 'open' });
        setTimeout(() => onError(new Error('boom-live')), 5);
        return () => {};
      },
    });

    startLive('err-live-stream', 'BTCUSDT', '1m');
    expect(store.live.active).toBe(true);

    await new Promise((r) => setTimeout(r, 40));
    expect(store.live.active).toBe(false);
    expect(store.stream.status).toBe('error');
    expect(store.telemetry.stream.state).toBe('error');
    expect(store.telemetry.stream.error).toMatch(/boom-live/);
  });

  it('stale onBar after stop does not append', async () => {
    let injectBar: ((b: {
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }) => void) | null = null;
    registerDynamicStream({
      id: 'stale-bar-stream',
      name: 'Stale',
      kind: 'stream',
      start({ onBar, onStatus }) {
        onStatus({ state: 'open' });
        injectBar = onBar;
        return () => {
          injectBar = onBar; // keep ref intentionally (malicious plugin)
        };
      },
    });

    startLive('stale-bar-stream', 'BTCUSDT', '1m');
    const before = store.bars.length;
    stopLive();
    injectBar?.({
      time: 99999,
      open: 9,
      high: 9,
      low: 9,
      close: 9,
      volume: 1,
    });
    expect(store.bars.length).toBe(before);
    expect(store.live.active).toBe(false);
  });

  it('stopLive is re-entrant safe', () => {
    registerDynamicStream({
      id: 'reenter-stream',
      name: 'Re',
      kind: 'stream',
      start({ onStatus }) {
        onStatus({ state: 'open' });
        return () => {
          // Nested stop during plugin teardown
          stopLive();
        };
      },
    });
    startLive('reenter-stream', 'BTCUSDT', '1m');
    expect(() => stopLive()).not.toThrow();
    expect(store.live.active).toBe(false);
    expect(_getLiveEpochForTests()).toBeGreaterThan(0);
  });
});
