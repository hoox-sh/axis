/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained) (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Reconnectable WebSocket helper + exponential backoff math.
 * Guards open/retry/cap, stop cancels reconnect, double-stop, exhaust.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  nextBackoffMs,
  openReconnectableWs,
  RECONNECT_DEFAULTS,
} from '../src/streams/reconnect-ws';

describe('nextBackoffMs', () => {
  it('grows exponentially and caps', () => {
    expect(nextBackoffMs(1, 1000, 30_000)).toBe(1000);
    expect(nextBackoffMs(2, 1000, 30_000)).toBe(2000);
    expect(nextBackoffMs(3, 1000, 30_000)).toBe(4000);
    expect(nextBackoffMs(10, 1000, 30_000)).toBe(30_000);
  });

  it('never exceeds maxDelayMs for large attempts', () => {
    expect(nextBackoffMs(50, 1000, 30_000)).toBe(30_000);
    expect(nextBackoffMs(0, 500, 2_000)).toBe(500);
  });

  it('defaults match RECONNECT_DEFAULTS', () => {
    expect(nextBackoffMs(1)).toBe(RECONNECT_DEFAULTS.baseDelayMs);
    expect(nextBackoffMs(20)).toBe(RECONNECT_DEFAULTS.maxDelayMs);
  });
});

class FakeWS {
  static instances: FakeWS[] = [];
  static shouldFailConstruct = false;
  onopen: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  readyState = 0;
  url: string;
  closeCount = 0;

  constructor(url: string) {
    if (FakeWS.shouldFailConstruct) throw new Error('construct fail');
    this.url = url;
    FakeWS.instances.push(this);
  }

  close() {
    this.closeCount += 1;
    this.readyState = 3;
    // Honor nulled handlers (real browsers keep the property null)
    this.onclose?.({});
  }

  open() {
    this.readyState = 1;
    this.onopen?.({});
  }

  emitMessage(data: string) {
    this.onmessage?.({ data });
  }

  /** Simulate server-side drop without going through close() helper. */
  drop() {
    this.readyState = 3;
    this.onclose?.({});
  }
}

describe('openReconnectableWs', () => {
  const prevWS = globalThis.WebSocket;
  const WS_URL = 'wss://example.test/ws';

  beforeEach(() => {
    FakeWS.instances = [];
    FakeWS.shouldFailConstruct = false;
    (globalThis as unknown as { WebSocket: typeof FakeWS }).WebSocket = FakeWS as never;
  });

  afterEach(() => {
    globalThis.WebSocket = prevWS;
  });

  /**
   * Only the sockets this test's own client opened. Another test file can
   * leave a reconnecting socket behind; when its pending timer fires while
   * this file runs, the socket lands in the shared array and would skew the
   * counts. The URL is the discriminator.
   */
  const ownSockets = (url: string = WS_URL): FakeWS[] =>
    FakeWS.instances.filter((s) => s.url === url);

  /** Wait until the client has opened at least `n` of its own sockets. */
  const waitForSockets = async (n: number, timeoutMs = 2_000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (ownSockets().length < n && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(ownSockets().length).toBeGreaterThanOrEqual(n);
  };

  it('opens and delivers messages', () => {
    const statuses: string[] = [];
    const bars: string[] = [];
    const stop = openReconnectableWs({
      url: 'wss://example.test/ws',
      onStatus: (s) => statuses.push(s.state),
      onError: () => {},
      onMessage: (e) => bars.push(String(e.data)),
    });
    expect(ownSockets().length).toBe(1);
    ownSockets()[0]!.open();
    expect(statuses).toContain('open');
    ownSockets()[0]!.emitMessage('hello');
    expect(bars).toEqual(['hello']);
    stop();
    expect(statuses.at(-1)).toBe('closed');
  });

  it('reconnects after unexpected close', async () => {
    const statuses: string[] = [];
    const stop = openReconnectableWs({
      url: 'wss://example.test/ws',
      maxAttempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 50,
      onStatus: (s) => statuses.push(s.state),
      onError: () => {},
      onMessage: () => {},
    });
    ownSockets()[0]!.open();
    ownSockets()[0]!.drop(); // unexpected — not stopped
    expect(statuses).toContain('reconnecting');
    await waitForSockets(2);
    stop();
  });

  it('stop during reconnect cancels timer and creates no further sockets', async () => {
    const statuses: string[] = [];
    const stop = openReconnectableWs({
      url: 'wss://example.test/ws',
      maxAttempts: 8,
      baseDelayMs: 80,
      maxDelayMs: 200,
      onStatus: (s) => statuses.push(s.state),
      onError: () => {},
      onMessage: () => {},
    });
    ownSockets()[0]!.open();
    ownSockets()[0]!.drop();
    expect(statuses).toContain('reconnecting');
    const countWhileReconnecting = ownSockets().length;
    stop();
    expect(statuses.at(-1)).toBe('closed');
    await new Promise((r) => setTimeout(r, 120));
    expect(ownSockets().length).toBe(countWhileReconnecting);
  });

  it('double stop is idempotent', () => {
    const statuses: string[] = [];
    const stop = openReconnectableWs({
      url: 'wss://example.test/ws',
      onStatus: (s) => statuses.push(s.state),
      onError: () => {},
      onMessage: () => {},
    });
    ownSockets()[0]!.open();
    stop();
    stop();
    stop();
    expect(statuses.filter((s) => s === 'closed')).toHaveLength(1);
  });

  it('exhausts reconnect and fires onError once', async () => {
    const statuses: string[] = [];
    const errors: string[] = [];
    openReconnectableWs({
      url: 'wss://example.test/ws',
      maxAttempts: 2,
      baseDelayMs: 5,
      maxDelayMs: 10,
      onStatus: (s) => statuses.push(s.state),
      onError: (e) => errors.push(e.message),
      onMessage: () => {},
    });
    // Fail first connect without ever opening
    ownSockets()[0]!.drop();
    await waitForSockets(2); // second attempt socket
    ownSockets()[1]!.drop();
    await waitForSockets(3);
    // third failure → exhaust (attempt 3 > max 2)
    ownSockets()[2]!.drop();
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/failed to connect|exhausted/i);
    expect(statuses).toContain('closed');
    const after = ownSockets().length;
    expect(after).toBe(3);
    await new Promise((r) => setTimeout(r, 60));
    expect(ownSockets().length).toBe(after); // no more reconnects
  });

  it('calls onError when construct fails', () => {
    FakeWS.shouldFailConstruct = true;
    let err: Error | null = null;
    openReconnectableWs({
      url: 'wss://bad',
      onStatus: () => {},
      onError: (e) => {
        err = e;
      },
      onMessage: () => {},
    });
    expect(err).toBeTruthy();
    expect(err!.message).toMatch(/construct|fail/i);
  });

  it('ignores messages after stop', () => {
    const bars: string[] = [];
    const stop = openReconnectableWs({
      url: 'wss://example.test/ws',
      onStatus: () => {},
      onError: () => {},
      onMessage: (e) => bars.push(String(e.data)),
    });
    const sock = FakeWS.instances[0]!;
    sock.open();
    sock.emitMessage('a');
    stop();
    // Even if a late handler still fires somehow
    sock.onmessage?.({ data: 'b' });
    expect(bars).toEqual(['a']);
  });

  it('stop nulls handlers so close does not reconnect', async () => {
    const statuses: string[] = [];
    const stop = openReconnectableWs({
      url: 'wss://example.test/ws',
      maxAttempts: 5,
      baseDelayMs: 10,
      maxDelayMs: 20,
      onStatus: (s) => statuses.push(s.state),
      onError: () => {},
      onMessage: () => {},
    });
    const sock = FakeWS.instances[0]!;
    sock.open();
    stop();
    // Late drop after stop must not schedule reconnect sockets
    const before = FakeWS.instances.length;
    sock.drop();
    await new Promise((r) => setTimeout(r, 40));
    expect(FakeWS.instances.length).toBe(before);
    expect(statuses.filter((s) => s === 'reconnecting')).toHaveLength(0);
  });
});
