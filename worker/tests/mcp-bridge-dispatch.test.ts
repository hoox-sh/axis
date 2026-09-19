/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import {
  BRIDGE_TICKET_TTL_MS,
  McpBridgeDO,
  parseBridgeTicket,
  formatBridgeTicket,
} from '../src/mcp/bridge';

class FakeWs {
  sent: string[] = [];
  attachment: unknown = null;
  serializeAttachment(v: unknown): void {
    this.attachment = v;
  }
  deserializeAttachment(): unknown {
    return this.attachment;
  }
  send(data: string): void {
    this.sent.push(data);
  }
}

class FakeStorage {
  private readonly map = new Map<string, unknown>();
  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }
  async put(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async list<T = unknown>(opts?: { prefix?: string }): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    const prefix = opts?.prefix ?? '';
    for (const [k, v] of this.map) {
      if (k.startsWith(prefix)) out.set(k, v as T);
    }
    return out;
  }
}

class FakeState {
  sockets: FakeWs[] = [];
  storage: FakeStorage;
  constructor(storage = new FakeStorage()) {
    this.storage = storage;
  }
  getWebSockets(): FakeWs[] {
    return this.sockets;
  }
  acceptWebSocket(ws: FakeWs): void {
    this.sockets.push(ws);
  }
}

function dob(state: FakeState): McpBridgeDO {
  return new McpBridgeDO(state as unknown as DurableObjectState, {});
}

if (typeof (globalThis as { WebSocketPair?: unknown }).WebSocketPair === 'undefined') {
  (globalThis as { WebSocketPair: unknown }).WebSocketPair = class WebSocketPair {
    0: FakeWs;
    1: FakeWs;
    constructor() {
      this[0] = new FakeWs();
      this[1] = new FakeWs();
    }
  };
}

async function mintNonce(bridge: McpBridgeDO): Promise<string> {
  const minted = await bridge.fetch(new Request('http://do/ticket', { method: 'POST' }));
  const body = (await minted.json()) as { nonce: string };
  return body.nonce;
}

async function upgrade(bridge: McpBridgeDO, nonce: string): Promise<Response> {
  return bridge.fetch(
    new Request(`http://do/ws?ticket=${nonce}`, {
      headers: { Upgrade: 'websocket' },
    }),
  );
}

describe('bridge ticket format', () => {
  it('round-trips userId.nonce and rejects junk', () => {
    const userId = 'a'.repeat(32);
    const nonce = 'b'.repeat(32);
    const ticket = formatBridgeTicket(userId, nonce);
    expect(parseBridgeTicket(ticket)).toEqual({ userId, nonce });
    expect(parseBridgeTicket(`pn_${'c'.repeat(48)}`)).toBeNull();
    expect(parseBridgeTicket('not-a-ticket')).toBeNull();
  });
});

describe('McpBridgeDO invoke targeting', () => {
  it('sends /invoke only to the newest attached socket', async () => {
    const state = new FakeState();
    const old = new FakeWs();
    old.serializeAttachment({ role: 'app', t: 1 });
    const neu = new FakeWs();
    neu.serializeAttachment({ role: 'app', t: 99 });
    state.sockets = [old, neu];
    const bridge = dob(state);

    const pending = bridge.fetch(
      new Request('http://do/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'inv-1', capability: 'chart.get' }),
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(neu.sent).toHaveLength(1);
    expect(old.sent).toHaveLength(0);
    const raw = neu.sent[0] ?? '';
    const frame = JSON.parse(raw) as { type: string; id: string; capability: string };
    expect(frame).toMatchObject({ type: 'invoke', id: 'inv-1', capability: 'chart.get' });

    await bridge.webSocketMessage(
      old as unknown as WebSocket,
      JSON.stringify({ type: 'error', id: 'inv-1', error: { code: 'STALE', message: 'other tab' } }),
    );
    await bridge.webSocketMessage(
      neu as unknown as WebSocket,
      JSON.stringify({ type: 'result', id: 'inv-1', result: { ok: true } }),
    );
    const res = await pending;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result?: { ok: boolean } };
    expect(body.ok).toBe(true);
    expect(body.result).toEqual({ ok: true });
  });

  it('fails pending invokes when the targeted socket closes', async () => {
    const state = new FakeState();
    const target = new FakeWs();
    target.serializeAttachment({ role: 'app', t: 2 });
    const other = new FakeWs();
    other.serializeAttachment({ role: 'app', t: 1 });
    state.sockets = [other, target];
    const bridge = dob(state);

    const pending = bridge.fetch(
      new Request('http://do/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'inv-close', capability: 'chart.get', timeoutMs: 20_000 }),
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(target.sent).toHaveLength(1);

    await bridge.webSocketClose(target as unknown as WebSocket);
    const res = await pending;
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error?: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('SESSION_OFFLINE');
  });

  it('issues one-time tickets and rejects reuse / unknown nonce on /ws', async () => {
    const bridge = dob(new FakeState());
    const nonce = await mintNonce(bridge);
    expect(nonce).toMatch(/^[a-f0-9]{32}$/);

    const noUpgrade = await bridge.fetch(new Request(`http://do/ws?ticket=${nonce}`));
    expect(noUpgrade.status).toBe(426);

    const first = await upgrade(bridge, nonce);
    expect(first.status).toBe(101);
    const reuse = await upgrade(bridge, nonce);
    expect(reuse.status).toBe(401);
  });

  it('consumes a ticket from Durable Object storage after a heap reset', async () => {
    const storage = new FakeStorage();
    const minting = dob(new FakeState(storage));
    const nonce = await mintNonce(minting);
    expect(await storage.get(`tkt:${nonce}`)).toBeGreaterThan(Date.now());

    const woken = dob(new FakeState(storage));
    const res = await upgrade(woken, nonce);
    expect(res.status).toBe(101);
    expect(await storage.get(`tkt:${nonce}`)).toBeUndefined();
  });

  it('rejects an expired stored ticket', async () => {
    const storage = new FakeStorage();
    const nonce = 'd'.repeat(32);
    await storage.put(`tkt:${nonce}`, Date.now() - BRIDGE_TICKET_TTL_MS);
    const bridge = dob(new FakeState(storage));
    const res = await upgrade(bridge, nonce);
    expect(res.status).toBe(401);
    expect(await storage.get(`tkt:${nonce}`)).toBeUndefined();
  });
});
