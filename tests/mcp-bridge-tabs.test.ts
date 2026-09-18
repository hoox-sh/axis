/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import './setup';
import { describe, expect, it, afterEach } from 'bun:test';
import { clearLogs, setStore, store } from '../src/store';
import { writeStoredCloudConfig } from '../src/storage/cloud-config';
import {
  connectMcpBridge,
  disconnectMcpBridge,
  mcpBridgeState,
  onMcpBridge,
  refreshBridgeTabs,
} from '../src/mcp/bridge';

const realFetch = globalThis.fetch;
const realWebSocket = globalThis.WebSocket;

type Listener = (ev: { data?: unknown }) => void;

class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  listeners = new Map<string, Listener[]>();
  constructor(_url: string) {
    FakeSocket.instances.push(this);
  }
  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  fire(type: string, ev: { data?: unknown } = {}): void {
    if (type === 'open') this.readyState = FakeSocket.OPEN;
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
}

let sockets: FakeSocket[] = [];

function stubWebSocket(): void {
  FakeSocket.instances = [];
  sockets = FakeSocket.instances;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
}

function sock(): FakeSocket {
  const s = sockets[0];
  if (!s) throw new Error('expected a bridge socket');
  return s;
}

function stubFetch(handler: (url: string) => Response): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return handler(url);
  }) as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.WebSocket = realWebSocket;
  disconnectMcpBridge();
  setStore('pluginsConfig', 'storage:cloud', { endpoint: '', apiKey: '' });
});

describe('MCP bridge tab count', () => {
  it('null without an API key (no fetch)', async () => {
    let called = false;
    stubFetch(() => {
      called = true;
      return json({ connected: 9 });
    });
    const n = await refreshBridgeTabs();
    expect(n).toBeNull();
    expect(called).toBe(false);
    expect(mcpBridgeState().tabs).toBeNull();
  });

  it('polls the Worker session and emits state', async () => {
    writeStoredCloudConfig('https://worker.axis.hoox.sh', `pn_${'c'.repeat(48)}`);
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(url);
      return json({ status: 'ok', connected: 2 });
    });
    const states: Array<number | null> = [];
    const unsub = onMcpBridge((s) => states.push(s.tabs));
    try {
      const n = await refreshBridgeTabs();
      expect(n).toBe(2);
      expect(mcpBridgeState().tabs).toBe(2);
      expect(seen[0]).toContain('/api/mcp/bridge');
      expect(states).toContain(2);
    } finally {
      unsub();
    }
  });

  it('keeps the last-known value on failure', async () => {
    writeStoredCloudConfig('https://worker.axis.hoox.sh', `pn_${'d'.repeat(48)}`);
    stubFetch(() => json({ status: 'ok', connected: 4 }));
    expect(await refreshBridgeTabs()).toBe(4);

    stubFetch(() => {
      throw new Error('offline');
    });
    expect(await refreshBridgeTabs()).toBe(4);
    expect(mcpBridgeState().tabs).toBe(4);

    stubFetch(() => json({ status: 'error' }, 503));
    expect(await refreshBridgeTabs()).toBe(4);
    expect(mcpBridgeState().tabs).toBe(4);
  });

  it('disconnect clears the count', async () => {
    writeStoredCloudConfig('https://worker.axis.hoox.sh', `pn_${'e'.repeat(48)}`);
    stubFetch(() => json({ status: 'ok', connected: 1 }));
    expect(await refreshBridgeTabs()).toBe(1);
    disconnectMcpBridge();
    expect(mcpBridgeState().tabs).toBeNull();
  });

  it('agent invoke frames set activity + reply on the socket', async () => {
    clearLogs();
    writeStoredCloudConfig('https://worker.axis.hoox.sh', `pn_${'f'.repeat(48)}`);
    // No `version` key: the connect-triggered update check must stay a no-op.
    stubFetch(() => json({ status: 'ok', connected: 1 }));
    stubWebSocket();
    await connectMcpBridge();
    expect(sockets.length).toBe(1);
    sock().fire('open');
    // let the open-handler microtasks (hello, tabs poll, update check) settle
    await new Promise((r) => setTimeout(r, 10));
    expect(mcpBridgeState().status).toBe('open');

    sock().fire('message', {
      data: JSON.stringify({ type: 'invoke', id: 't1', capability: 'drawings.list' }),
    });
    await new Promise((r) => setTimeout(r, 10));
    const st = mcpBridgeState();
    expect(st.lastCapability).toBe('drawings.list');
    expect(typeof st.lastInvokeAt).toBe('number');
    const frames = sock().sent.map((s) => JSON.parse(s) as Record<string, unknown>);
    const reply = frames.find((f) => f.id === 't1');
    expect(reply?.type).toBe('result');
    const mcpLines = store.logs.filter((l) => l.source === 'mcp').map((l) => l.message);
    expect(mcpLines.some((m) => m.includes('bridge open'))).toBe(true);
    expect(mcpLines.some((m) => m.includes('drawings.list → ok'))).toBe(true);
  });
});
