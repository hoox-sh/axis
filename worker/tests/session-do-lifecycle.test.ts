/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Env } from '../src/index';
import { SessionDO } from '../src/durable-objects/session';

class FakeClientWs {
  closed: { code: number; reason: string } | null = null;
  sent: string[] = [];
  addEventListener(_type: string, _fn: (...args: unknown[]) => void): void {
    /* hibernation path must not rely on these */
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.closed = { code: code ?? 1000, reason: reason ?? '' };
  }
}

class StubUpstreamWs {
  static instances: StubUpstreamWs[] = [];
  url: string;
  closed = false;
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  constructor(url: string) {
    this.url = url;
    StubUpstreamWs.instances.push(this);
  }

  addEventListener(type: string, fn: (...args: unknown[]) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  send(_data: string): void {}

  close(): void {
    this.closed = true;
    for (const fn of this.listeners.get('close') ?? []) fn();
  }
}

class FakeState {
  sockets: FakeClientWs[] = [];
  blockCalls = 0;

  acceptWebSocket(ws: FakeClientWs): void {
    this.sockets.push(ws);
  }

  async blockConcurrencyWhile<T>(fn: () => Promise<T> | T): Promise<T> {
    this.blockCalls += 1;
    return await fn();
  }
}

type SessProbe = {
  clients: FakeClientWs[];
  upstream: StubUpstreamWs | null;
  venue: string;
  symbol: string;
  interval: string;
};

function dob(state: FakeState): SessionDO {
  return new SessionDO(state as unknown as DurableObjectState, {} as Env);
}

function sessOf(doInst: SessionDO): SessProbe {
  return (doInst as unknown as { sess: SessProbe }).sess;
}

const OriginalWebSocket = globalThis.WebSocket;
const OriginalWebSocketPair = (globalThis as { WebSocketPair?: unknown }).WebSocketPair;

beforeEach(() => {
  StubUpstreamWs.instances = [];
  (globalThis as { WebSocket: unknown }).WebSocket = StubUpstreamWs;
  (globalThis as { WebSocketPair: unknown }).WebSocketPair = class WebSocketPair {
    0: FakeClientWs;
    1: FakeClientWs;
    constructor() {
      this[0] = new FakeClientWs();
      this[1] = new FakeClientWs();
    }
  };
});

afterEach(() => {
  (globalThis as { WebSocket: unknown }).WebSocket = OriginalWebSocket;
  if (OriginalWebSocketPair === undefined) {
    delete (globalThis as { WebSocketPair?: unknown }).WebSocketPair;
  } else {
    (globalThis as { WebSocketPair: unknown }).WebSocketPair = OriginalWebSocketPair;
  }
});

describe('SessionDO concurrency + hibernation lifecycle', () => {
  it('accepts /ws under blockConcurrencyWhile without close/error listeners', async () => {
    const state = new FakeState();
    const session = dob(state);
    const res = await session.fetch(
      new Request('http://do/ws?venue=binance&symbol=ETHUSDT&interval=5m', {
        headers: { Upgrade: 'websocket' },
      }),
    );
    expect(res.status).toBe(101);
    expect(state.blockCalls).toBe(1);
    expect(state.sockets).toHaveLength(1);

    const probe = sessOf(session);
    expect(probe.symbol).toBe('ETHUSDT');
    expect(probe.interval).toBe('5m');
    expect(probe.clients).toHaveLength(1);
    expect(StubUpstreamWs.instances).toHaveLength(1);
    expect(probe.upstream).toBe(StubUpstreamWs.instances[0] ?? null);
  });

  it('webSocketClose removes client and closes upstream only when last', async () => {
    const state = new FakeState();
    const session = dob(state);
    const a = new FakeClientWs();
    const b = new FakeClientWs();
    const upstream = new StubUpstreamWs('wss://example');
    const probe = sessOf(session);
    probe.clients = [a, b];
    probe.upstream = upstream;

    await session.webSocketClose(a as unknown as WebSocket, 1000, 'bye', true);
    expect(state.blockCalls).toBe(1);
    expect(probe.clients).toEqual([b]);
    expect(upstream.closed).toBe(false);
    expect(a.closed).toEqual({ code: 1000, reason: 'bye' });

    await session.webSocketClose(b as unknown as WebSocket, 1001, 'gone', true);
    expect(state.blockCalls).toBe(2);
    expect(probe.clients).toEqual([]);
    expect(upstream.closed).toBe(true);
    expect(probe.upstream).toBeNull();
  });

  it('webSocketError detaches one client without killing upstream for siblings', async () => {
    const state = new FakeState();
    const session = dob(state);
    const a = new FakeClientWs();
    const b = new FakeClientWs();
    const upstream = new StubUpstreamWs('wss://example');
    const probe = sessOf(session);
    probe.clients = [a, b];
    probe.upstream = upstream;

    await session.webSocketError(a as unknown as WebSocket, new Error('boom'));
    expect(state.blockCalls).toBe(1);
    expect(probe.clients).toEqual([b]);
    expect(upstream.closed).toBe(false);
    expect(probe.upstream).toBe(upstream);

    await session.webSocketError(b as unknown as WebSocket, new Error('boom2'));
    expect(state.blockCalls).toBe(2);
    expect(probe.clients).toEqual([]);
    expect(upstream.closed).toBe(true);
    expect(probe.upstream).toBeNull();
  });

  it('subscribe rebind runs inside blockConcurrencyWhile', async () => {
    const state = new FakeState();
    const session = dob(state);
    const client = new FakeClientWs();
    const probe = sessOf(session);
    probe.clients = [client];
    probe.venue = 'binance';
    probe.symbol = 'BTCUSDT';
    probe.interval = '1m';
    probe.upstream = new StubUpstreamWs('wss://old');

    const blocksBefore = state.blockCalls;
    await session.webSocketMessage(
      client as unknown as WebSocket,
      JSON.stringify({ action: 'subscribe', symbol: 'ETHUSDT', interval: '5m' }),
    );
    expect(state.blockCalls).toBe(blocksBefore + 1);
    expect(probe.symbol).toBe('ETHUSDT');
    expect(probe.interval).toBe('5m');
    expect(StubUpstreamWs.instances.length).toBeGreaterThanOrEqual(2);
    expect(probe.upstream).toBe(StubUpstreamWs.instances[StubUpstreamWs.instances.length - 1] ?? null);
  });

  it('ping does not take the concurrency lock', async () => {
    const state = new FakeState();
    const session = dob(state);
    const client = new FakeClientWs();
    const blocksBefore = state.blockCalls;
    await session.webSocketMessage(
      client as unknown as WebSocket,
      JSON.stringify({ action: 'ping' }),
    );
    expect(state.blockCalls).toBe(blocksBefore);
    expect(client.sent.length).toBe(1);
    const body = JSON.parse(client.sent[0] ?? '{}') as { action?: string };
    expect(body.action).toBe('pong');
  });
});
