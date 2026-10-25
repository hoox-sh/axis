/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import { assertI64Aligned } from '../../src/hp/axb1/binary';
import {
  AXB1_HEADER_BYTES,
  AXB1_MAGIC,
  Axb1Opcode,
  TipMask,
  ValueKind,
} from '../../src/hp/axb1/constants';
import { bytesToHex, decodeEnvelope, decodeFrame, hexToBytes } from '../../src/hp/axb1/decode';
import { encodeFrame } from '../../src/hp/axb1/encode';
import { fnv1a32 } from '../../src/hp/axb1/hash';
import { float32LosesTicks, priceToTicks, ticksToPrice } from '../../src/hp/axb1/ticks';
import type { Axb1Frame } from '../../src/hp/axb1/types';
import vectors from './axb1-vectors.json';

/** Price whose float32 rounding disagrees with float64 ticks at scale 8. */
const F32_LOSSY_PRICE = 123456.78901234;
const F32_LOSSY_SCALE = 8;

function i64le(ticks: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, ticks, true);
  return out;
}

function f32le(price: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setFloat32(0, price, true);
  return out;
}

function sliceAt(bytes: Uint8Array, offset: number, n: number): Uint8Array {
  return bytes.subarray(offset, offset + n);
}

const hdr = {
  seq: 0,
  subIdHash: 0,
  sessionHash: 0,
  tsMs: 0n,
};

describe('AXB1 envelope', () => {
  test('heartbeat matches the golden vector and round-trips', () => {
    const bytes = encodeFrame({ opcode: Axb1Opcode.HEARTBEAT, ...hdr });
    expect(bytes.byteLength).toBe(AXB1_HEADER_BYTES);
    const heartbeat = vectors.vectors.find((v) => v.name === 'heartbeat');
    expect(heartbeat).toBeDefined();
    expect(bytesToHex(bytes)).toBe(heartbeat?.hex);
    const env = decodeEnvelope(bytes);
    expect(env.magic).toBe(AXB1_MAGIC);
    expect(env.opcode).toBe(Axb1Opcode.HEARTBEAT);
    expect(env.payloadBytes).toBe(0);
    expect(decodeFrame(bytes).opcode).toBe(Axb1Opcode.HEARTBEAT);
  });

  test('rejects magic / version / compressed / oversized / odd payload', () => {
    const good = encodeFrame({ opcode: Axb1Opcode.HEARTBEAT, ...hdr });
    const badMagic = good.slice();
    badMagic[0] = 0;
    expect(() => decodeEnvelope(badMagic)).toThrow(/magic/);
    const badVer = good.slice();
    badVer[4] = 2;
    expect(() => decodeEnvelope(badVer)).toThrow(/version/);
    const compressed = good.slice();
    compressed[6] = 2;
    expect(() => decodeEnvelope(compressed)).toThrow(/compressed/);
    expect(() => decodeEnvelope(good.slice(0, 16))).toThrow(/truncated/);
  });

  test('payload starts at byte 32 so an i64 view is aligned', () => {
    const frame: Axb1Frame = {
      opcode: Axb1Opcode.CLOSE_VERIFY,
      ...hdr,
      seq: 7,
      index: 3,
      timeS: 1_700_000_000,
      open: 1n,
      high: 4n,
      low: 1n,
      close: 3n,
      volume: 10.5,
    };
    const bytes = encodeFrame(frame);
    expect(AXB1_HEADER_BYTES % 8).toBe(0);
    assertI64Aligned(AXB1_HEADER_BYTES);
    const i64 = new BigInt64Array(bytes.buffer, bytes.byteOffset + AXB1_HEADER_BYTES + 8, 4);
    expect([...i64]).toEqual([1n, 4n, 1n, 3n]);
    expect(() => assertI64Aligned(4)).toThrow(/misaligned/);
    expect(() => new BigInt64Array(bytes.buffer, 4, 1)).toThrow();
  });

  test('decodes from a subarray whose envelope is not at byteOffset 0', () => {
    const inner = encodeFrame({ opcode: Axb1Opcode.UNCHANGED, ...hdr, seq: 9 });
    const padded = new Uint8Array(16 + inner.byteLength);
    padded.set(inner, 16);
    const view = padded.subarray(16);
    const decoded = decodeFrame(view);
    expect(decoded.opcode).toBe(Axb1Opcode.UNCHANGED);
    expect(decoded.seq).toBe(9);
  });
});

describe('AXB1 payloads', () => {
  test('TIP_UPDATE close+volume+time round-trips', () => {
    const frame: Axb1Frame = {
      opcode: Axb1Opcode.TIP_UPDATE,
      ...hdr,
      seq: 11,
      subIdHash: fnv1a32('series:binance|spot|BTC/USDT|1m'),
      mask: TipMask.CLOSE | TipMask.VOLUME | TipMask.TIME,
      flags: 1,
      close: 12n,
      volume: 3.25,
      timeS: 60,
    };
    const decoded = decodeFrame(encodeFrame(frame));
    expect(decoded).toEqual(frame);
  });

  test('TIP_UPDATE without TIME is rejected', () => {
    expect(() =>
      encodeFrame({
        opcode: Axb1Opcode.TIP_UPDATE,
        ...hdr,
        mask: TipMask.CLOSE,
        flags: 1,
        close: 1n,
      }),
    ).toThrow(/TIME/);
  });

  test('SNAPSHOT_OHLCV columnar round-trip (odd count pads times to 8)', () => {
    const frame: Axb1Frame = {
      opcode: Axb1Opcode.SNAPSHOT_OHLCV,
      ...hdr,
      seq: 1,
      priceScale: 8,
      count: 1,
      closedUpto: 0,
      hotFromIndex: 0,
      timeS: [60],
      open: [100n],
      high: [110n],
      low: [90n],
      close: [105n],
      volume: [1.5],
      flags: [1],
    };
    const bytes = encodeFrame(frame);
    expect(bytes.byteLength % 4).toBe(0);
    expect(decodeFrame(bytes)).toEqual(frame);
  });

  test('SNAPSHOT_OHLCV stores i64 ticks, not float32, for a price float32 cannot represent', () => {
    expect(float32LosesTicks(F32_LOSSY_PRICE, F32_LOSSY_SCALE)).toBe(true);
    const ticks = priceToTicks(F32_LOSSY_PRICE, F32_LOSSY_SCALE);
    const f32 = new Float32Array([F32_LOSSY_PRICE])[0] as number;
    const f32Ticks = priceToTicks(f32, F32_LOSSY_SCALE);
    expect(ticks).not.toBe(f32Ticks);

    const frame: Axb1Frame = {
      opcode: Axb1Opcode.SNAPSHOT_OHLCV,
      ...hdr,
      seq: 2,
      priceScale: F32_LOSSY_SCALE,
      count: 1,
      closedUpto: 0,
      hotFromIndex: 0,
      timeS: [60],
      open: [ticks],
      high: [ticks + 1n],
      low: [ticks - 1n],
      close: [ticks],
      volume: [1],
      flags: [1],
    };
    const bytes = encodeFrame(frame);
    const decoded = decodeFrame(bytes);
    expect(decoded.opcode).toBe(Axb1Opcode.SNAPSHOT_OHLCV);
    if (decoded.opcode !== Axb1Opcode.SNAPSHOT_OHLCV) throw new Error('expected SNAPSHOT_OHLCV');
    expect(decoded.close[0]).toBe(ticks);
    expect(decoded.close[0]).not.toBe(f32Ticks);
    expect(ticksToPrice(decoded.close[0] as bigint, F32_LOSSY_SCALE)).toBe(
      ticksToPrice(ticks, F32_LOSSY_SCALE),
    );
    expect(ticksToPrice(decoded.close[0] as bigint, F32_LOSSY_SCALE)).not.toBe(
      ticksToPrice(f32Ticks, F32_LOSSY_SCALE),
    );

    // payload: u8 scale + 3 pad + 3×u32 + i32 time + align8 → OHLC i64s at +24
    const ohlcOff = AXB1_HEADER_BYTES + 24;
    const want = [ticks, ticks + 1n, ticks - 1n, ticks];
    const f32Bits = f32le(F32_LOSSY_PRICE);
    for (let i = 0; i < 4; i++) {
      const field = sliceAt(bytes, ohlcOff + i * 8, 8);
      expect([...field]).toEqual([...i64le(want[i] as bigint)]);
      expect(field.byteLength).toBe(8);
      expect([...sliceAt(field, 0, 4)]).not.toEqual([...f32Bits]);
    }
  });

  test('TIP_UPDATE close is 8-byte little-endian i64 ticks, not IEEE f32', () => {
    expect(float32LosesTicks(F32_LOSSY_PRICE, F32_LOSSY_SCALE)).toBe(true);
    const ticks = priceToTicks(F32_LOSSY_PRICE, F32_LOSSY_SCALE);
    const f32 = new Float32Array([F32_LOSSY_PRICE])[0] as number;
    const frame: Axb1Frame = {
      opcode: Axb1Opcode.TIP_UPDATE,
      ...hdr,
      seq: 12,
      mask: TipMask.CLOSE | TipMask.TIME,
      flags: 1,
      close: ticks,
      timeS: 60,
    };
    const bytes = encodeFrame(frame);
    const decoded = decodeFrame(bytes);
    expect(decoded.opcode).toBe(Axb1Opcode.TIP_UPDATE);
    if (decoded.opcode !== Axb1Opcode.TIP_UPDATE) throw new Error('expected TIP_UPDATE');
    expect(decoded.close).toBe(ticks);
    expect(decoded.close).not.toBe(priceToTicks(f32, F32_LOSSY_SCALE));

    // payload: u32 mask + u32 flags, then close i64
    const closeOff = AXB1_HEADER_BYTES + 8;
    const field = sliceAt(bytes, closeOff, 8);
    expect([...field]).toEqual([...i64le(ticks)]);
    expect([...sliceAt(field, 0, 4)]).not.toEqual([...f32le(F32_LOSSY_PRICE)]);
  });

  test('TIP_UPDATE refuses a non-bigint close tick', () => {
    expect(() =>
      encodeFrame({
        opcode: Axb1Opcode.TIP_UPDATE,
        ...hdr,
        mask: TipMask.CLOSE | TipMask.TIME,
        flags: 1,
        close: F32_LOSSY_PRICE as unknown as bigint,
        timeS: 60,
      }),
    ).toThrow(TypeError);
  });

  test('SNAPSHOT_PLOTS ticks + float64 + times', () => {
    const frame: Axb1Frame = {
      opcode: Axb1Opcode.SNAPSHOT_PLOTS,
      ...hdr,
      count: 2,
      closedUpto: 1,
      times: [60, 120],
      plots: [
        { key: 'close', kind: ValueKind.PriceTicks, ticks: [1n, 2n] },
        { key: '%B', kind: ValueKind.UnitFloat64, values: [0.2, 0.8] },
      ],
    };
    const decoded = decodeFrame(encodeFrame(frame));
    expect(decoded).toEqual(frame);
    if (decoded.opcode !== Axb1Opcode.SNAPSHOT_PLOTS) throw new Error('expected SNAPSHOT_PLOTS');
    expect(decoded.times).toEqual([60, 120]);
    expect(decoded.times?.length).toBe(decoded.count);
    for (const col of decoded.plots) {
      const values = col.ticks ?? col.values;
      expect(values?.length).toBe(decoded.count);
    }
  });

  test('SNAPSHOT_PLOTS times stay optional', () => {
    const frame: Axb1Frame = {
      opcode: Axb1Opcode.SNAPSHOT_PLOTS,
      ...hdr,
      count: 1,
      closedUpto: 0,
      times: null,
      plots: [{ key: 'rsi', kind: ValueKind.UnitFloat64, values: [55] }],
    };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });

  test('SNAPSHOT_PLOTS times length mismatch throws', () => {
    expect(() =>
      encodeFrame({
        opcode: Axb1Opcode.SNAPSHOT_PLOTS,
        ...hdr,
        count: 2,
        closedUpto: 1,
        times: [60],
        plots: [{ key: 'close', kind: ValueKind.PriceTicks, ticks: [1n, 2n] }],
      }),
    ).toThrow(/times length/);
  });

  test('SNAPSHOT_PLOTS plot column length mismatch throws', () => {
    expect(() =>
      encodeFrame({
        opcode: Axb1Opcode.SNAPSHOT_PLOTS,
        ...hdr,
        count: 2,
        closedUpto: 1,
        times: [60, 120],
        plots: [{ key: 'close', kind: ValueKind.PriceTicks, ticks: [1n] }],
      }),
    ).toThrow(/ticks length/);
    expect(() =>
      encodeFrame({
        opcode: Axb1Opcode.SNAPSHOT_PLOTS,
        ...hdr,
        count: 2,
        closedUpto: 1,
        times: null,
        plots: [{ key: '%B', kind: ValueKind.UnitFloat64, values: [0.2] }],
      }),
    ).toThrow(/values length/);
  });

  test('APPEND_BAR + PLOT_TIP + STATUS + ERROR + JSON_BLOB round-trip', () => {
    const append: Axb1Frame = {
      opcode: Axb1Opcode.APPEND_BAR,
      ...hdr,
      priceScale: 8,
      closedIndex: 4,
      closedTime: 240,
      open: 1n,
      high: 2n,
      low: 1n,
      close: 2n,
      volume: 9,
      tip: {
        mask: TipMask.OPEN | TipMask.TIME,
        flags: 1,
        open: 2n,
        timeS: 300,
      },
    };
    expect(decodeFrame(encodeFrame(append))).toEqual(append);

    const plotTip: Axb1Frame = {
      opcode: Axb1Opcode.PLOT_TIP,
      ...hdr,
      plots: [
        { keyHash: fnv1a32('close'), kind: ValueKind.PriceTicks, ticks: 99n },
        { keyHash: fnv1a32('%B'), kind: ValueKind.UnitFloat64, value: 0.5 },
      ],
    };
    expect(decodeFrame(encodeFrame(plotTip))).toEqual(plotTip);

    const status: Axb1Frame = {
      opcode: Axb1Opcode.STATUS,
      ...hdr,
      statusCode: 'live',
      detail: 'ok',
      have: 10,
      need: 10,
    };
    expect(decodeFrame(encodeFrame(status))).toEqual(status);

    const err: Axb1Frame = {
      opcode: Axb1Opcode.ERROR,
      ...hdr,
      code: 'DATA_MISS',
      message: 'gap',
      retryable: true,
    };
    expect(decodeFrame(encodeFrame(err))).toEqual(err);

    const blob: Axb1Frame = {
      opcode: Axb1Opcode.JSON_BLOB,
      ...hdr,
      json: '{"drawings":[]}',
    };
    expect(decodeFrame(encodeFrame(blob))).toEqual(blob);
  });

  test('hexToBytes inverts bytesToHex', () => {
    const bytes = encodeFrame({ opcode: Axb1Opcode.HEARTBEAT, ...hdr });
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
  });
});

describe('FNV-1a 32', () => {
  test('empty string is the offset basis', () => {
    expect(fnv1a32('')).toBe(2166136261);
  });
});

/**
 * Spec → frame mapper for the shared golden vectors (`axb1-vectors.json`).
 * The same vectors are asserted by PYNE's `tests/test_axb1.py`, so the spec
 * must stay language-neutral: int64/uint64 fields are decimal strings.
 */
function frameFromSpec(raw: Record<string, unknown>): Axb1Frame {
  const { opcode, seq, sub_id_hash, session_hash, ts_ms, hdr_flags, ...rest } = raw;
  const header = {
    seq: seq as number,
    subIdHash: sub_id_hash as number,
    sessionHash: session_hash as number,
    tsMs: BigInt(ts_ms as string),
    hdrFlags: (hdr_flags as number) ?? 0,
  };
  const tipOf = (t: Record<string, unknown>) => ({
    mask: (t.mask as string[]).reduce(
      (m, n) => m | (TipMask as unknown as Record<string, number>)[n],
      0,
    ),
    flags: t.flags as number,
    timeS: t.time_s as number | undefined,
    open: t.open != null ? BigInt(t.open as string) : undefined,
    high: t.high != null ? BigInt(t.high as string) : undefined,
    low: t.low != null ? BigInt(t.low as string) : undefined,
    close: t.close != null ? BigInt(t.close as string) : undefined,
    volume: t.volume as number | undefined,
  });
  const kindOf = (k: string) =>
    k === 'price_ticks' ? ValueKind.PriceTicks : ValueKind.UnitFloat64;
  switch (opcode) {
    case 'HEARTBEAT':
      return { opcode: Axb1Opcode.HEARTBEAT, ...header };
    case 'UNCHANGED':
      return { opcode: Axb1Opcode.UNCHANGED, ...header };
    case 'STATUS':
      return {
        opcode: Axb1Opcode.STATUS,
        ...header,
        statusCode: rest.status_code as string,
        detail: rest.detail as string,
        have: rest.have as number,
        need: rest.need as number,
      };
    case 'TIP_UPDATE':
      return { opcode: Axb1Opcode.TIP_UPDATE, ...header, ...tipOf(rest) };
    case 'APPEND_BAR':
      return {
        opcode: Axb1Opcode.APPEND_BAR,
        ...header,
        priceScale: rest.price_scale as number,
        closedIndex: rest.closed_index as number,
        closedTime: rest.closed_time as number,
        open: BigInt(rest.open as string),
        high: BigInt(rest.high as string),
        low: BigInt(rest.low as string),
        close: BigInt(rest.close as string),
        volume: rest.volume as number,
        tip: tipOf(rest.tip as Record<string, unknown>),
      };
    case 'CLOSE_VERIFY':
      return {
        opcode: Axb1Opcode.CLOSE_VERIFY,
        ...header,
        index: rest.index as number,
        timeS: rest.time_s as number,
        open: BigInt(rest.open as string),
        high: BigInt(rest.high as string),
        low: BigInt(rest.low as string),
        close: BigInt(rest.close as string),
        volume: rest.volume as number,
      };
    case 'PLOT_TIP':
      return {
        opcode: Axb1Opcode.PLOT_TIP,
        ...header,
        plots: (rest.plots as Array<Record<string, unknown>>).map((p) => ({
          keyHash: p.key_hash as number,
          kind: kindOf(p.kind as string),
          ticks: p.ticks != null ? BigInt(p.ticks as string) : undefined,
          value: p.value as number | undefined,
        })),
      };
    case 'SNAPSHOT_OHLCV':
      return {
        opcode: Axb1Opcode.SNAPSHOT_OHLCV,
        ...header,
        priceScale: rest.price_scale as number,
        count: rest.count as number,
        closedUpto: rest.closed_upto as number,
        hotFromIndex: rest.hot_from_index as number,
        timeS: rest.time_s as number[],
        open: (rest.open as string[]).map((x) => BigInt(x)),
        high: (rest.high as string[]).map((x) => BigInt(x)),
        low: (rest.low as string[]).map((x) => BigInt(x)),
        close: (rest.close as string[]).map((x) => BigInt(x)),
        volume: rest.volume as number[],
        flags: rest.flags as number[],
      };
    case 'SNAPSHOT_PLOTS':
      return {
        opcode: Axb1Opcode.SNAPSHOT_PLOTS,
        ...header,
        count: rest.count as number,
        closedUpto: rest.closed_upto as number,
        times: (rest.times as number[] | null) ?? null,
        plots: (rest.plots as Array<Record<string, unknown>>).map((col) => ({
          key: col.key as string,
          kind: kindOf(col.kind as string),
          ticks: col.ticks != null ? (col.ticks as string[]).map((x) => BigInt(x)) : undefined,
          values: col.values as number[] | undefined,
        })),
      };
    case 'ERROR':
      return {
        opcode: Axb1Opcode.ERROR,
        ...header,
        code: rest.code as string,
        message: rest.message as string,
        retryable: rest.retryable as boolean,
      };
    case 'JSON_BLOB':
      return { opcode: Axb1Opcode.JSON_BLOB, ...header, json: rest.json as string };
    default:
      throw new Error(`unknown golden-vector opcode ${String(opcode)}`);
  }
}

describe('AXB1 golden vectors (shared with PYNE)', () => {
  const vectorsFile = vectors as unknown as {
    hash_checks: Array<{ input: string; fnv1a32: number }>;
    vectors: Array<{ name: string; frame: Record<string, unknown>; hex: string }>;
  };

  test('fnv1a32 hash checks match the shared file', () => {
    for (const check of vectorsFile.hash_checks) {
      expect(fnv1a32(check.input)).toBe(check.fnv1a32);
    }
  });

  test.each(vectorsFile.vectors.map((v) => [v.name, v] as const))(
    'vector %s: encoder emits the golden hex and round-trips',
    (_name, vector) => {
      const frame = frameFromSpec(vector.frame);
      const bytes = encodeFrame(frame);
      expect(bytesToHex(bytes)).toBe(vector.hex);
      const decoded = decodeFrame(bytes);
      expect(decoded.opcode).toBe(frame.opcode);
      expect(bytesToHex(encodeFrame(decoded))).toBe(vector.hex);
    },
  );
});
