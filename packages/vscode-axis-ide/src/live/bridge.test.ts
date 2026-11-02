// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from 'bun:test';
import {
  createLiveSessionBridge,
  prepareLiveConnectUrl,
  type LiveWebSocket,
} from './bridge';
import { LIVE_WS_PATH, MCP_BRIDGE_PATH } from './ticket';
import type { LiveHudState } from './status';

const KEY = `pn_${'cd'.repeat(24)}`;
const TICKET = 'b'.repeat(32);

class MockWebSocket implements LiveWebSocket {
  static instances: MockWebSocket[] = [];
  readyState = 0;
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({});
  }

  /** Test helper — simulate open. */
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data });
  }

  emitError(): void {
    this.onerror?.({});
  }
}

function jsonOk(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  };
}

function makeBridge(
  overrides: Partial<ConstructorParameters<typeof LiveSessionBridge>[0]> = {},
) {
  MockWebSocket.instances = [];
  const statuses: LiveHudState[] = [];
  const frames: unknown[] = [];
  const lines: string[] = [];
  const bridge = createLiveSessionBridge({
    secrets: {
      getWorkerKey: async () => KEY,
    },
    workerUrl: 'https://worker.axis.hoox.sh',
    liveEnabled: true,
    fetchImpl: async () => jsonOk({ status: 'success', ticket: TICKET, expiresIn: 60 }),
    WebSocketImpl: MockWebSocket,
    output: { appendLine: (l) => lines.push(l) },
    onFrame: (f) => frames.push(f),
    onStatus: (s) => statuses.push(s),
    ...overrides,
  });
  return { bridge, statuses, frames, lines };
}

describe('LiveSessionBridge', () => {
  test('mints then connects WS with ticket= only (never pn_ / key= / mcp bridge)', async () => {
    const mintUrls: string[] = [];
    const { bridge, statuses } = makeBridge({
      fetchImpl: async (url, init) => {
        mintUrls.push(url);
        expect(init?.headers?.Authorization).toBe(`Bearer ${KEY}`);
        expect(url).toContain(`${LIVE_WS_PATH}?issue=ticket`);
        expect(url).not.toContain(KEY);
        expect(url).not.toContain(MCP_BRIDGE_PATH);
        return jsonOk({ ticket: TICKET });
      },
    });

    const result = await bridge.start();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    expect(result.ticket).toBe(TICKET);
    expect(result.wsUrl).toContain(`ticket=${TICKET}`);
    expect(result.wsUrl).toContain(LIVE_WS_PATH);
    expect(result.wsUrl).not.toContain(KEY);
    expect(result.wsUrl).not.toContain('key=');
    expect(result.wsUrl).not.toContain('api_key');
    expect(result.wsUrl).not.toContain(MCP_BRIDGE_PATH);
    expect(result.wsUrl.startsWith('wss://')).toBe(true);

    expect(MockWebSocket.instances).toHaveLength(1);
    const sock = MockWebSocket.instances[0];
    expect(sock.url).toBe(result.wsUrl);
    expect(sock.url).not.toContain(KEY);

    expect(bridge.getHudState()).toBe('degraded'); // connecting until open
    sock.open();
    expect(bridge.isConnected()).toBe(true);
    expect(bridge.getHudState()).toBe('live');
    expect(statuses).toContain('degraded');
    expect(statuses).toContain('live');
    expect(mintUrls).toHaveLength(1);
  });

  test('start fails without Worker key / when live disabled', async () => {
    const missing = makeBridge({
      secrets: { getWorkerKey: async () => undefined },
    });
    const r1 = await missing.bridge.start();
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toMatch(/Worker API key missing/i);
    expect(missing.bridge.getHudState()).toBe('degraded');

    const off = makeBridge({ liveEnabled: false });
    const r2 = await off.bridge.start();
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/disabled/i);
    expect(off.bridge.getHudState()).toBe('off');
  });

  test('mint HTTP failure surfaces scrubbed error', async () => {
    const { bridge } = makeBridge({
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ status: 'error' }),
      }),
    });
    const r = await bridge.start();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/403/);
      expect(r.error).not.toContain(KEY);
    }
  });

  test('status frames update HUD; onFrame receives payloads (Task 16 hook)', async () => {
    const { bridge, frames } = makeBridge();
    const r = await bridge.start();
    expect(r.ok).toBe(true);
    const sock = MockWebSocket.instances[0];
    sock.open();

    sock.emitMessage(JSON.stringify({ type: 'status', status: 'calculating' }));
    expect(bridge.getHudState()).toBe('degraded');
    expect(bridge.getStatusLabel().text).toMatch(/Live/);

    sock.emitMessage(JSON.stringify({ type: 'status', status: 'live' }));
    expect(bridge.getHudState()).toBe('live');

    sock.emitMessage(JSON.stringify({ type: 'delta', seq: 2, tail: [] }));
    expect(frames.some((f) => (f as { type?: string }).type === 'delta')).toBe(true);

    sock.emitMessage('{not-json');
    expect(frames).toContain('{not-json');
  });

  test('stop closes socket and returns HUD to off', async () => {
    const { bridge } = makeBridge();
    await bridge.start();
    const sock = MockWebSocket.instances[0];
    sock.open();
    expect(bridge.isConnected()).toBe(true);
    bridge.stop();
    expect(sock.closed).toBe(true);
    expect(bridge.isConnected()).toBe(false);
    expect(bridge.getHudState()).toBe('off');
    expect(bridge.getStatusLabel().tooltip).toMatch(/off/i);
  });

  test('WS error marks degraded; close clears connected', async () => {
    const { bridge } = makeBridge();
    await bridge.start();
    const sock = MockWebSocket.instances[0];
    sock.open();
    sock.emitError();
    expect(bridge.getHudState()).toBe('live'); // still connected until close
    sock.close();
    expect(bridge.getHudState()).toBe('degraded'); // errored + disconnected
  });

  test('known cloud Worker allowed without allowRemoteWorker; evil host rejected', async () => {
    const cloud = makeBridge({ allowRemoteWorker: false });
    const ok = await cloud.bridge.start();
    expect(ok.ok).toBe(true);

    const evil = makeBridge({
      allowRemoteWorker: false,
      workerUrl: 'https://attacker.example',
    });
    const denied = await evil.bridge.start();
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error).toMatch(/allowRemoteEndpoint|known AXIS Worker/i);
  });

  test('stop during mint await cancels before WebSocket open', async () => {
    let releaseKey: (() => void) | undefined;
    const keyGate = new Promise<string>((resolve) => {
      releaseKey = () => resolve(KEY);
    });
    const { bridge } = makeBridge({
      secrets: { getWorkerKey: async () => keyGate },
    });
    const pending = bridge.start();
    bridge.stop();
    releaseKey?.();
    const r = await pending;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/cancelled/i);
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  test('stop during mint HTTP failure / success / WS construct cancels', async () => {
    let releaseFail: (() => void) | undefined;
    let inFailMint = false;
    const failGate = new Promise<void>((resolve) => {
      releaseFail = () => resolve();
    });
    const midFail = makeBridge({
      fetchImpl: async () => {
        inFailMint = true;
        await failGate;
        throw new Error('mint boom');
      },
    });
    const pFail = midFail.bridge.start();
    for (let i = 0; i < 20 && !inFailMint; i += 1) await Bun.sleep(0);
    expect(inFailMint).toBe(true);
    midFail.bridge.stop();
    releaseFail?.();
    const rFail = await pFail;
    expect(rFail.ok).toBe(false);
    if (!rFail.ok) expect(rFail.error).toMatch(/cancelled/i);

    let releaseOk: (() => void) | undefined;
    let inOkMint = false;
    const okGate = new Promise<void>((resolve) => {
      releaseOk = () => resolve();
    });
    const midOk = makeBridge({
      fetchImpl: async () => {
        inOkMint = true;
        await okGate;
        return jsonOk({ status: 'success', ticket: TICKET, expiresIn: 60 });
      },
    });
    const pOk = midOk.bridge.start();
    for (let i = 0; i < 20 && !inOkMint; i += 1) await Bun.sleep(0);
    expect(inOkMint).toBe(true);
    midOk.bridge.stop();
    releaseOk?.();
    const rOk = await pOk;
    expect(rOk.ok).toBe(false);
    if (!rOk.ok) expect(rOk.error).toMatch(/cancelled/i);
    expect(MockWebSocket.instances).toHaveLength(0);

    const duringConstruct = makeBridge({
      WebSocketImpl: class implements LiveWebSocket {
        readonly url: string;
        readyState = 0;
        onopen = null;
        onmessage = null;
        onerror = null;
        onclose = null;
        constructor(url: string) {
          this.url = url;
          duringConstruct.bridge.stop();
          throw new Error('construct after stop');
        }
        send(): void {}
        close(): void {
          throw new Error('close fail');
        }
      },
    });
    const rConstruct = await duringConstruct.bridge.start();
    expect(rConstruct.ok).toBe(false);
    if (!rConstruct.ok) expect(rConstruct.error).toMatch(/cancelled/i);

    const afterConstruct = makeBridge({
      WebSocketImpl: class extends MockWebSocket {
        constructor(url: string) {
          super(url);
          afterConstruct.bridge.stop();
        }
        close(): void {
          throw new Error('close fail');
        }
      },
    });
    const rAfter = await afterConstruct.bridge.start();
    expect(rAfter.ok).toBe(false);
    if (!rAfter.ok) expect(rAfter.error).toMatch(/cancelled/i);
  });

  test('prepareLiveConnectUrl rejects unsafe URLs', () => {
    const badMcp = prepareLiveConnectUrl(`wss://w.example${MCP_BRIDGE_PATH}?ticket=${TICKET}`, KEY);
    expect(badMcp.ok).toBe(false);
    const badKey = prepareLiveConnectUrl(`wss://w.example${LIVE_WS_PATH}?key=1`, KEY);
    expect(badKey.ok).toBe(false);
    const ok = prepareLiveConnectUrl(
      `wss://worker.axis.hoox.sh${LIVE_WS_PATH}?ticket=${TICKET}`,
      KEY,
    );
    expect(ok.ok).toBe(true);
  });

  test('start rejects when buildWsUrl returns an unsafe URL', async () => {
    const { bridge } = makeBridge({
      buildWsUrl: () => `wss://evil.example${MCP_BRIDGE_PATH}?ticket=${TICKET}`,
    });
    const r = await bridge.start();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/mcp\/bridge/i);
  });

  test('swallows hostile onStatus / onFrame / output; secrets throw → missing key', async () => {
    const { bridge } = makeBridge({
      onStatus: () => {
        throw new Error('status boom');
      },
      onFrame: () => {
        throw new Error('frame boom');
      },
      output: {
        appendLine: () => {
          throw new Error('log boom');
        },
      },
    });
    const r = await bridge.start();
    expect(r.ok).toBe(true);
    const sock = MockWebSocket.instances[0];
    sock.open();
    sock.emitMessage(JSON.stringify({ type: 'status', status: 'live' }));
    sock.emitMessage(JSON.stringify({ type: 'delta', seq: 1 }));
    bridge.stop();

    const vault = makeBridge({
      secrets: {
        getWorkerKey: async () => {
          throw new Error('vault');
        },
      },
    });
    const r2 = await vault.bridge.start();
    expect(r2.ok).toBe(false);
  });

  test('WebSocket missing / constructor throw / close throw / stale generation', async () => {
    // Falsy impl is kept by ?? so the unavailable branch runs (bun has global WebSocket).
    const missing = makeBridge({
      WebSocketImpl: false as unknown as new (url: string) => LiveWebSocket,
    });
    const r0 = await missing.bridge.start();
    expect(r0.ok).toBe(false);
    if (!r0.ok) expect(r0.error).toMatch(/WebSocket/i);

    const throwing = makeBridge({
      WebSocketImpl: class implements LiveWebSocket {
        readonly url: string;
        readyState = 0;
        onopen = null;
        onmessage = null;
        onerror = null;
        onclose = null;
        constructor(url: string) {
          this.url = url;
          throw new Error('construct fail');
        }
        send(): void {}
        close(): void {}
      },
    });
    const r1 = await throwing.bridge.start();
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toMatch(/construct fail/i);

    const { bridge } = makeBridge({
      WebSocketImpl: class extends MockWebSocket {
        close(): void {
          throw new Error('close fail');
        }
      },
    });
    await bridge.start();
    expect(() => bridge.stop()).not.toThrow();

    const gen = makeBridge();
    await gen.bridge.start();
    const sock = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    gen.bridge.stop();
    // Stale callbacks after stop must no-op (handlers nulled + generation bump).
    sock.open();
    sock.emitError();
    sock.emitMessage('{}');
    expect(gen.bridge.getHudState()).toBe('off');
  });

  test('wire status idle/error → degraded; kind=status supported', async () => {
    const { bridge } = makeBridge();
    await bridge.start();
    const sock = MockWebSocket.instances[0];
    sock.open();
    sock.emitMessage(JSON.stringify({ kind: 'status', status: 'idle' }));
    expect(bridge.getHudState()).toBe('degraded');
    sock.emitMessage(JSON.stringify({ type: 'status', status: 'error' }));
    expect(bridge.getHudState()).toBe('degraded');
  });

  test('markDegraded sets HUD degraded while socket stays up', async () => {
    const { bridge, lines } = makeBridge();
    await bridge.start();
    const sock = MockWebSocket.instances[0];
    sock.open();
    expect(bridge.getHudState()).toBe('live');
    bridge.markDegraded('seq-gap');
    expect(bridge.isConnected()).toBe(true);
    expect(bridge.getHudState()).toBe('degraded');
    expect(lines.some((l) => l.includes('live degraded: seq-gap'))).toBe(true);
  });
});
