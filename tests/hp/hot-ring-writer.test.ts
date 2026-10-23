/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Hot-ring routing (HP-2): the ingest worker is the single writer of the
 * hot SAB ring. Series bars are absorbed into the ring and stripped from
 * the posted frames; every other frame (snapshots, script deltas, foreign
 * series, frames the ring cannot absorb) keeps its payload — the frame
 * path is always a correct fallback.
 */

import '../setup';
import { describe, expect, it } from 'bun:test';
import { allocateHotBuffer, type HotBuffer } from '../../src/hp/memory/hot-buffer';
import { copyOutTail } from '../../src/hp/paint/copy-out-lwc';
import { HotRingWriter, routeThroughRing } from '../../src/hp/workers/hot-ring-writer';
import type {
  Redesign2DeltaFrame,
  Redesign2Frame,
  Redesign2FullFrame,
} from '../../src/engine/frames';
import type { Bar } from '../../src/store/types';

const SUB = 'series:binance|spot|BTC/USDT|1m';
const OTHER = 'series:binance|spot|ETH/USDT|1m';
const T0 = 1_700_000_000;

function mkBars(n: number, start = T0, base = 100): Bar[] {
  return Array.from({ length: n }, (_, i) => ({
    time: start + i * 60,
    open: base + i,
    high: base + i,
    low: base + i,
    close: base + i,
    volume: 1,
  }));
}

function tickBar(time: number, close: number, volume = 1): Record<string, unknown> {
  return { time, open: close, high: close, low: close, close, volume };
}

function writer(cap?: number): { buf: HotBuffer; ring: HotRingWriter } {
  const buf = allocateHotBuffer(cap);
  if (!buf) throw new Error('allocate');
  buf.priceScale = 0; // integer prices — assertions read as-is
  return { buf, ring: new HotRingWriter(buf) };
}

function full(id: string, bars: Bar[], seq = 1): Redesign2FullFrame {
  return {
    type: 'full',
    id,
    sessionId: 's1',
    seq,
    payload: {
      seriesKey: id,
      count: bars.length,
      closed_upto: bars[bars.length - 1]?.time ?? 0,
      bars,
    },
  };
}

function delta(
  id: string,
  bars: Array<Record<string, unknown>>,
  seq: number,
  forming?: boolean,
): Redesign2DeltaFrame {
  return {
    type: 'delta',
    id,
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

function scriptDelta(): Redesign2Frame {
  return {
    type: 'delta',
    id: 'script:ema',
    sessionId: 's1',
    seq: 4,
    payload: { base_index: 0, count: 1, tail_len: 1, closed_upto: 0, plots: { '1': [1] } },
  } as Redesign2Frame;
}

function payloadOf(frame: Redesign2Frame | undefined): Record<string, unknown> {
  return (frame?.payload ?? {}) as Record<string, unknown>;
}

describe('HotRingWriter', () => {
  it('binds on a series snapshot, seeds the ring, and keeps the payload', () => {
    const { buf, ring } = writer();
    const bars = mkBars(10);
    const frame = full(SUB, bars);
    const posted = ring.absorb(frame);
    expect(posted).toBe(frame); // snapshots keep their payload (initial paint)
    expect(ring.boundSeries).toBe(SUB);
    const tail = copyOutTail(buf, 3);
    expect(tail?.bars.map((b) => b.time)).toEqual([bars[7]?.time, bars[8]?.time, bars[9]?.time]);
    expect(buf.control.hotFromIndex).toBe(0);
    expect(buf.control.hotCount).toBe(10);
  });

  it('strips a forming tip into the ring and keeps every wire field', () => {
    const { buf, ring } = writer();
    ring.absorb(full(SUB, mkBars(3)));
    const gen = buf.control.generation;
    const d = delta(SUB, [tickBar(T0 + 120, 999, 2)], 7, true);
    const posted = ring.absorb(d);
    expect(posted).not.toBe(d); // a stripped copy is posted, not the original
    expect(payloadOf(posted).bars).toBeUndefined();
    expect(posted.seq).toBe(7);
    expect(payloadOf(posted).closed_upto).toBe(T0 + 120);
    expect(buf.control.generation).toBeGreaterThan(gen); // published
    const tip = copyOutTail(buf, 1)?.bars[0];
    expect(tip?.close).toBe(999);
    expect(tip?.closed).toBe(false); // the forming flag survived the ticks round-trip
  });

  it('appends a new candle into the ring', () => {
    const { buf, ring } = writer();
    ring.absorb(full(SUB, mkBars(3)));
    ring.absorb(delta(SUB, [tickBar(T0 + 180, 103)], 8));
    expect(buf.control.hotCount).toBe(4);
    expect(copyOutTail(buf, 1)?.bars[0]?.time).toBe(T0 + 180);
  });

  it('slides the hot window one step once it reaches capacity', () => {
    const { buf, ring } = writer(4);
    ring.absorb(full(SUB, mkBars(4)));
    ring.absorb(delta(SUB, [tickBar(T0 + 240, 104), tickBar(T0 + 300, 105)], 9));
    expect(buf.control.hotCount).toBe(4);
    expect(buf.control.hotFromIndex).toBe(2);
    expect(copyOutTail(buf, 4)?.bars.map((b) => b.time)).toEqual([
      T0 + 120,
      T0 + 180,
      T0 + 240,
      T0 + 300,
    ]);
  });

  it('rebinds on another series snapshot and bumps the epoch', () => {
    const { buf, ring } = writer();
    ring.absorb(full(SUB, mkBars(3)));
    const epoch = buf.epoch;
    ring.absorb(full(OTHER, mkBars(2, 1_800_000_000, 500)));
    expect(buf.epoch).toBe(epoch + 1);
    expect(ring.boundSeries).toBe(OTHER);
    expect(copyOutTail(buf, 2)?.bars.map((b) => b.time)).toEqual([1_800_000_000, 1_800_000_060]);
  });

  it('passes script deltas and unbound series through untouched', () => {
    const { ring } = writer();
    ring.absorb(full(SUB, mkBars(2)));
    const script = scriptDelta();
    expect(ring.absorb(script)).toBe(script);
    const foreign = delta(OTHER, [tickBar(1_800_000_000, 500)], 3);
    const posted = ring.absorb(foreign);
    expect(posted).toBe(foreign);
    expect(payloadOf(posted).bars).toHaveLength(1);
  });

  it('leaves deltas on the frame path while the ring is cold', () => {
    const { ring } = writer();
    const d = delta(SUB, [tickBar(T0, 100)], 2);
    expect(ring.absorb(d)).toBe(d);
  });

  it('falls back to the frame path when no delta bar sanitizes', () => {
    const { ring } = writer();
    ring.absorb(full(SUB, mkBars(2)));
    const d = delta(SUB, [null as never, 'x' as never], 3);
    expect(ring.absorb(d)).toBe(d);
  });

  it('keeps a stale-only delta on the frame path and never flips the generation', () => {
    const { buf, ring } = writer();
    ring.absorb(full(SUB, mkBars(3)));
    const gen = buf.control.generation;
    const d = delta(SUB, [tickBar(T0, 55)], 5);
    // Nothing to write: the frame stays on the JSON path (the store would
    // `ignore` the stale bar anyway) and the generation stays even.
    expect(ring.absorb(d)).toBe(d);
    expect(buf.control.generation).toBe(gen);
    expect(copyOutTail(buf, 1)?.bars[0]?.close).toBe(102);
  });
});

describe('routeThroughRing', () => {
  it('keeps the snapshot, passes the script delta, strips the series delta', () => {
    const { ring } = writer();
    const frames: Redesign2Frame[] = [
      full(SUB, mkBars(2)),
      scriptDelta(),
      delta(SUB, [tickBar(T0 + 60, 101)], 2),
    ];
    const out = routeThroughRing(frames, ring);
    expect(out).toHaveLength(3);
    expect(payloadOf(out[0]).bars).toHaveLength(2);
    expect(out[1]).toBe(frames[1]);
    expect(payloadOf(out[2]).bars).toBeUndefined();
    expect(out[2]?.seq).toBe(2);
  });
});
