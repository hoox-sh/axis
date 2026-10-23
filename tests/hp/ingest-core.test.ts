/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import { validateRedesign2Frame, type Redesign2Frame } from '../../src/engine/frames';
import { Axb1Opcode, TipMask } from '../../src/hp/axb1/constants';
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
  });

  test('bad magic is not silently treated as JSON if it is not utf8 JSON', () => {
    const buf = new Uint8Array([0, 1, 2, 3, 4, 5]);
    const out = decodeInbound(buf, new IngestCursorTable());
    expect(out.ok).toBe(false);
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
});
