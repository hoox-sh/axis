/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * HP-2 paint pump: `startHotRingPaint` samples the hot SAB ring once per
 * animation frame and feeds the contiguous tail run through
 * `appendLiveBar` — the same store verdicts and paint invariants the
 * frame path uses. A ring that jumped (suspended tab, replay) never
 * touches the store; the snapshot/repair path reconciles it.
 */

import '../setup';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { setStore, store } from '../../src/store';
import { HOT_RING_PAINT_TAIL, startHotRingPaint } from '../../src/chart/live-append';
import { allocateHotBuffer, type HotBuffer } from '../../src/hp/memory/hot-buffer';
import { HotRingWriter } from '../../src/hp/workers/hot-ring-writer';
import type { Redesign2DeltaFrame, Redesign2FullFrame } from '../../src/engine/frames';
import type { Bar } from '../../src/store/types';

const SUB = 'series:binance|spot|BTC/USDT|1m';
const T0 = 1_700_000_000;
const WINDOW = 10_000;

function mkBars(n: number, base = 100): Bar[] {
  const bars = Array.from({ length: n }, (_, i) => ({
    time: T0 + i * 60,
    open: base + i,
    high: base + i,
    low: base + i,
    close: base + i,
    volume: 1,
  }));
  // The store's tail mid-candle is the *forming* candle — a closed tip is
  // never reopened by a forming tick (appendBar's invariant), so a snapshot
  // seeded as all-closed would correctly `ignore` the tip update.
  const last = bars[bars.length - 1];
  if (last) last.closed = false;
  return bars;
}

function tickBar(time: number, close: number): Record<string, unknown> {
  return { time, open: close, high: close, low: close, close, volume: 1 };
}

function ringSetup(): { buf: HotBuffer; ring: HotRingWriter } {
  const buf = allocateHotBuffer();
  if (!buf) throw new Error('allocate');
  buf.priceScale = 0; // integer prices — assertions read as-is
  return { buf, ring: new HotRingWriter(buf) };
}

function full(bars: Bar[], seq = 1): Redesign2FullFrame {
  return {
    type: 'full',
    id: SUB,
    sessionId: 's1',
    seq,
    payload: {
      seriesKey: SUB,
      count: bars.length,
      closed_upto: bars[bars.length - 1]?.time ?? 0,
      bars,
    },
  };
}

function delta(
  bars: Array<Record<string, unknown>>,
  seq: number,
  forming?: boolean,
): Redesign2DeltaFrame {
  return {
    type: 'delta',
    id: SUB,
    sessionId: 's1',
    seq,
    payload: {
      base_index: 0,
      count: bars.length,
      tail_len: bars.length,
      closed_upto: Number(bars[bars.length - 1]?.time ?? 0),
      ...(forming ? { forming: true } : {}),
      bars,
    },
  };
}

/** Manual rAF: callbacks fire only when the test pumps them. */
function rafHarness() {
  const cbs: Array<(t: number) => void> = [];
  return {
    raf: (cb: (t: number) => void): number => {
      cbs.push(cb);
      return cbs.length;
    },
    cancelRaf: (): void => {},
    pump(): void {
      const due = cbs.splice(0);
      for (const cb of due) cb(Date.now());
    },
  };
}

describe('startHotRingPaint', () => {
  let raf = rafHarness();

  beforeEach(() => {
    raf = rafHarness();
    setStore('bars', []);
    setStore('rollingWindowBars', WINDOW);
    setStore('interval', '1m');
  });

  // The store is shared across test files in one process: leak nothing.
  afterEach(() => {
    setStore('bars', []);
    setStore('rollingWindowBars', WINDOW);
  });

  it('paints a forming tip update from the ring on the next frame', () => {
    const { buf, ring } = ringSetup();
    const bars = mkBars(3);
    setStore('bars', bars.slice());
    ring.absorb(full(bars));
    const stop = startHotRingPaint(buf, { raf: raf.raf, cancelRaf: raf.cancelRaf });
    try {
      raf.pump(); // settles on the snapshot generation (no-op update)
      ring.absorb(delta([tickBar(T0 + 120, 999)], 2, true));
      raf.pump();
      expect(store.bars).toHaveLength(3);
      expect(store.bars.at(-1)?.close).toBe(999);
    } finally {
      stop();
    }
  });

  it('appends a new candle from the ring', () => {
    const { buf, ring } = ringSetup();
    setStore('bars', mkBars(3).slice());
    ring.absorb(full(mkBars(3)));
    const stop = startHotRingPaint(buf, { raf: raf.raf, cancelRaf: raf.cancelRaf });
    try {
      raf.pump();
      ring.absorb(delta([tickBar(T0 + 180, 103)], 3));
      raf.pump();
      expect(store.bars).toHaveLength(4);
      expect(store.bars.at(-1)?.time).toBe(T0 + 180);
      expect(store.bars.at(-1)?.close).toBe(103);
    } finally {
      stop();
    }
  });

  it('never paints a non-contiguous ring tail', () => {
    const { buf, ring } = ringSetup();
    setStore('bars', mkBars(3).slice());
    ring.absorb(full(mkBars(3)));
    const stop = startHotRingPaint(buf, { raf: raf.raf, cancelRaf: raf.cancelRaf });
    try {
      raf.pump();
      // The ring jumps a candle: T0+240 lands two intervals past the store
      // tail (T0+120) — nothing may reach the chart.
      ring.absorb(delta([tickBar(T0 + 240, 104)], 4));
      raf.pump();
      expect(store.bars).toHaveLength(3);
      expect(store.bars.at(-1)?.time).toBe(T0 + 120);
    } finally {
      stop();
    }
  });

  it('stops painting after the disposer runs', () => {
    const { buf, ring } = ringSetup();
    setStore('bars', mkBars(3).slice());
    ring.absorb(full(mkBars(3)));
    const stop = startHotRingPaint(buf, { raf: raf.raf, cancelRaf: raf.cancelRaf });
    raf.pump();
    stop();
    ring.absorb(delta([tickBar(T0 + 180, 103)], 3));
    raf.pump();
    expect(store.bars).toHaveLength(3);
  });

  it('exposes a bounded inspection tail', () => {
    expect(HOT_RING_PAINT_TAIL).toBeGreaterThan(1);
    expect(HOT_RING_PAINT_TAIL).toBeLessThanOrEqual(64);
  });
});
