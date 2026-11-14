/**
 * Copyright (c) 2026 HOOX - AXIS - hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Feed session (engine-owned shared data plane): subscribe frame, snapshot /
 * delta handling, seq-gap resume, duplicates, URL derivation, flag default.
 */

import './setup';
import { describe, expect, it } from 'bun:test';
import {
  defaultFeedUrl,
  FeedSession,
  type FeedSocketEvent,
  type WebSocketLike,
} from '../src/engine/feed-session';
import { isFeedEnabled, FEED_FLAG_KEY, FEED_DISABLE_KEY } from '../src/engine/feed-flag';
import type { Bar } from '../src/store/types';

const FEED = 'binance|spot|BTC/USDT|1m|none|public';

class FakeSocket implements WebSocketLike {
  readonly sent: string[] = [];
  closed = false;
  private listeners = new Map<string, Array<(event: FeedSocketEvent) => void>>();

  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: FeedSocketEvent) => void,
  ): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  emitOpen(): void {
    this.fire('open', {});
  }

  emitMessage(payload: unknown): void {
    this.fire('message', { data: JSON.stringify(payload) });
  }

  emitClose(): void {
    this.fire('close', {});
  }

  emitError(): void {
    this.fire('error', {});
  }

  private fire(type: string, event: FeedSocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function makeBars(): Bar[] {
  return [
    { time: 100, open: 99, high: 101, low: 98, close: 100, volume: 10, closed: true },
    { time: 200, open: 200, high: 210, low: 199, close: 205, volume: 10 },
  ];
}

function snapshotFrame(seq = 1) {
  return {
    kind: 'snapshot',
    feed: FEED,
    seq,
    from: 100,
    to: 200,
    bars: makeBars(),
  };
}

function deltaFrame(seq: number, overrides: Record<string, unknown> = {}) {
  return {
    kind: 'delta',
    feed: FEED,
    seq,
    forming: true,
    upTo: 300,
    times: [200, 300],
    open: [201, 301],
    high: [209, 309],
    low: [201, 301],
    close: [205, 305],
    volume: [11, 12],
    ...overrides,
  };
}

function makeSession(opts: { windowBars?: number } = {}) {
  const socket = new FakeSocket();
  const barsCalls: Array<{ bars: readonly Bar[]; kind: string }> = [];
  const statuses: Array<{ state: string; reason?: string }> = [];
  const session = new FeedSession({
    url: 'ws://engine.test/ws/feed',
    feed: FEED,
    windowBars: opts.windowBars ?? 500,
    socketFactory: () => socket,
    onBars: (bars, kind) => barsCalls.push({ bars, kind }),
    onStatus: (s) => statuses.push(s),
  });
  return { session, socket, barsCalls, statuses };
}

describe('FeedSession', () => {
  it('sends a subscribe frame with windowBars on open and applies the snapshot', () => {
    const { session, socket, barsCalls, statuses } = makeSession({ windowBars: 250 });
    session.start();
    expect(statuses.map((s) => s.state)).toContain('connecting');
    socket.emitOpen();
    expect(socket.sent).toHaveLength(1);
    const frame = JSON.parse(socket.sent[0]!) as Record<string, unknown>;
    expect(frame).toEqual({ kind: 'feed', feed: FEED, windowBars: 250 });

    socket.emitMessage(snapshotFrame(1));
    expect(barsCalls).toHaveLength(1);
    expect(barsCalls[0]!.kind).toBe('snapshot');
    expect(barsCalls[0]!.bars.map((b) => b.time)).toEqual([100, 200]);
    expect(statuses.at(-1)?.state).toBe('ready');
  });

  it('merges an in-order delta: forming bar overwritten, new bar appended with previous bar closed', () => {
    const { session, socket, barsCalls } = makeSession();
    session.start();
    socket.emitOpen();
    socket.emitMessage(snapshotFrame(1));
    socket.emitMessage(deltaFrame(2));

    expect(barsCalls).toHaveLength(2);
    expect(barsCalls[1]!.kind).toBe('delta');
    const bars = barsCalls[1]!.bars;
    expect(bars.map((b) => b.time)).toEqual([100, 200, 300]);
    // Forming tip at 200 was overwritten in place by the delta values.
    expect(bars[1]!.close).toBe(205);
    expect(bars[1]!.closed).toBe(true); // closed by the append of 300
    // New bar appended.
    expect(bars[2]!.close).toBe(305);
    // Input history untouched.
    expect(barsCalls[0]!.bars[1]!.closed).not.toBe(true);
  });

  it('sends resume with afterSeq on a seq gap and does not apply bars', () => {
    const { session, socket, barsCalls, statuses } = makeSession();
    session.start();
    socket.emitOpen();
    socket.emitMessage(snapshotFrame(1));
    socket.emitMessage(deltaFrame(3));

    expect(barsCalls).toHaveLength(1); // no delta applied
    const resume = JSON.parse(socket.sent.at(-1)!) as Record<string, unknown>;
    expect(resume).toEqual({ kind: 'resume', afterSeq: 1 });
    expect(statuses.some((s) => s.state === 'degraded' && s.reason === 'seq_gap')).toBe(true);
  });

  it('ignores a duplicate delta seq', () => {
    const { session, socket, barsCalls } = makeSession();
    session.start();
    socket.emitOpen();
    socket.emitMessage(snapshotFrame(1));
    socket.emitMessage(deltaFrame(2));
    socket.emitMessage(deltaFrame(2));

    expect(barsCalls).toHaveLength(2); // snapshot + the one applied delta
    expect(barsCalls[1]!.bars.map((b) => b.time)).toEqual([100, 200, 300]);
  });

  it('stop() closes the socket and clears state', () => {
    const { session, socket, barsCalls } = makeSession();
    session.start();
    socket.emitOpen();
    socket.emitMessage(snapshotFrame(1));
    session.stop();
    expect(socket.closed).toBe(true);
    expect(session.lastSeq).toBeNull();
    expect(session.currentBars).toEqual([]);
    socket.emitMessage(deltaFrame(2));
    expect(barsCalls).toHaveLength(1); // no further callbacks after stop
  });
});

describe('defaultFeedUrl', () => {
  it('maps http to ws /ws/feed', () => {
    expect(defaultFeedUrl('http://127.0.0.1:5002')).toBe('ws://127.0.0.1:5002/ws/feed');
  });

  it('maps https with trailing slash to wss /ws/feed', () => {
    expect(defaultFeedUrl('https://x.example.com/')).toBe('wss://x.example.com/ws/feed');
  });

  it('preserves a path prefix', () => {
    expect(defaultFeedUrl('https://x/api/')).toBe('wss://x/api/ws/feed');
  });
});

describe('feed flag', () => {
  it('is disabled by default', () => {
    try {
      localStorage.removeItem(FEED_FLAG_KEY);
      localStorage.removeItem(FEED_DISABLE_KEY);
    } catch {
      /* no localStorage in this environment */
    }
    expect(isFeedEnabled()).toBe(false);
  });
});
