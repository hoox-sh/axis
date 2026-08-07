/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
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

  beforeEach(() => {
    FakeWS.instances = [];
    FakeWS.shouldFailConstruct = false;
    (globalThis as unknown as { WebSocket: typeof FakeWS }).WebSocket = FakeWS as never;
  });

  afterEach(() => {
    globalThis.WebSocket = prevWS;
  });

  it('opens and delivers messages', () => {
    const statuses: string[] = [];
    const bars: string[] = [];
    const stop = openReconnectableWs({
      url: 'wss://example.test/ws',
      onStatus: (s) => statuses.push(s.state),
      onError: () => {},
      onMessage: (e) => bars.push(String(e.data)),
    });
    expect(FakeWS.instances.length).toBe(1);
    FakeWS.instances[0]!.open();
    expect(statuses).toContain('open');
    FakeWS.instances[0]!.emitMessage('hello');
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
    FakeWS.instances[0]!.open();
    FakeWS.instances[0]!.drop(); // unexpected — not stopped
    expect(statuses).toContain('reconnecting');
    await new Promise((r) => setTimeout(r, 30));
    expect(FakeWS.instances.length).toBeGreaterThanOrEqual(2);
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
    FakeWS.instances[0]!.open();
    FakeWS.instances[0]!.drop();
    expect(statuses).toContain('reconnecting');
    const countWhileReconnecting = FakeWS.instances.length;
    stop();
    expect(statuses.at(-1)).toBe('closed');
    await new Promise((r) => setTimeout(r, 120));
    expect(FakeWS.instances.length).toBe(countWhileReconnecting);
  });

  it('double stop is idempotent', () => {
    const statuses: string[] = [];
    const stop = openReconnectableWs({
      url: 'wss://example.test/ws',
      onStatus: (s) => statuses.push(s.state),
      onError: () => {},
      onMessage: () => {},
    });
    FakeWS.instances[0]!.open();
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
    FakeWS.instances[0]!.drop();
    await new Promise((r) => setTimeout(r, 15));
    // second attempt socket
    const last = FakeWS.instances[FakeWS.instances.length - 1]!;
    last.drop();
    await new Promise((r) => setTimeout(r, 15));
    // third failure → exhaust (attempt 3 > max 2)
    const last2 = FakeWS.instances[FakeWS.instances.length - 1]!;
    last2.drop();
    await new Promise((r) => setTimeout(r, 15));
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]).toMatch(/failed to connect|exhausted/i);
    expect(statuses).toContain('closed');
    const after = FakeWS.instances.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(FakeWS.instances.length).toBe(after); // no more reconnects
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
