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
import type { Axb1Frame } from '../../src/hp/axb1/types';
import vectors from './axb1-vectors.json';

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
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
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
