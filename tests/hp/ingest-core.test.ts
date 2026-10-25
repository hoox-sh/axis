/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import { validateRedesign2Frame, type Redesign2Frame } from '../../src/engine/frames';
import { Axb1Opcode, TipMask, ValueKind } from '../../src/hp/axb1/constants';
import { encodeFrame } from '../../src/hp/axb1/encode';
import { fnv1a32 } from '../../src/hp/axb1/hash';
import { decodeInbound, IngestCursorTable, TipCoalescer } from '../../src/hp/workers/ingest-core';

const SUB = 'series:binance|spot|BTC/USDT|1m';

function tableWithSub(): IngestCursorTable {
  const table = new IngestCursorTable();
  table.rememberId(SUB);
  table.rememberSession('ses-1');
  return table;
}

describe('decodeInbound JSON', () => {
  test('parses a valid full frame and remembers the id', () => {
    const table = new IngestCursorTable();
    const raw = JSON.stringify({
      type: 'full',
      id: SUB,
      sessionId: 'ses-1',
      seq: 1,
      payload: { seriesKey: SUB, count: 1, closed_upto: 0, bars: [{ time: 60, open: 1, high: 1, low: 1, close: 1, volume: 1 }] },
    });
    const out = decodeInbound(raw, table);
    expect(out.ok).toBe(true);
    if (out.ok && out.kind === 'frames') {
      expect(out.frames[0]?.type).toBe('full');
      expect(validateRedesign2Frame(out.frames[0])).toBe(true);
    }
    expect(table.resolveSubId(fnv1a32(SUB))).toBe(SUB);
  });

  test('pong is not a data frame', () => {
    const out = decodeInbound(JSON.stringify({ type: 'pong' }), new IngestCursorTable());
    expect(out).toEqual({ ok: true, kind: 'pong' });
  });

  test('malformed JSON and invalid frames report ok: false', () => {
    expect(decodeInbound('{', new IngestCursorTable()).ok).toBe(false);
    expect(decodeInbound(JSON.stringify({ type: 'full' }), new IngestCursorTable()).ok).toBe(false);
  });

  test('utf8 ArrayBuffer of JSON decodes the same as a string', () => {
    const json = JSON.stringify({ type: 'status', payload: { code: 'live' } });
    const buf = new TextEncoder().encode(json).buffer;
    const out = decodeInbound(buf, new IngestCursorTable());
    expect(out.ok).toBe(true);
    if (out.ok && out.kind === 'frames') expect(out.frames[0]?.type).toBe('status');
  });
});

describe('decodeInbound AXB1', () => {
  test('an unknown opcode names the sub and stays a successful decode', () => {
    const table = tableWithSub();
    const bytes = encodeFrame({
      opcode: Axb1Opcode.HEARTBEAT,
      seq: 4,
      subIdHash: fnv1a32(SUB),
      sessionHash: fnv1a32('ses-1'),
      tsMs: 0n,
    });
    bytes[5] = 0x7f;
    expect(decodeInbound(bytes, table)).toEqual({
      ok: true,
      kind: 'unknown-opcode',
      opcode: 0x7f,
      id: SUB,
      seq: 4,
    });
  });

  test('heartbeat is pong', () => {
    const bytes = encodeFrame({
      opcode: Axb1Opcode.HEARTBEAT,
      seq: 0,
      subIdHash: 0,
      sessionHash: 0,
      tsMs: 0n,
    });
    expect(decodeInbound(bytes, new IngestCursorTable())).toEqual({ ok: true, kind: 'pong' });
  });

  test('SNAPSHOT_OHLCV becomes a JSON full with prices from ticks', () => {
    const table = tableWithSub();
    const bytes = encodeFrame({
      opcode: Axb1Opcode.SNAPSHOT_OHLCV,
      seq: 3,
      subIdHash: fnv1a32(SUB),
      sessionHash: fnv1a32('ses-1'),
      tsMs: 0n,
      priceScale: 2,
      count: 1,
      closedUpto: 0,
      hotFromIndex: 0,
      timeS: [60],
      open: [10000n],
      high: [11000n],
      low: [9000n],
      close: [10500n],
      volume: [3],
      flags: [1],
    });
    const out = decodeInbound(bytes, table);
    expect(out.ok).toBe(true);
    if (!(out.ok && out.kind === 'frames')) throw new Error('expected frames');
    const frame = out.frames[0];
    if (!frame) throw new Error('expected frame');
    expect(validateRedesign2Frame(frame)).toBe(true);
    expect(frame.id).toBe(SUB);
    expect(frame.type).toBe('full');
    const bars = (frame.payload as { bars: Array<{ close: number }> }).bars;
    expect(bars[0]?.close).toBe(105);
  });

  test('TIP_UPDATE after a snapshot is a forming delta of the last bar', () => {
    const table = tableWithSub();
    decodeInbound(
      encodeFrame({
        opcode: Axb1Opcode.SNAPSHOT_OHLCV,
        seq: 1,
        subIdHash: fnv1a32(SUB),
        sessionHash: fnv1a32('ses-1'),
        tsMs: 0n,
        priceScale: 2,
        count: 1,
        closedUpto: 0,
        hotFromIndex: 0,
        timeS: [60],
        open: [10000n],
        high: [10000n],
        low: [10000n],
        close: [10000n],
        volume: [1],
        flags: [0],
      }),
      table,
    );
    const out = decodeInbound(
      encodeFrame({
        opcode: Axb1Opcode.TIP_UPDATE,
        seq: 2,
        subIdHash: fnv1a32(SUB),
        sessionHash: fnv1a32('ses-1'),
        tsMs: 0n,
        mask: TipMask.CLOSE | TipMask.VOLUME | TipMask.TIME,
        flags: 1,
        close: 10100n,
        volume: 2,
        timeS: 60,
      }),
      table,
    );
    expect(out.ok).toBe(true);
    if (!(out.ok && out.kind === 'frames')) throw new Error('expected frames');
    const payload = out.frames[0]?.payload as {
      forming: boolean;
      bars: Array<{ close: number; volume: number }>;
    };
    expect(payload.forming).toBe(true);
    expect(payload.bars[0]?.close).toBe(101);
    expect(payload.bars[0]?.volume).toBe(2);
  });

  test('a tip without a server bar time stays on the previous bar', () => {
    const table = tableWithSub();
    decodeInbound(
      encodeFrame({
        opcode: Axb1Opcode.SNAPSHOT_OHLCV,
        seq: 1,
        subIdHash: fnv1a32(SUB),
        sessionHash: fnv1a32('ses-1'),
        tsMs: 9_000_000_000_000n,
        priceScale: 2,
        count: 1,
        closedUpto: 0,
        hotFromIndex: 0,
        timeS: [60],
        open: [10000n],
        high: [10000n],
        low: [10000n],
        close: [10000n],
        volume: [1],
        flags: [0],
      }),
      table,
    );
    const out = decodeInbound(
      encodeFrame({
        opcode: Axb1Opcode.TIP_UPDATE,
        seq: 2,
        subIdHash: fnv1a32(SUB),
        sessionHash: fnv1a32('ses-1'),
        tsMs: 9_000_000_000_000n,
        mask: TipMask.CLOSE | TipMask.TIME,
        flags: 1,
        close: 10100n,
        timeS: 0,
      }),
      table,
    );
    expect(out.ok).toBe(true);
    if (!(out.ok && out.kind === 'frames')) throw new Error('expected frames');
    const frame = out.frames[0];
    const payload = frame?.payload as
      | { bars?: Array<{ time: number; close: number; closed?: boolean }> }
      | undefined;
    const bar = payload?.bars?.[0];
    expect(bar?.time).toBe(60);
    expect(bar?.close).toBe(101);
    expect(bar?.closed).toBe(false);
  });

  test('APPEND_BAR emits a delta then a close', () => {
    const table = tableWithSub();
    decodeInbound(
      encodeFrame({
        opcode: Axb1Opcode.SNAPSHOT_OHLCV,
        seq: 1,
        subIdHash: fnv1a32(SUB),
        sessionHash: fnv1a32('ses-1'),
        tsMs: 0n,
        priceScale: 2,
        count: 1,
        closedUpto: 0,
        hotFromIndex: 0,
        timeS: [60],
        open: [100n],
        high: [100n],
        low: [100n],
        close: [100n],
        volume: [1],
        flags: [1],
      }),
      table,
    );
    const out = decodeInbound(
      encodeFrame({
        opcode: Axb1Opcode.APPEND_BAR,
        seq: 2,
        subIdHash: fnv1a32(SUB),
        sessionHash: fnv1a32('ses-1'),
        tsMs: 0n,
        priceScale: 2,
        closedIndex: 0,
        closedTime: 60,
        open: 100n,
        high: 110n,
        low: 90n,
        close: 105n,
        volume: 9,
        tip: { mask: TipMask.OPEN | TipMask.TIME, flags: 1, open: 105n, timeS: 120 },
      }),
      table,
    );
    expect(out.ok).toBe(true);
    if (!(out.ok && out.kind === 'frames')) throw new Error('expected frames');
    expect(out.frames.map((f) => f.type)).toEqual(['delta', 'close']);
    expect(validateRedesign2Frame(out.frames[0])).toBe(true);
    expect(validateRedesign2Frame(out.frames[1])).toBe(true);
    const payload = out.frames[0]?.payload as
      | { bars?: Array<{ time: number; closed?: boolean }> }
      | undefined;
    const bars = payload?.bars;
    expect(bars?.[0]).toMatchObject({ time: 60, closed: true });
    expect(bars?.[1]).toMatchObject({ time: 120, closed: false });
  });

  test('bad magic is not silently treated as JSON if it is not utf8 JSON', () => {
    const buf = new Uint8Array([0, 1, 2, 3, 4, 5]);
    const out = decodeInbound(buf, new IngestCursorTable());
    expect(out.ok).toBe(false);
  });
});

describe('mapAxb1 SNAPSHOT_PLOTS', () => {
  test('puts bar_times on the full payload when times are present', () => {
    const table = tableWithSub();
    const out = decodeInbound(
      encodeFrame({
        opcode: Axb1Opcode.SNAPSHOT_PLOTS,
        seq: 5,
        subIdHash: fnv1a32(SUB),
        sessionHash: fnv1a32('ses-1'),
        tsMs: 0n,
        count: 2,
        closedUpto: 1,
        times: [60, 120],
        plots: [
          { key: 'close', kind: ValueKind.PriceTicks, ticks: [100000000n, 200000000n] },
          { key: '%B', kind: ValueKind.UnitFloat64, values: [0.2, 0.8] },
        ],
      }),
      table,
    );
    expect(out.ok).toBe(true);
    if (!(out.ok && out.kind === 'frames')) throw new Error('expected frames');
    const frame = out.frames[0];
    if (!frame) throw new Error('expected frame');
    expect(validateRedesign2Frame(frame)).toBe(true);
    expect(frame.type).toBe('full');
    const payload = frame.payload as {
      count: number;
      bar_times?: number[];
      series?: Record<string, unknown[]>;
    };
    expect(payload.bar_times).toEqual([60, 120]);
    expect(payload.bar_times?.length).toBe(payload.count);
    expect(payload.series?.close).toEqual([1, 2]);
    expect(payload.series?.['%B']).toEqual([0.2, 0.8]);
    for (const col of Object.values(payload.series ?? {})) {
      expect(col.length).toBe(payload.count);
    }
  });

  test('omits bar_times when the AXB1 times column is absent', () => {
    const table = tableWithSub();
    const out = decodeInbound(
      encodeFrame({
        opcode: Axb1Opcode.SNAPSHOT_PLOTS,
        seq: 6,
        subIdHash: fnv1a32(SUB),
        sessionHash: fnv1a32('ses-1'),
        tsMs: 0n,
        count: 1,
        closedUpto: 0,
        times: null,
        plots: [{ key: 'rsi', kind: ValueKind.UnitFloat64, values: [55] }],
      }),
      table,
    );
    expect(out.ok).toBe(true);
    if (!(out.ok && out.kind === 'frames')) throw new Error('expected frames');
    const payload = out.frames[0]?.payload as {
      count: number;
      bar_times?: number[];
      series?: Record<string, unknown[]>;
    };
    expect(payload.bar_times).toBeUndefined();
    expect(payload.series?.rsi?.length).toBe(payload.count);
  });
});

describe('TipCoalescer', () => {
  test('keeps the latest forming tip per id until flush', () => {
    const seen: Redesign2Frame[][] = [];
    let fire: (() => void) | undefined;
    const c = new TipCoalescer(
      (frames) => seen.push(frames),
      16,
      (fn) => {
        fire = fn;
        return () => {
          fire = undefined;
        };
      },
    );
    const tip = (close: number): Redesign2Frame => ({
      type: 'delta',
      id: SUB,
      sessionId: 's',
      seq: close,
      payload: { forming: true, bars: [{ close }], base_index: 0, count: 1, tail_len: 1, closed_upto: 0 },
    });
    c.push([tip(1), tip(2)]);
    expect(seen).toEqual([]);
    fire?.();
    expect(seen).toHaveLength(1);
    const payload = seen[0]?.[0]?.payload as { bars: Array<{ close: number }> } | undefined;
    expect(payload?.bars[0]?.close).toBe(2);
  });

  test('a close flushes the pending tip then the close', () => {
    const seen: Redesign2Frame[][] = [];
    const c = new TipCoalescer((frames) => seen.push(frames), 16, () => () => {});
    c.push([
      {
        type: 'delta',
        id: SUB,
        sessionId: 's',
        seq: 1,
        payload: { forming: true, base_index: 0, count: 1, tail_len: 1, closed_upto: 0 },
      },
      {
        type: 'close',
        id: SUB,
        sessionId: 's',
        seq: 2,
        payload: { index: 0, time: 60, ohlcv: { open: 1, high: 1, low: 1, close: 1, volume: 1 } },
      },
    ]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.map((f) => f.type)).toEqual(['delta', 'close']);
  });

  test('APPEND_BAR flushes the pending tip then the append', () => {
    const seen: Redesign2Frame[][] = [];
    const c = new TipCoalescer((frames) => seen.push(frames), 16, () => () => {});
    c.push([
      {
        type: 'delta',
        id: SUB,
        sessionId: 's',
        seq: 1,
        payload: {
          forming: true,
          bars: [{ time: 60, close: 101, closed: false }],
          base_index: 0,
          count: 1,
          tail_len: 1,
          closed_upto: 0,
        },
      },
      {
        type: 'delta',
        id: SUB,
        sessionId: 's',
        seq: 2,
        payload: {
          forming: false,
          bars: [{ time: 60, open: 100, high: 110, low: 90, close: 105, volume: 9, closed: true }],
          base_index: 0,
          count: 1,
          tail_len: 1,
          closed_upto: 0,
        },
      },
    ]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.map((f) => f.type)).toEqual(['delta', 'delta']);
    const tip = seen[0]?.[0]?.payload as { forming?: boolean; bars?: Array<{ close: number }> } | undefined;
    const append = seen[0]?.[1]?.payload as
      | { forming?: boolean; bars?: Array<{ closed?: boolean; close: number }> }
      | undefined;
    expect(tip?.forming).toBe(true);
    expect(tip?.bars?.[0]?.close).toBe(101);
    expect(append?.forming).toBe(false);
    expect(append?.bars?.[0]).toMatchObject({ closed: true, close: 105 });
  });

  test('folds OHLC to the last tip and unions plot columns', () => {
    const seen: Redesign2Frame[][] = [];
    let fire: (() => void) | undefined;
    const c = new TipCoalescer(
      (frames) => seen.push(frames),
      16,
      (fn) => {
        fire = fn;
        return () => {
          fire = undefined;
        };
      },
    );
    c.push([
      {
        type: 'delta',
        id: SUB,
        sessionId: 's',
        seq: 1,
        payload: {
          forming: true,
          bars: [{ close: 1 }],
          series: { 'p:1': [1] },
          base_index: 0,
          count: 1,
          tail_len: 1,
          closed_upto: 0,
        },
      },
      {
        type: 'delta',
        id: SUB,
        sessionId: 's',
        seq: 2,
        payload: {
          forming: true,
          bars: [{ close: 9 }],
          series: { 'p:2': [2] },
          base_index: 0,
          count: 1,
          tail_len: 1,
          closed_upto: 0,
        },
      },
    ]);
    fire?.();
    const payload = seen[0]?.[0]?.payload as {
      bars: Array<{ close: number }>;
      series: Record<string, number[]>;
    };
    expect(payload.bars[0]?.close).toBe(9);
    expect(payload.series).toEqual({ 'p:1': [1], 'p:2': [2] });
    expect(seen[0]?.[0]?.seq).toBe(2);
  });

  test('a plot tip keeps the pending candle', () => {
    const seen: Redesign2Frame[][] = [];
    let fire: (() => void) | undefined;
    const c = new TipCoalescer(
      (frames) => seen.push(frames),
      16,
      (fn) => {
        fire = fn;
        return () => undefined;
      },
    );
    c.push([
      {
        type: 'delta',
        id: SUB,
        sessionId: 's',
        seq: 3,
        payload: {
          forming: true,
          bars: [{ close: 4 }],
          base_index: 0,
          count: 1,
          tail_len: 1,
          closed_upto: 0,
        },
      },
      {
        type: 'delta',
        id: SUB,
        sessionId: 's',
        seq: 4,
        payload: {
          forming: true,
          series: { 'p:9': [8] },
          base_index: 0,
          count: 1,
          tail_len: 1,
          closed_upto: 0,
        },
      },
    ]);
    fire?.();
    const payload = seen[0]?.[0]?.payload as {
      bars: Array<{ close: number }>;
      series: Record<string, number[]>;
    };
    expect(payload.bars[0]?.close).toBe(4);
    expect(payload.series['p:9']).toEqual([8]);
  });

  test('drops an UNCHANGED keepalive and does not clobber a pending tip', () => {
    const seen: Redesign2Frame[][] = [];
    let fire: (() => void) | undefined;
    const c = new TipCoalescer(
      (frames) => seen.push(frames),
      16,
      (fn) => {
        fire = fn;
        return () => undefined;
      },
    );
    c.push([
      {
        type: 'delta',
        id: SUB,
        sessionId: 's',
        seq: 1,
        payload: { unchanged: true, forming: true, base_index: 0, count: 1, tail_len: 1, closed_upto: 0 },
      },
    ]);
    expect(seen).toEqual([]);
    expect(fire).toBeUndefined();
    c.push([
      {
        type: 'delta',
        id: SUB,
        sessionId: 's',
        seq: 2,
        payload: {
          forming: true,
          bars: [{ close: 3 }],
          base_index: 0,
          count: 1,
          tail_len: 1,
          closed_upto: 0,
        },
      },
      {
        type: 'delta',
        id: SUB,
        sessionId: 's',
        seq: 3,
        payload: { unchanged: true, forming: true, base_index: 0, count: 1, tail_len: 1, closed_upto: 0 },
      },
    ]);
    fire?.();
    const payload = seen[0]?.[0]?.payload as { bars: Array<{ close: number }>; unchanged?: boolean };
    expect(seen).toHaveLength(1);
    expect(payload.bars[0]?.close).toBe(3);
    expect(payload.unchanged).toBeUndefined();
    expect(seen[0]?.[0]?.seq).toBe(2);
  });

  test('a dropped UNCHANGED run is acknowledged on the next tip', () => {
    const seen: Redesign2Frame[][] = [];
    let fire: (() => void) | undefined;
    const c = new TipCoalescer(
      (frames) => seen.push(frames),
      16,
      (fn) => {
        fire = fn;
        return () => undefined;
      },
    );
    c.push([
      {
        type: 'full',
        id: SUB,
        sessionId: 's',
        seq: 4,
        payload: { seriesKey: SUB, count: 1, closed_upto: 0 },
      },
    ]);
    c.push([
      {
        type: 'delta',
        id: SUB,
        sessionId: 's',
        seq: 5,
        payload: { unchanged: true, forming: true, base_index: 0, count: 1, tail_len: 1, closed_upto: 0 },
      },
      {
        type: 'delta',
        id: SUB,
        sessionId: 's',
        seq: 6,
        payload: { unchanged: true, forming: true, base_index: 0, count: 1, tail_len: 1, closed_upto: 0 },
      },
      {
        type: 'delta',
        id: SUB,
        sessionId: 's',
        seq: 7,
        payload: {
          forming: true,
          bars: [{ close: 1 }],
          base_index: 0,
          count: 1,
          tail_len: 1,
          closed_upto: 0,
        },
      },
    ]);
    fire?.();
    const tip = seen.at(-1)?.[0];
    const payload = tip?.payload as { seqAckFrom?: number } | undefined;
    expect(tip?.seq).toBe(7);
    expect(payload?.seqAckFrom).toBe(4);
  });

  test('a trailing UNCHANGED keepalive advances the released seq', () => {
    const seen: Redesign2Frame[][] = [];
    let fire: (() => void) | undefined;
    const c = new TipCoalescer(
      (frames) => seen.push(frames),
      16,
      (fn) => {
        fire = fn;
        return () => undefined;
      },
    );
    c.push([
      {
        type: 'close',
        id: SUB,
        sessionId: 's',
        seq: 4,
        payload: { index: 0, time: 60, ohlcv: { open: 1, high: 1, low: 1, close: 1, volume: 1 } },
      },
      {
        type: 'delta',
        id: SUB,
        sessionId: 's',
        seq: 5,
        payload: {
          forming: true,
          bars: [{ close: 2 }],
          base_index: 0,
          count: 1,
          tail_len: 1,
          closed_upto: 0,
        },
      },
      {
        type: 'delta',
        id: SUB,
        sessionId: 's',
        seq: 6,
        payload: { unchanged: true, forming: true, base_index: 0, count: 1, tail_len: 1, closed_upto: 0 },
      },
    ]);
    fire?.();
    const tip = seen.at(-1)?.find((f) => f.type === 'delta');
    const payload = tip?.payload as { bars?: Array<{ close: number }>; seqAckFrom?: number } | undefined;
    expect(tip?.seq).toBe(6);
    expect(payload?.bars?.[0]?.close).toBe(2);
    expect(payload?.seqAckFrom).toBe(4);
  });

  test('folded tips acknowledge the seqs they replaced', () => {
    const seen: Redesign2Frame[][] = [];
    let fire: (() => void) | undefined;
    const c = new TipCoalescer(
      (frames) => seen.push(frames),
      16,
      (fn) => {
        fire = fn;
        return () => undefined;
      },
    );
    c.push([
      {
        type: 'full',
        id: SUB,
        sessionId: 's',
        seq: 4,
        payload: { seriesKey: SUB, count: 1, closed_upto: 0 },
      },
    ]);
    const tip = (seq: number, close: number): Redesign2Frame => ({
      type: 'delta',
      id: SUB,
      sessionId: 's',
      seq,
      payload: {
        forming: true,
        bars: [{ close }],
        base_index: 0,
        count: 1,
        tail_len: 1,
        closed_upto: 0,
      },
    });
    c.push([tip(5, 1), tip(6, 9)]);
    fire?.();
    const released = seen.at(-1)?.[0];
    const payload = released?.payload as { bars?: Array<{ close: number }>; seqAckFrom?: number } | undefined;
    expect(released?.seq).toBe(6);
    expect(payload?.bars?.[0]?.close).toBe(9);
    expect(payload?.seqAckFrom).toBe(4);
  });

  test('a hole in the keepalive run is not acknowledged', () => {
    const seen: Redesign2Frame[][] = [];
    let fire: (() => void) | undefined;
    const c = new TipCoalescer(
      (frames) => seen.push(frames),
      16,
      (fn) => {
        fire = fn;
        return () => undefined;
      },
    );
    c.push([
      {
        type: 'full',
        id: SUB,
        sessionId: 's',
        seq: 4,
        payload: { seriesKey: SUB, count: 1, closed_upto: 0 },
      },
      {
        type: 'delta',
        id: SUB,
        sessionId: 's',
        seq: 6,
        payload: { unchanged: true, forming: true, base_index: 0, count: 1, tail_len: 1, closed_upto: 0 },
      },
      {
        type: 'delta',
        id: SUB,
        sessionId: 's',
        seq: 7,
        payload: {
          forming: true,
          bars: [{ close: 1 }],
          base_index: 0,
          count: 1,
          tail_len: 1,
          closed_upto: 0,
        },
      },
    ]);
    fire?.();
    const tip = seen.at(-1)?.[0];
    const payload = tip?.payload as { seqAckFrom?: number } | undefined;
    expect(tip?.seq).toBe(7);
    expect(payload?.seqAckFrom).toBeUndefined();
  });

  test('JSON decode strips a forged seq ack', () => {
    const raw = JSON.stringify({
      type: 'delta',
      id: SUB,
      sessionId: 'ses-1',
      seq: 3,
      payload: { base_index: 0, count: 1, tail_len: 1, closed_upto: 0, seqAckFrom: 1 },
    });
    const out = decodeInbound(raw, tableWithSub());
    expect(out.ok).toBe(true);
    if (out.ok && out.kind === 'frames') {
      expect(out.frames[0]?.payload).not.toHaveProperty('seqAckFrom');
    }
  });
});
