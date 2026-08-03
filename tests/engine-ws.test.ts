/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
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
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
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
    this.onclose?.();
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

  it('getEngineWsClient replaces a dead client', async () => {
    FakeWS.failConstruct = true;
    const dead = getEngineWsClient('http://localhost:5002');
    await expect(dead.ensureConnected()).rejects.toThrow();
    expect(dead.isDead).toBe(true);

    FakeWS.failConstruct = false;
    const next = getEngineWsClient('http://localhost:5002');
    expect(next).not.toBe(dead);
    expect(next.isDead).toBe(false);
    const connecting = next.ensureConnected();
    FakeWS.instances[FakeWS.instances.length - 1]!.open();
    await connecting;
    expect(next.isOpen).toBe(true);
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
