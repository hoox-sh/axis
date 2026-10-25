/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * `WS /api/ws/live` proxy (F-15): ticket issue/consume, URL mapping,
 * auth rejection, and route fall-through.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Axb1Opcode, TipMask } from '../../src/hp/axb1/constants';
import { encodeFrame } from '../../src/hp/axb1/encode';
import {
  _resetLiveTicketsForTests,
  engineLiveWsUrl,
  handleLiveProxy,
  relayFrame,
} from '../src/live-proxy';
import type { Env } from '../src/index';

const origin = 'http://localhost:3000';
const KEY = 'pn_' + 'ab'.repeat(24);

function req(path: string, headers?: HeadersInit): Request {
  return new Request(`https://worker.example${path}`, { headers });
}

describe('handleLiveProxy routing', () => {
  it('ignores other paths', async () => {
    expect(await handleLiveProxy(req('/api/run'), {} as Env, origin, '/api/run')).toBeNull();
  });

  it('requires upgrade or ticket issue', async () => {
    const res = await handleLiveProxy(req('/api/ws/live'), {} as Env, origin, '/api/ws/live');
    expect(res!.status).toBe(426);
  });

  it('refuses ticket issue without a key', async () => {
    _resetLiveTicketsForTests();
    const res = await handleLiveProxy(
      req('/api/ws/live?issue=ticket'),
      {} as Env,
      origin,
      '/api/ws/live',
    );
    expect(res!.status).toBe(401);
  });

  it('mints a ticket with a shape-valid key', async () => {
    _resetLiveTicketsForTests();
    const res = await handleLiveProxy(
      req('/api/ws/live?issue=ticket', { Authorization: `Bearer ${KEY}` }),
      {} as Env,
      origin,
      '/api/ws/live',
    );
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as { status: string; ticket: string; expiresIn: number };
    expect(body.status).toBe('success');
    expect(body.ticket).toMatch(/^[a-f0-9]{32}$/);
    expect(body.expiresIn).toBe(60);
  });

  it('rejects upgrades with a bad ticket', async () => {
    _resetLiveTicketsForTests();
    const bad = '0'.repeat(32);
    const res = await handleLiveProxy(
      req(`/api/ws/live?ticket=${bad}`, { Upgrade: 'websocket' }),
      {} as Env,
      origin,
      '/api/ws/live',
    );
    expect(res!.status).toBe(401);
    const body = (await res!.json()) as { code: string };
    expect(body.code).toBe('INVALID_TICKET');
  });

  it('rejects upgrades without backend configured', async () => {
    _resetLiveTicketsForTests();
    const issued = await handleLiveProxy(
      req('/api/ws/live?issue=ticket', { Authorization: `Bearer ${KEY}` }),
      {} as Env,
      origin,
      '/api/ws/live',
    );
    const { ticket } = (await issued!.json()) as { ticket: string };
    const res = await handleLiveProxy(
      req(`/api/ws/live?ticket=${ticket}`, { Upgrade: 'websocket' }),
      {} as Env,
      origin,
      '/api/ws/live',
    );
    expect(res!.status).toBe(503);
    const body = (await res!.json()) as { code: string };
    expect(body.code).toBe('NO_BACKEND');
  });
});

describe('engineLiveWsUrl', () => {
  it('maps http(s) origins to /ws/live', () => {
    expect(engineLiveWsUrl('https://pyne.example:5002/api')).toBe(
      'wss://pyne.example:5002/ws/live',
    );
    expect(engineLiveWsUrl('http://127.0.0.1:5002')).toBe('ws://127.0.0.1:5002/ws/live');
    expect(engineLiveWsUrl('ftp://x')).toBeNull();
    expect(engineLiveWsUrl('::::')).toBeNull();
  });
});

describe('relayFrame', () => {
  it('passes text through unchanged', () => {
    const frame = JSON.stringify({ type: 'auth', payload: { token: 'x' } });
    expect(relayFrame(frame)).toBe(frame);
  });

  it('passes a binary AXB1 envelope through byte-identical (never text-decoded)', () => {
    const envelope = encodeFrame({
      opcode: Axb1Opcode.HEARTBEAT,
      seq: 0,
      subIdHash: 0,
      sessionHash: 0,
      tsMs: 0n,
    });
    const buf = envelope.buffer.slice(
      envelope.byteOffset,
      envelope.byteOffset + envelope.byteLength,
    ) as ArrayBuffer;
    const out = relayFrame(buf);
    expect(out).toBeInstanceOf(ArrayBuffer);
    const bytes = new Uint8Array(out as ArrayBuffer);
    expect(bytes[0]).toBe(0x41); // 'A' of the AXB1 magic — a TextDecoder round-trip would mangle this
    expect(bytes).toEqual(envelope);
  });

  it('passes ArrayBuffer views through untouched', () => {
    const view = new Uint8Array([1, 2, 3, 4]).subarray(1, 3);
    expect(relayFrame(view)).toBe(view);
  });

  it('rejects unsupported frame types', () => {
    expect(() => relayFrame(42)).toThrow(/unsupported/);
    expect(() => relayFrame(null)).toThrow(/unsupported/);
  });

  it('reads a Blob as the original bytes (not text)', async () => {
    const text = '{"type":"pong"}';
    expect(relayFrame(text)).toBe(text);
    const buf = new Uint8Array([0x41, 0x58, 0x42, 0x31]).buffer;
    expect(relayFrame(buf)).toBe(buf);

    // 0xff / 0xfe are not valid UTF-8 — a TextDecoder pass would replace them.
    const raw = new Uint8Array([0x41, 0x58, 0x42, 0x31, 0xff, 0x00, 0xfe, 0x80]);
    const out = await relayFrame(new Blob([raw]));
    expect(out).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(out as ArrayBuffer)).toEqual(raw);
  });
});

describe('live relay keeps binary frames binary', () => {
  type Listener = (ev: { data: unknown }) => void;

  class FakeSocket {
    readonly sent: unknown[] = [];
    readonly closed: Array<{ code: number; reason: string }> = [];
    private readonly listeners = new Map<string, Listener[]>();
    accept(): void {}
    addEventListener(type: string, fn: Listener): void {
      const list = this.listeners.get(type) ?? [];
      list.push(fn);
      this.listeners.set(type, list);
    }
    send(data: unknown): void {
      this.sent.push(data);
    }
    close(code: number, reason: string): void {
      this.closed.push({ code, reason });
    }
    emit(type: string, data: unknown): void {
      for (const fn of this.listeners.get(type) ?? []) fn({ data });
    }
  }

  const g = globalThis as Record<string, unknown>;
  const savedPair = g.WebSocketPair;
  const savedWebSocket = g.WebSocket;
  let pair: [FakeSocket, FakeSocket] | null = null;
  let upstreamSocket: FakeSocket | null = null;

  class FakeWebSocketPair {
    0: FakeSocket;
    1: FakeSocket;
    constructor() {
      this[0] = new FakeSocket();
      this[1] = new FakeSocket();
      pair = [this[0], this[1]];
    }
  }
  class FakeUpstream extends FakeSocket {
    constructor(readonly url: string) {
      super();
      upstreamSocket = this;
    }
  }

  beforeAll(() => {
    g.WebSocketPair = FakeWebSocketPair;
    g.WebSocket = FakeUpstream;
  });
  afterAll(() => {
    g.WebSocketPair = savedPair;
    g.WebSocket = savedWebSocket;
  });

  async function connect(): Promise<{ client: FakeSocket; srv: FakeSocket; up: FakeSocket }> {
    _resetLiveTicketsForTests();
    const issued = await handleLiveProxy(
      req('/api/ws/live?issue=ticket', { Authorization: `Bearer ${KEY}` }),
      {} as Env,
      origin,
      '/api/ws/live',
    );
    if (!issued) throw new Error('ticket issue returned no response');
    const { ticket } = (await issued.json()) as { ticket: string };
    const res = await handleLiveProxy(
      req(`/api/ws/live?ticket=${ticket}`, { Upgrade: 'websocket' }),
      { EXTERNAL_BACKEND: 'http://engine.internal:5002' } as unknown as Env,
      origin,
      '/api/ws/live',
    );
    if (!res) throw new Error('upgrade fell through the router');
    expect(res.status).toBe(101);
    if (!pair || !upstreamSocket) throw new Error('fakes were not constructed');
    return { client: pair[0], srv: pair[1], up: upstreamSocket };
  }

  async function waitForSent(sock: { sent: unknown[] }, n: number): Promise<void> {
    for (let i = 0; i < 30; i++) {
      if (sock.sent.length >= n) return;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(`relay did not forward ${n} frame(s) (have ${sock.sent.length})`);
  }

  it('relays JSON as text and AXB1 bytes as bytes in both directions', async () => {
    const { srv, up } = await connect();

    // The pair's server end reaches the browser, so engine→client frames land on srv.send.
    up.emit('open', undefined);
    expect(srv.sent[0]).toBe(
      JSON.stringify({ type: 'status', payload: { code: 'live-relay', message: 'connected' } }),
    );

    // engine → client: JSON stays text.
    up.emit('message', '{"type":"pong"}');
    expect(srv.sent[1]).toBe('{"type":"pong"}');

    // engine → client: an AXB1 TIP_UPDATE stays an ArrayBuffer with identical bytes.
    const envelope = encodeFrame({
      opcode: Axb1Opcode.TIP_UPDATE,
      seq: 7,
      subIdHash: 1,
      sessionHash: 2,
      tsMs: 1760000000000n,
      mask: TipMask.CLOSE | TipMask.TIME,
      flags: 1,
      close: 6042550000000n,
      timeS: 1760000060,
    });
    const upBinary = envelope.buffer.slice(
      envelope.byteOffset,
      envelope.byteOffset + envelope.byteLength,
    ) as ArrayBuffer;
    up.emit('message', upBinary);
    const got = srv.sent[2];
    expect(got).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(got as ArrayBuffer)).toEqual(envelope);

    // client → engine: binary stays bytes.
    const toUp = new Uint8Array([0x41, 0x58, 0x42, 0x31, 1, 2, 3, 4]).buffer;
    srv.emit('message', toUp);
    expect(up.sent[0]).toBe(toUp);

    // client → engine: JSON control frames stay text.
    srv.emit('message', '{"type":"auth","payload":{"token":"pyne-key"}}');
    expect(up.sent[1]).toBe('{"type":"auth","payload":{"token":"pyne-key"}}');
  });

  it('keeps binary byte-identical across an upstream drop + client reconnect', async () => {
    const first = await connect();
    first.up.emit('open', undefined);

    // Upstream drops: the relay closes the server side (no auto-reconnect
    // inside the proxy — the client redials and resubscribes, HP PR 7 flow).
    first.up.emit('close', { code: 1012, reason: 'restart' });
    expect(first.srv.closed.length).toBe(1);

    // Client reconnects: fresh ticket, fresh pair, fresh upstream.
    const second = await connect();
    second.up.emit('open', undefined);
    expect(second.srv.sent[0]).toBe(
      JSON.stringify({ type: 'status', payload: { code: 'live-relay', message: 'connected' } }),
    );

    // The resubscribe is a JSON control frame and stays text.
    second.srv.emit('message', '{"type":"subscribe","id":"series:binance|spot|BTC/USDT|1m"}');
    expect(second.up.sent[0]).toBe('{"type":"subscribe","id":"series:binance|spot|BTC/USDT|1m"}');

    // And the first binary frame on the new socket is still byte-identical.
    const envelope = encodeFrame({
      opcode: Axb1Opcode.SNAPSHOT_OHLCV,
      seq: 1,
      subIdHash: 9,
      sessionHash: 3,
      tsMs: 1760000000000n,
      priceScale: 8,
      count: 2,
      closedUpto: 1,
      hotFromIndex: 0,
      timeS: [1760000000, 1760000060],
      open: [6042550000000n, 6042600000000n],
      high: [6043000000000n, 6043100000000n],
      low: [6042000000000n, 6042500000000n],
      close: [6042600000000n, 6042900000000n],
      volume: [1.5, 2.5],
      flags: [1, 0],
    });
    const bytes = envelope.buffer.slice(
      envelope.byteOffset,
      envelope.byteOffset + envelope.byteLength,
    ) as ArrayBuffer;
    second.up.emit('message', bytes);
    const got = second.srv.sent[1];
    expect(got).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(got as ArrayBuffer)).toEqual(envelope);
  });

  it('relays a Blob as the original bytes in both directions, in order', async () => {
    const { srv, up } = await connect();
    const down = new Uint8Array([0x41, 0x58, 0x42, 0x31, 0xff, 0xfe, 0x00, 0x80]);
    up.emit('message', new Blob([down]));
    // A later text frame must not overtake the in-flight Blob read.
    up.emit('message', '{"type":"pong"}');
    await waitForSent(srv, 2);
    expect(srv.sent[0]).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(srv.sent[0] as ArrayBuffer)).toEqual(down);
    expect(srv.sent[1]).toBe('{"type":"pong"}');

    const back = new Uint8Array([0x00, 0x41, 0xff, 0x7f]);
    srv.emit('message', new Blob([back]));
    srv.emit('message', new Uint8Array([1, 2, 3, 4]).buffer);
    await waitForSent(up, 2);
    expect(up.sent[0]).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(up.sent[0] as ArrayBuffer)).toEqual(back);
    expect(new Uint8Array(up.sent[1] as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('sets binaryType = arraybuffer on both legs when the socket exposes it', async () => {
    Object.defineProperty(FakeSocket.prototype, 'binaryType', {
      configurable: true,
      writable: true,
      value: 'blob',
    });
    try {
      const { srv, up } = await connect();
      expect((srv as { binaryType?: string }).binaryType).toBe('arraybuffer');
      expect((up as { binaryType?: string }).binaryType).toBe('arraybuffer');
    } finally {
      delete (FakeSocket.prototype as { binaryType?: string }).binaryType;
    }
  });

  it('still relays text when binaryType cannot be set', async () => {
    Object.defineProperty(FakeSocket.prototype, 'binaryType', {
      configurable: true,
      get() {
        return 'blob';
      },
      set() {
        throw new Error('binaryType unsupported');
      },
    });
    try {
      const { srv, up } = await connect();
      up.emit('message', '{"type":"pong"}');
      expect(srv.sent[0]).toBe('{"type":"pong"}');
      expect(() => relayFrame({ nope: true })).toThrow(/unsupported/);
    } finally {
      delete (FakeSocket.prototype as { binaryType?: string }).binaryType;
    }
  });
});
