import { afterEach, describe, expect, test } from 'bun:test';
import {
  Redesign2WsClient,
  endpointToRedesign2WsUrl,
} from '../../src/engine/ws-client';

describe('redesign2 websocket transport', () => {
  test('maps an HTTP endpoint to the pinned /ws/live URL', () => {
    expect(endpointToRedesign2WsUrl('https://pynescript.online/api')).toBe(
      'wss://pynescript.online/ws/live',
    );
    expect(endpointToRedesign2WsUrl('http://127.0.0.1:5002')).toBe(
      'ws://127.0.0.1:5002/ws/live',
    );
    expect(endpointToRedesign2WsUrl('https://pynescript.online', 'pn_secret')).toBe(
      'wss://pynescript.online/ws/live?api_key=pn_secret',
    );
  });

  test('constructs without opening a socket', () => {
    const client = new Redesign2WsClient({ endpoint: 'https://pynescript.online' });
    expect(client.urlValue).toBe('wss://pynescript.online/ws/live');
    expect(client.isOpen).toBe(false);
  });
});

/**
 * A socket whose lifecycle the test drives by hand. Browsers dispatch the
 * `open` / `close` events as separate tasks, so a superseded attempt's events
 * can land after a later attempt already owns the client.
 */
class ManualSocket {
  static instances: ManualSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  readyState = 0;
  sent: string[] = [];
  closeCalls = 0;

  constructor(public url: string) {
    ManualSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closeCalls += 1;
    this.readyState = 3;
    // Deliberately no `onclose`: the close *event* lands later — that delay is
    // the whole race, see `emitClose`.
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  /** Deliver the close event (as the browser would, long after `close()`). */
  emitClose() {
    this.onclose?.();
  }

  push(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  static install(): () => void {
    ManualSocket.instances = [];
    const prev = globalThis.WebSocket;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = ManualSocket;
    return () => {
      (globalThis as unknown as { WebSocket: unknown }).WebSocket = prev;
      ManualSocket.instances = [];
    };
  }
}

async function until(fn: () => boolean, ms = 500): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error('timed out waiting for condition');
}

describe('redesign2 socket ownership', () => {
  let restore: (() => void) | null = null;

  afterEach(() => {
    restore?.();
    restore = null;
  });

  /**
   * Connect attempt A, abandon it on connect timeout (the path that closes the
   * socket and schedules a reconnect), and leave attempt B created but not yet
   * open — i.e. the state where A's close event can still land.
   */
  async function abandonedAttempt() {
    const client = new Redesign2WsClient({
      endpoint: 'https://example.test',
      authToken: 'tok',
      connectTimeoutMs: 5,
      initialReconnectDelayMs: 1,
      maxReconnectDelayMs: 2,
      heartbeatIntervalMs: 60_000,
    });
    const a = client.connect();
    const wsA = ManualSocket.instances[0]!;
    await expect(a).rejects.toThrow(/timeout/i);
    await until(() => ManualSocket.instances.length === 2);
    return { client, wsA, wsB: ManualSocket.instances[1]! };
  }

  test('a superseded socket close cannot tear down the live socket', async () => {
    restore = ManualSocket.install();
    const { client, wsA, wsB } = await abandonedAttempt();
    // A's close event lands after B took over `this.ws`.
    wsA.emitClose();
    expect(client.isOpen).toBe(false);
    // B opens: its auth frame must go out. This used to throw
    // `WebSocket not open` out of the socket handler (an uncaught window error)
    // and leave the client degraded with a live socket.
    wsB.open();
    expect(client.isOpen).toBe(true);
    expect(wsB.sent.map((s) => (JSON.parse(s) as { type: string }).type)).toEqual(['auth']);
    client.disconnect();
  });

  test('a socket that opens after its attempt was abandoned is closed, not adopted', async () => {
    restore = ManualSocket.install();
    const { client, wsA, wsB } = await abandonedAttempt();
    wsA.open();
    // The late socket is closed and detached, not left live with handlers that
    // would later null the current connection out from under it.
    expect(wsA.readyState).toBe(3);
    expect(wsA.onclose).toBeNull();
    expect(wsA.closeCalls).toBeGreaterThan(0);
    expect(client.isOpen).toBe(false);
    wsB.open();
    expect(client.isOpen).toBe(true);
    client.disconnect();
  });

  test('frames from a superseded socket never reach the router', async () => {
    restore = ManualSocket.install();
    const { client, wsA, wsB } = await abandonedAttempt();
    const seen: unknown[] = [];
    client.onFrame = (f) => seen.push(f);
    wsB.open();
    wsA.push({ type: 'status', id: 's1', payload: { code: 'live' } });
    wsB.push({ type: 'status', id: 's1', payload: { code: 'live' } });
    expect(seen).toHaveLength(1);
    client.disconnect();
  });

  test('connect after disconnect can open again', async () => {
    restore = ManualSocket.install();
    const client = new Redesign2WsClient({ endpoint: 'https://example.test' });
    const first = client.connect();
    ManualSocket.instances[0]!.open();
    await first;
    client.disconnect();
    expect(client.stats().stopped).toBe(true);
    expect(client.isOpen).toBe(false);

    const second = client.connect();
    expect(client.stats().stopped).toBe(false);
    const ws2 = ManualSocket.instances[1]!;
    ws2.open();
    await second;
    expect(client.isOpen).toBe(true);
    client.disconnect();
  });

  test('a non-retryable connection error does not reconnect', async () => {
    restore = ManualSocket.install();
    const client = new Redesign2WsClient({
      endpoint: 'https://example.test',
      initialReconnectDelayMs: 5,
      maxReconnectDelayMs: 5,
      heartbeatIntervalMs: 60_000,
    });
    const first = client.connect();
    const ws1 = ManualSocket.instances[0];
    if (!ws1) throw new Error('missing socket');
    ws1.open();
    await first;
    ws1.push({
      type: 'error',
      payload: { code: 'unauthorized', message: 'bad token', retryable: false },
    });
    ws1.emitClose();
    await new Promise((r) => setTimeout(r, 30));
    expect(ManualSocket.instances.length).toBe(1);
    const again = client.connect();
    const ws2 = ManualSocket.instances[1];
    if (!ws2) throw new Error('missing retry socket');
    ws2.open();
    await again;
    expect(client.isOpen).toBe(true);
    client.disconnect();
  });

  test('disconnect with a pending reconnect does not open a second socket', async () => {
    restore = ManualSocket.install();
    const delayMs = 20;
    const client = new Redesign2WsClient({
      endpoint: 'https://example.test',
      initialReconnectDelayMs: delayMs,
      maxReconnectDelayMs: delayMs,
      heartbeatIntervalMs: 60_000,
    });
    const first = client.connect();
    const ws1 = ManualSocket.instances[0]!;
    ws1.open();
    await first;

    const origSetTimeout = globalThis.setTimeout;
    let queued: (() => void) | null = null;
    globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (typeof fn === 'function' && typeof ms === 'number' && ms <= delayMs && ms >= delayMs * 0.8) {
        queued = fn as () => void;
        return origSetTimeout(() => {}, 1_000_000);
      }
      return origSetTimeout(fn as never, ms as never, ...args);
    }) as typeof setTimeout;
    try {
      ws1.emitClose();
      expect(queued).not.toBeNull();
      expect(ManualSocket.instances.length).toBe(1);
      client.disconnect();
      queued!();
      await new Promise((r) => setTimeout(r, 0));
      expect(ManualSocket.instances.length).toBe(1);
      expect(client.isOpen).toBe(false);
      expect(client.stats().stopped).toBe(true);
    } finally {
      globalThis.setTimeout = origSetTimeout;
    }
  });

  test('connect with a token puts api_key on the URL, sends auth, and resolves on open', async () => {
    restore = ManualSocket.install();
    const client = new Redesign2WsClient({
      endpoint: 'https://example.test',
      authToken: 'tok',
      connectTimeoutMs: 200,
      heartbeatIntervalMs: 60_000,
    });
    expect(client.urlValue).toContain('api_key=tok');
    const opened = client.connect();
    const ws = ManualSocket.instances[0]!;
    ws.open();
    await opened;
    expect(ws.sent.map((s) => (JSON.parse(s) as { type: string }).type)).toEqual(['auth']);
    expect(client.isOpen).toBe(true);
    client.disconnect();
  });
});

const WORKER_KEY = `pn_${'ab'.repeat(24)}`;
const TICKET_A = 'a'.repeat(32);
const TICKET_B = 'b'.repeat(32);
const realFetch = globalThis.fetch;

describe('redesign2 Worker live tickets', () => {
  let restore: (() => void) | null = null;

  afterEach(() => {
    restore?.();
    restore = null;
    globalThis.fetch = realFetch;
  });

  function stubTickets(tickets: string[]): { urls: string[]; auths: Array<string | null> } {
    const urls: string[] = [];
    const auths: Array<string | null> = [];
    let i = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      urls.push(url);
      auths.push(new Headers(init?.headers).get('Authorization'));
      const ticket = tickets[Math.min(i, tickets.length - 1)]!;
      i += 1;
      return new Response(JSON.stringify({ status: 'success', ticket, expiresIn: 60 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    return { urls, auths };
  }

  test('mints a ticket, upgrades with ?ticket=, and keeps the engine key off the URL', async () => {
    restore = ManualSocket.install();
    const seen = stubTickets([TICKET_A]);
    const client = new Redesign2WsClient({
      endpoint: 'https://pynescript.online',
      authToken: 'pn_engine',
      liveProxy: { endpoint: 'https://worker.axis.hoox.sh', apiKey: WORKER_KEY },
      connectTimeoutMs: 200,
      heartbeatIntervalMs: 60_000,
    });
    expect(client.urlValue).toBe('wss://worker.axis.hoox.sh/api/ws/live');
    expect(client.urlValue).not.toContain('api_key');
    const opened = client.connect();
    await until(() => ManualSocket.instances.length === 1);
    const ws = ManualSocket.instances[0]!;
    expect(ws.url).toBe(`wss://worker.axis.hoox.sh/api/ws/live?ticket=${TICKET_A}`);
    expect(ws.url).not.toContain('api_key');
    expect(seen.urls).toEqual(['https://worker.axis.hoox.sh/api/ws/live?issue=ticket']);
    expect(seen.auths).toEqual([`Bearer ${WORKER_KEY}`]);
    ws.open();
    await opened;
    expect(ws.sent.map((s) => (JSON.parse(s) as { type: string }).type)).toEqual(['auth']);
    expect(JSON.parse(ws.sent[0]!) as { payload: { token: string } }).toMatchObject({
      payload: { token: 'pn_engine' },
    });
    expect(client.isOpen).toBe(true);
    client.disconnect();
  });

  test('reconnect remints a one-time ticket', async () => {
    restore = ManualSocket.install();
    stubTickets([TICKET_A, TICKET_B]);
    const client = new Redesign2WsClient({
      endpoint: 'https://pynescript.online',
      authToken: 'pn_engine',
      liveProxy: { endpoint: 'https://worker.axis.hoox.sh', apiKey: WORKER_KEY },
      connectTimeoutMs: 200,
      initialReconnectDelayMs: 1,
      maxReconnectDelayMs: 2,
      heartbeatIntervalMs: 60_000,
    });
    const first = client.connect();
    await until(() => ManualSocket.instances.length === 1);
    ManualSocket.instances[0]!.open();
    await first;
    ManualSocket.instances[0]!.emitClose();
    await until(() => ManualSocket.instances.length === 2);
    const ws2 = ManualSocket.instances[1]!;
    expect(ws2.url).toBe(`wss://worker.axis.hoox.sh/api/ws/live?ticket=${TICKET_B}`);
    expect(ws2.url).not.toContain('api_key');
    expect(ws2.url).not.toContain(TICKET_A);
    ws2.open();
    client.disconnect();
  });

  test('a 401 mint does not reconnect', async () => {
    restore = ManualSocket.install();
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: 'error' }), { status: 401 })) as typeof fetch;
    const client = new Redesign2WsClient({
      endpoint: 'https://pynescript.online',
      authToken: 'pn_engine',
      liveProxy: { endpoint: 'https://worker.axis.hoox.sh', apiKey: WORKER_KEY },
      initialReconnectDelayMs: 5,
      maxReconnectDelayMs: 5,
      heartbeatIntervalMs: 60_000,
    });
    await expect(client.connect()).rejects.toThrow(/401/);
    await new Promise((r) => setTimeout(r, 20));
    expect(ManualSocket.instances.length).toBe(0);
    client.disconnect();
  });
});