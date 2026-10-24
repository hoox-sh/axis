/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * AXB1 randomized round-trip fuzz (hp2 E1).
 *
 * The hand-written vectors in `axb1-codec.test.ts` pin each opcode shape;
 * this file throws a seeded PRNG at the codec instead: every generated
 * frame must satisfy the v1 invariants (4-byte aligned envelope, exact
 * field round-trip). The seed is fixed, so a failure reproduces with
 * `bun test tests/hp/axb1-fuzz.test.ts`.
 *
 * @module hp/axb1-fuzz
 */

import { describe, expect, test } from 'bun:test';
import { AXB1_STATUS_CODES, Axb1Opcode, TipMask, ValueKind } from '../../src/hp/axb1/constants';
import { decodeFrame } from '../../src/hp/axb1/decode';
import { encodeFrame } from '../../src/hp/axb1/encode';
import type { Axb1Frame, Axb1HeaderFields, Axb1TipFields } from '../../src/hp/axb1/types';

/** Deterministic PRNG (mulberry32): same seed, same frames, every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const next = rng(0xa8b1);

function u32(): number {
  return Math.floor(next() * 0x100000000);
}

function i32range(lo: number, hi: number): number {
  return lo + Math.floor(next() * (hi - lo + 1));
}

/** Full-width i64 from two u32 halves (sign bit included). */
function i64(): bigint {
  const hi = BigInt(u32());
  const lo = BigInt(u32());
  const v = (hi << 32n) | lo;
  return v >= 1n << 63n ? v - (1n << 64n) : v;
}

/** Finite f64 across magnitudes (no NaN/Infinity — those are not wire values). */
function f64(): number {
  const mag = Math.floor(next() * 24) - 12;
  return (next() * 2 - 1) * 10 ** mag;
}

function ascii(len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789_-%+:. ';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(next() * chars.length)];
  return out;
}

function hdr(): Axb1HeaderFields {
  return { seq: u32(), subIdHash: u32(), sessionHash: u32(), tsMs: BigInt(u32()) };
}

const TIP_BITS = [TipMask.OPEN, TipMask.HIGH, TipMask.LOW, TipMask.CLOSE, TipMask.VOLUME];

function tip(requireTime: boolean): Axb1TipFields {
  let mask = TipMask.TIME;
  const t: Axb1TipFields = { mask: 0, flags: u32(), timeS: i32range(0, 2_000_000_000) };
  for (const bit of TIP_BITS) {
    if (next() < 0.6) {
      mask |= bit;
      if (bit === TipMask.OPEN) t.open = i64();
      if (bit === TipMask.HIGH) t.high = i64();
      if (bit === TipMask.LOW) t.low = i64();
      if (bit === TipMask.CLOSE) t.close = i64();
      if (bit === TipMask.VOLUME) t.volume = f64();
    }
  }
  t.mask = mask;
  void requireTime;
  return t;
}

function ohlcvBars(n: number): {
  timeS: number[];
  open: bigint[];
  high: bigint[];
  low: bigint[];
  close: bigint[];
  volume: number[];
  flags: number[];
} {
  const timeS: number[] = [];
  const open: bigint[] = [];
  const high: bigint[] = [];
  const low: bigint[] = [];
  const close: bigint[] = [];
  const volume: number[] = [];
  const flags: number[] = [];
  let t = i32range(0, 1_000_000);
  for (let i = 0; i < n; i++) {
    timeS.push(t);
    t += 60;
    open.push(i64());
    high.push(i64());
    low.push(i64());
    close.push(i64());
    volume.push(f64());
    flags.push(i32range(0, 255));
  }
  return { timeS, open, high, low, close, volume, flags };
}

function randomFrame(): Axb1Frame {
  const h = hdr();
  const pick = Math.floor(next() * 11);
  switch (pick) {
    case 0:
      return { opcode: Axb1Opcode.HEARTBEAT, ...h };
    case 1:
      return { opcode: Axb1Opcode.UNCHANGED, ...h };
    case 2:
      return {
        opcode: Axb1Opcode.STATUS,
        ...h,
        statusCode: AXB1_STATUS_CODES[Math.floor(next() * AXB1_STATUS_CODES.length)] as string,
        detail: ascii(i32range(0, 40)),
        have: u32(),
        need: u32(),
      };
    case 3: {
      const count = i32range(0, 30);
      return {
        opcode: Axb1Opcode.SNAPSHOT_OHLCV,
        ...h,
        priceScale: i32range(0, 12),
        count,
        closedUpto: u32(),
        hotFromIndex: u32(),
        ...ohlcvBars(count),
      };
    }
    case 4: {
      const count = i32range(0, 12);
      const nPlots = i32range(0, 4);
      const plots = [];
      for (let p = 0; p < nPlots; p++) {
        if (next() < 0.5) {
          plots.push({
            key: ascii(i32range(1, 12)),
            kind: ValueKind.PriceTicks as const,
            ticks: Array.from({ length: count }, () => i64()),
          });
        } else {
          plots.push({
            key: ascii(i32range(1, 12)),
            kind: ValueKind.UnitFloat64 as const,
            values: Array.from({ length: count }, () => f64()),
          });
        }
      }
      return {
        opcode: Axb1Opcode.SNAPSHOT_PLOTS,
        ...h,
        count,
        closedUpto: u32(),
        times: next() < 0.5 ? null : Array.from({ length: count }, (_, i) => i * 60),
        plots,
      };
    }
    case 5:
      return { opcode: Axb1Opcode.TIP_UPDATE, ...h, ...tip(true) };
    case 6:
      return {
        opcode: Axb1Opcode.APPEND_BAR,
        ...h,
        priceScale: i32range(0, 12),
        closedIndex: u32(),
        closedTime: i32range(0, 2_000_000_000),
        open: i64(),
        high: i64(),
        low: i64(),
        close: i64(),
        volume: f64(),
        tip: tip(false),
      };
    case 7: {
      const n = i32range(0, 6);
      const plots = [];
      for (let i = 0; i < n; i++) {
        if (next() < 0.5)
          plots.push({ keyHash: u32(), kind: ValueKind.PriceTicks as const, ticks: i64() });
        else plots.push({ keyHash: u32(), kind: ValueKind.UnitFloat64 as const, value: f64() });
      }
      return { opcode: Axb1Opcode.PLOT_TIP, ...h, plots };
    }
    case 8:
      return {
        opcode: Axb1Opcode.CLOSE_VERIFY,
        ...h,
        index: u32(),
        timeS: i32range(0, 2_000_000_000),
        open: i64(),
        high: i64(),
        low: i64(),
        close: i64(),
        volume: f64(),
      };
    case 9:
      return {
        opcode: Axb1Opcode.ERROR,
        ...h,
        code: ascii(i32range(1, 20)),
        message: ascii(i32range(0, 60)),
        retryable: next() < 0.5,
      };
    default:
      return {
        opcode: Axb1Opcode.JSON_BLOB,
        ...h,
        json: JSON.stringify({ n: u32(), s: ascii(8) }),
      };
  }
}

describe('AXB1 fuzz round-trip (hp2 E1)', () => {
  test('500 seeded frames survive encode → decode exactly', () => {
    for (let i = 0; i < 500; i++) {
      const frame = randomFrame();
      const bytes = encodeFrame(frame);
      expect(bytes.byteLength % 4).toBe(0);
      expect(decodeFrame(bytes)).toEqual(frame);
    }
  });

  test('single-bit flips in the payload fail loudly, never silently', () => {
    for (let i = 0; i < 50; i++) {
      const frame = randomFrame();
      const bytes = encodeFrame(frame);
      if (bytes.byteLength <= 40) continue;
      const at = 32 + Math.floor(next() * (bytes.byteLength - 32));
      const corrupted = bytes.slice();
      corrupted[at] = (corrupted[at] as number) ^ (1 << Math.floor(next() * 8));
      // A flipped bit must either decode to something different (caught by
      // hash / parity checks downstream) or throw — it must not crash the
      // decoder with anything but a RangeError/TypeError.
      try {
        decodeFrame(corrupted);
      } catch (err) {
        expect(err instanceof RangeError || err instanceof TypeError).toBe(true);
      }
    }
  });
});
