/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Engine WebSocket URL helper + client plumbing (mocked WS).
 * Invariant: http(s)→ws(s) `/ws/run`; client reset between tests.
 * Covers connect fail, premature close, parse errors, run timeout, error frames.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  endpointToRunWsUrl,
  getEngineWsClient,
  probeEngineWs,
  _resetEngineWsClients,
} from '../src/engines/engine-ws';

describe('endpointToRunWsUrl', () => {
  it('maps http → ws and https → wss', () => {
    expect(endpointToRunWsUrl('http://localhost:5002')).toBe('ws://localhost:5002/ws/run');
    expect(endpointToRunWsUrl('https://api.example.com')).toBe('wss://api.example.com/ws/run');
  });

  it('strips trailing slash and extra path', () => {
    expect(endpointToRunWsUrl('http://127.0.0.1:5002/')).toBe('ws://127.0.0.1:5002/ws/run');
    expect(endpointToRunWsUrl('http://host:5002/api')).toBe('ws://host:5002/ws/run');
  });

  it('accepts host without scheme', () => {
    expect(endpointToRunWsUrl('localhost:5002')).toBe('ws://localhost:5002/ws/run');
  });
});

class FakeWS {
  static instances: FakeWS[] = [];
  static failConstruct = false;
  static failSend = false;
  /** When true, `close()` sets `readyState` but defers the close event. */
  static deferClose = false;
  /** Close code reported by the next close event (1000 = normal). */
  static closeCode: number | undefined = 1000;
  onopen: (() => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  readyState = 0;
  url: string;
  sent: string[] = [];

  constructor(url: string) {
    if (FakeWS.failConstruct) throw new Error('no ws');
    this.url = url;
    FakeWS.instances.push(this);
  }

  send(data: string) {
    if (FakeWS.failSend) throw new Error('send failed');
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    // Browsers dispatch the close *event* as a separate task; when
    // `deferClose` is set the test delivers it itself via `emitClose()`.
    if (!FakeWS.deferClose) this.emitClose();
  }

  /** Deliver the close event (as the browser would, long after `close()`). */
  emitClose(code: number | undefined = FakeWS.closeCode) {
    this.onclose?.({ code });
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  /** Fire onerror (connect-time or post-open). */
  error() {
    this.onerror?.();
  }

  reply(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }

  replyRaw(data: string) {
    this.onmessage?.({ data });
  }
}

describe('EngineWsClient', () => {
  const prev = globalThis.WebSocket;

  beforeEach(() => {
    FakeWS.instances = [];
    FakeWS.failConstruct = false;
    FakeWS.failSend = false;
    FakeWS.deferClose = false;
    FakeWS.closeCode = 1000;
    _resetEngineWsClients();
    (globalThis as unknown as { WebSocket: typeof FakeWS }).WebSocket = FakeWS as never;
  });

  afterEach(() => {
    _resetEngineWsClients();
    globalThis.WebSocket = prev;
  });

  it('runs over open socket and resolves result', async () => {
    const client = getEngineWsClient('http://localhost:5002');
    const connecting = client.ensureConnected();
    expect(FakeWS.instances.length).toBe(1);
    FakeWS.instances[0]!.open();
    await connecting;
    expect(client.isOpen).toBe(true);

    const p = client.run({ script: '//', data: [] }, 5_000);
    // allow send to flush
    await Promise.resolve();
    const sent = FakeWS.instances[0]!.sent[0];
    expect(sent).toBeTruthy();
    const req = JSON.parse(sent!);
    expect(req.type).toBe('run');
    FakeWS.instances[0]!.reply({
      type: 'result',
      id: req.id,
      status: 'success',
      plots: [1, 2],
      series: {},
      events: [],
    });
    const result = await p;
    expect(result.status).toBe('success');
    expect(result.transport).toBe('ws');
    expect(result.plots).toEqual([1, 2]);
  });

  it('marks dead when WebSocket constructor fails', async () => {
    FakeWS.failConstruct = true;
    const client = getEngineWsClient('http://localhost:5002');
    await expect(client.ensureConnected()).rejects.toThrow(/no ws/);
    expect(client.isDead).toBe(true);
    await expect(client.run({ script: 'x', data: [] }, 1_000)).rejects.toThrow(/dead/i);
  });

  it('marks dead on connect-time error', async () => {
    const client = getEngineWsClient('http://localhost:5002');
    const connecting = client.ensureConnected(2_000);
    expect(FakeWS.instances.length).toBe(1);
    FakeWS.instances[0]!.error();
    await expect(connecting).rejects.toThrow(/WebSocket error/);
    expect(client.isDead).toBe(true);
  });

  it('marks dead when socket closes before open', async () => {
    const client = getEngineWsClient('http://localhost:5002');
    const connecting = client.ensureConnected(2_000);
    FakeWS.instances[0]!.close();
    await expect(connecting).rejects.toThrow(/closed before open/);
    expect(client.isDead).toBe(true);
  });

  it('rejects in-flight run when socket closes mid-request', async () => {
    const client = getEngineWsClient('http://localhost:5002');
    const connecting = client.ensureConnected();
    FakeWS.instances[0]!.open();
    await connecting;

    const p = client.run({ script: 'plot(1)', data: [] }, 5_000);
    await Promise.resolve();
    FakeWS.instances[0]!.close();
    await expect(p).rejects.toThrow(/WebSocket closed/);
  });

  it('marks dead when the socket closes abnormally after open', async () => {
    // A backend whose worker double-upgrades the handshake accepts the
    // connection and then drops every frame (close 1002). The client must not
    // re-open a broken socket on the next run — REST takes over.
    FakeWS.closeCode = 1002;
    const client = getEngineWsClient('http://localhost:5002');
    const connecting = client.ensureConnected();
    FakeWS.instances[0]!.open();
    await connecting;

    const p = client.run({ script: 'plot(1)', data: [] }, 5_000);
    await Promise.resolve();
    FakeWS.instances[0]!.close();
    await expect(p).rejects.toThrow(/WebSocket closed/);
    expect(client.isDead).toBe(true);
    // Dead → the next run skips the socket entirely.
    await expect(client.run({ script: 'plot(1)', data: [] }, 1_000)).rejects.toThrow(/dead/i);
    expect(FakeWS.instances.length).toBe(1);
  });

  it('keeps the client usable after a normal close (1000)', async () => {
    const client = getEngineWsClient('http://localhost:5002');
    const connecting = client.ensureConnected();
    FakeWS.instances[0]!.open();
    await connecting;

    FakeWS.instances[0]!.close();
    expect(client.isDead).toBe(false);

    // A later run re-connects on a fresh socket.
    const second = client.ensureConnected();
    FakeWS.instances[1]!.open();
    await second;
    expect(client.isOpen).toBe(true);
  });

  it('a superseded socket close cannot tear down the live connection', async () => {
    // The connect-timeout path closes the socket and schedules nothing; the
    // close *event* can arrive after a later attempt already reconnected.
    FakeWS.deferClose = true;
    const client = getEngineWsClient('http://localhost:5002');
    const first = client.ensureConnected(10);
    const wsA = FakeWS.instances[0]!;
    await expect(first).rejects.toThrow(/timeout/i);
    expect(client.isDead).toBe(true);

    // Cool-down elapsed: the client reconnects on a fresh socket.
    (client as unknown as { deadUntil: number }).deadUntil = Date.now() - 1;
    const second = client.ensureConnected(20);
    const wsB = FakeWS.instances[1]!;
    wsB.open();
    await second;
    expect(client.isOpen).toBe(true);

    // A's close lands late: it must not null B, reject B's pending runs, or
    // mark the client dead.
    wsA.emitClose();
    expect(client.isOpen).toBe(true);
    expect(client.isDead).toBe(false);

    const p = client.run({ script: '//', data: [] }, 5_000);
    await new Promise((r) => setTimeout(r, 5));
    const req = JSON.parse(wsB.sent[0]!) as { type: string; id: string };
    expect(req.type).toBe('run');
    wsB.reply({
      type: 'result',
      id: req.id,
      status: 'success',
      plots: [1],
      series: {},
      events: [],
    });
    const result = await p;
    expect(result.status).toBe('success');
    expect(result.transport).toBe('ws');
  });

  it('resolves engine error frames as status error (not throw)', async () => {
    const client = getEngineWsClient('http://localhost:5002');
    const connecting = client.ensureConnected();
    FakeWS.instances[0]!.open();
    await connecting;

    const p = client.run({ script: 'bad', data: [] }, 5_000);
    await Promise.resolve();
    const req = JSON.parse(FakeWS.instances[0]!.sent[0]!);
    FakeWS.instances[0]!.reply({
      type: 'error',
      id: req.id,
      message: 'compile failed',
      code: 'pine_error',
    });
    const result = await p;
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/compile failed/);
    expect(result.code).toBe('pine_error');
    expect(result.transport).toBe('ws');
  });

  it('ignores malformed JSON and still accepts a later good frame', async () => {
    const client = getEngineWsClient('http://localhost:5002');
    const connecting = client.ensureConnected();
    FakeWS.instances[0]!.open();
    await connecting;

    const p = client.run({ script: '//', data: [] }, 5_000);
    await Promise.resolve();
    const req = JSON.parse(FakeWS.instances[0]!.sent[0]!);
    // Garbage + empty + non-object must not reject the pending run
    FakeWS.instances[0]!.replyRaw('not-json{{{');
    FakeWS.instances[0]!.replyRaw('');
    FakeWS.instances[0]!.replyRaw('[]');
    FakeWS.instances[0]!.replyRaw('null');
    FakeWS.instances[0]!.reply({ type: 'pong' });
    FakeWS.instances[0]!.reply({
      type: 'result',
      id: req.id,
      status: 'success',
      plots: [9],
    });
    const result = await p;
    expect(result.status).toBe('success');
    expect(result.plots).toEqual([9]);
  });

  it('times out a run with no reply and marks client dead', async () => {
    const client = getEngineWsClient('http://localhost:5002');
    const connecting = client.ensureConnected();
    FakeWS.instances[0]!.open();
    await connecting;

    const p = client.run({ script: '//', data: [] }, 40);
    await expect(p).rejects.toThrow(/run timeout/i);
    expect(client.isDead).toBe(true);
  });

  it('getEngineWsClient keeps dead client during cool-down (no thrash)', async () => {
    FakeWS.failConstruct = true;
    const dead = getEngineWsClient('http://localhost:5002');
    await expect(dead.ensureConnected()).rejects.toThrow();
    expect(dead.isDead).toBe(true);

    FakeWS.failConstruct = false;
    // Same instance while cool-down is active — avoids open-storm on every run
    const next = getEngineWsClient('http://localhost:5002');
    expect(next).toBe(dead);
    expect(next.isDead).toBe(true);
    await expect(next.ensureConnected()).rejects.toThrow(/dead/i);
  });

  it('rejects send failures without leaving a dangling pending', async () => {
    const client = getEngineWsClient('http://localhost:5002');
    const connecting = client.ensureConnected();
    FakeWS.instances[0]!.open();
    await connecting;
    FakeWS.failSend = true;
    await expect(client.run({ script: 'x', data: [] }, 1_000)).rejects.toThrow(/send failed/);
  });

  it('probeEngineWs returns false when connect fails', async () => {
    FakeWS.failConstruct = true;
    expect(await probeEngineWs('http://localhost:5002', 500)).toBe(false);
  });

  it('probeEngineWs returns true when socket opens', async () => {
    const p = probeEngineWs('http://localhost:5002', 2_000);
    // open on next microtask after constructor
    await Promise.resolve();
    FakeWS.instances[0]!.open();
    expect(await p).toBe(true);
  });

  it('client.close rejects pending and marks dead', async () => {
    const client = getEngineWsClient('http://localhost:5002');
    const connecting = client.ensureConnected();
    FakeWS.instances[0]!.open();
    await connecting;
    const p = client.run({ script: '//', data: [] }, 5_000);
    await Promise.resolve();
    client.close();
    await expect(p).rejects.toThrow(/client closed/i);
    expect(client.isDead).toBe(true);
  });
});
