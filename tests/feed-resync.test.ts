/**
 * Copyright (c) 2026 HOOX - AXIS - hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Feed resync contract (P2.4): snapshot(seq n) → delta(seq n+1) → seq gap →
 * the session degrades, asks for a resume from n+1, leaves the window untouched,
 * and a following snapshot *replaces* the window instead of appending to the
 * stale one.
 */

import './setup';
import { describe, expect, it } from 'bun:test';
import { FeedSession, type FeedSocketEvent, type WebSocketLike } from '../src/engine/feed-session';
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

function snapshotFrame(seq: number, bars: Bar[] = makeBars()) {
  return {
    kind: 'snapshot',
    feed: FEED,
    seq,
    from: bars[0]?.time ?? 0,
    to: bars[bars.length - 1]?.time ?? 0,
    bars,
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

describe('feed resync after a seq gap', () => {
  it('degrades, resumes from n+1, keeps the window, and replaces it on snapshot', () => {
    const socket = new FakeSocket();
    const barsCalls: Array<{ bars: readonly Bar[]; kind: string }> = [];
    const statuses: Array<{ state: string; reason?: string }> = [];
    const session = new FeedSession({
      url: 'ws://engine.test/ws/feed',
      feed: FEED,
      windowBars: 500,
      socketFactory: () => socket,
      onBars: (bars, kind) => barsCalls.push({ bars, kind }),
      onStatus: (s) => statuses.push(s),
    });

    session.start();
    socket.emitOpen();

    // snapshot(seq 10) → delta(seq 11, forming bar overwritten)
    socket.emitMessage(snapshotFrame(10));
    socket.emitMessage(deltaFrame(11));
    expect(barsCalls).toHaveLength(2);
    const barsAfterDelta = barsCalls[1]!.bars;
    expect(barsAfterDelta.map((b) => b.time)).toEqual([100, 200, 300]);

    // Gap: delta seq 13 (expected 12)
    socket.emitMessage(
      deltaFrame(13, {
        times: [400],
        open: [401],
        high: [409],
        low: [401],
        close: [405],
        volume: [12],
      }),
    );

    // (a) status degraded with the gap reason
    expect(statuses.some((s) => s.state === 'degraded' && s.reason === 'seq_gap')).toBe(true);

    // (b) a resume frame with afterSeq = n + 1 was sent
    const resume = JSON.parse(socket.sent.at(-1)!) as Record<string, unknown>;
    expect(resume).toEqual({ kind: 'resume', afterSeq: 11 });

    // (c) bars array identity unchanged: no new onBars delivery and the
    // previously delivered array is untouched (merge never ran).
    expect(barsCalls).toHaveLength(2);
    expect(barsCalls[1]!.bars).toBe(barsAfterDelta);
    expect(session.currentBars.map((b) => b.time)).toEqual([100, 200, 300]);

    // (d) a following snapshot replaces the window — never appends onto it.
    const resyncBars: Bar[] = [
      { time: 1000, open: 1, high: 2, low: 1, close: 2, volume: 1, closed: true },
      { time: 1100, open: 2, high: 3, low: 2, close: 3, volume: 1, closed: true },
      { time: 1200, open: 3, high: 4, low: 3, close: 4, volume: 1 },
    ];
    socket.emitMessage(snapshotFrame(20, resyncBars));

    expect(barsCalls).toHaveLength(3);
    expect(barsCalls[2]!.kind).toBe('snapshot');
    expect(session.currentBars).toHaveLength(resyncBars.length); // 3, not 3 + 3
    expect(session.currentBars.map((b) => b.time)).toEqual([1000, 1100, 1200]);
    expect(statuses.at(-1)?.state).toBe('ready');
  });
});
