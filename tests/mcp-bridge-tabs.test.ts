/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import './setup';
import { describe, expect, it, afterEach } from 'bun:test';
import { setStore } from '../src/store';
import { writeStoredCloudConfig } from '../src/storage/cloud-config';
import {
  disconnectMcpBridge,
  mcpBridgeState,
  onMcpBridge,
  refreshBridgeTabs,
} from '../src/mcp/bridge';

const realFetch = globalThis.fetch;

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
});
