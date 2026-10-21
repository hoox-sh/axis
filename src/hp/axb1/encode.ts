// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * AXB1 encoder (tests + mock engine).
 *
 * @module hp/axb1/encode
 */

import { BinWriter } from './binary';
import {
  AXB1_HEADER_BYTES,
  AXB1_HDR_COMPRESSED,
  AXB1_MAGIC,
  AXB1_MAX_PAYLOAD,
  AXB1_STATUS_CODES,
  AXB1_VERSION,
  Axb1Opcode,
  TipMask,
  ValueKind,
} from './constants';
import { assertPriceScale } from './ticks';
import type { Axb1Frame, Axb1HeaderFields, Axb1OhlcvSnapshot, Axb1PlotColumn, Axb1TipFields } from './types';

function headerOf(frame: Axb1Frame): Axb1HeaderFields {
  return {
    seq: frame.seq,
    subIdHash: frame.subIdHash,
    sessionHash: frame.sessionHash,
    tsMs: frame.tsMs,
    hdrFlags: frame.hdrFlags,
  };
}

export function encodeEnvelope(header: Axb1HeaderFields, payload: Uint8Array): Uint8Array {
  const flags = header.hdrFlags ?? 0;
  if (flags & AXB1_HDR_COMPRESSED) {
    throw new RangeError('AXB1 v1 forbids compressed payloads');
  }
  if (payload.byteLength % 4 !== 0) {
    throw new RangeError('payload_bytes must be a multiple of 4');
  }
  if (payload.byteLength > AXB1_MAX_PAYLOAD) {
    throw new RangeError('payload too large');
  }
  const out = new Uint8Array(AXB1_HEADER_BYTES + payload.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, AXB1_MAGIC, true);
  view.setUint8(4, AXB1_VERSION);
  view.setUint8(5, 0); // filled by caller via opcode on the frame
  view.setUint16(6, flags, true);
  view.setUint32(8, header.subIdHash >>> 0, true);
  view.setUint32(12, header.seq >>> 0, true);
  view.setUint32(16, header.sessionHash >>> 0, true);
  view.setUint32(20, payload.byteLength, true);
  view.setBigUint64(24, header.tsMs ?? 0n, true);
  out.set(payload, AXB1_HEADER_BYTES);
  return out;
}

function wrap(opcode: Axb1Opcode, header: Axb1HeaderFields, payload: Uint8Array): Uint8Array {
  const env = encodeEnvelope(header, payload);
  env[5] = opcode;
  return env;
}

function writeTip(w: BinWriter, tip: Axb1TipFields, requireTime: boolean): void {
  const mask = tip.mask >>> 0;
  if (requireTime && !(mask & TipMask.TIME)) {
    throw new RangeError('TIP_UPDATE requires TIME');
  }
  w.u32(mask);
  w.u32(tip.flags >>> 0);
  if (mask & TipMask.OPEN) {
    if (tip.open == null) throw new TypeError('TIP open missing');
    w.i64(tip.open);
  }
  if (mask & TipMask.HIGH) {
    if (tip.high == null) throw new TypeError('TIP high missing');
    w.i64(tip.high);
  }
  if (mask & TipMask.LOW) {
    if (tip.low == null) throw new TypeError('TIP low missing');
    w.i64(tip.low);
  }
  if (mask & TipMask.CLOSE) {
    if (tip.close == null) throw new TypeError('TIP close missing');
    w.i64(tip.close);
  }
  if (mask & TipMask.VOLUME) {
    if (tip.volume == null || !Number.isFinite(tip.volume)) throw new TypeError('TIP volume missing');
    w.f64(tip.volume);
  }
  if (mask & TipMask.TIME) {
    if (tip.timeS == null || !Number.isFinite(tip.timeS)) throw new TypeError('TIP time missing');
    w.i32(tip.timeS);
    w.pad(4);
  }
}

function writeOhlcv(w: BinWriter, snap: Axb1OhlcvSnapshot): void {
  assertPriceScale(snap.priceScale);
  const n = snap.count;
  if (
    snap.timeS.length !== n ||
    snap.open.length !== n ||
    snap.high.length !== n ||
    snap.low.length !== n ||
    snap.close.length !== n ||
    snap.volume.length !== n ||
    snap.flags.length !== n
  ) {
    throw new RangeError('SNAPSHOT_OHLCV column length mismatch');
  }
  w.u8(snap.priceScale);
  w.pad(3);
  w.u32(n);
  w.u32(snap.closedUpto);
  w.u32(snap.hotFromIndex);
  for (let i = 0; i < n; i++) w.i32(snap.timeS[i] as number);
  w.align(8);
  for (let i = 0; i < n; i++) w.i64(snap.open[i] as bigint);
  for (let i = 0; i < n; i++) w.i64(snap.high[i] as bigint);
  for (let i = 0; i < n; i++) w.i64(snap.low[i] as bigint);
  for (let i = 0; i < n; i++) w.i64(snap.close[i] as bigint);
  for (let i = 0; i < n; i++) w.f64(snap.volume[i] as number);
  for (let i = 0; i < n; i++) w.u8(snap.flags[i] as number);
  w.padTo4();
}

function writePlots(w: BinWriter, count: number, closedUpto: number, times: number[] | null, plots: Axb1PlotColumn[]): void {
  w.u32(count);
  w.u32(closedUpto);
  w.u32(plots.length);
  w.u32(times ? 1 : 0);
  if (times) {
    if (times.length !== count) throw new RangeError('SNAPSHOT_PLOTS times length');
    for (let i = 0; i < count; i++) w.i32(times[i] as number);
    w.align(8);
  }
  for (const col of plots) {
    w.u8(col.kind);
    w.u8(0);
    const keyBytes = new TextEncoder().encode(col.key);
    if (keyBytes.byteLength > 0xffff) throw new RangeError('plot key too long');
    w.u16(keyBytes.byteLength);
    w.raw(keyBytes);
    w.align(8);
    if (col.kind === ValueKind.PriceTicks) {
      const ticks = col.ticks;
      if (!ticks || ticks.length !== count) throw new RangeError('plot ticks length');
      for (let i = 0; i < count; i++) w.i64(ticks[i] as bigint);
    } else {
      const values = col.values;
      if (!values || values.length !== count) throw new RangeError('plot values length');
      for (let i = 0; i < count; i++) w.f64(values[i] as number);
    }
  }
  w.padTo4();
}

function statusCodeByte(code: string): number {
  const i = (AXB1_STATUS_CODES as readonly string[]).indexOf(code);
  return i < 0 ? 255 : i;
}

export function encodeFrame(frame: Axb1Frame): Uint8Array {
  const header = headerOf(frame);
  const w = new BinWriter();
  switch (frame.opcode) {
    case Axb1Opcode.HEARTBEAT:
    case Axb1Opcode.UNCHANGED:
      w.padTo4();
      return wrap(frame.opcode, header, w.finish());
    case Axb1Opcode.STATUS: {
      w.u8(statusCodeByte(frame.statusCode));
      w.u8(0);
      const detail = new TextEncoder().encode(frame.detail);
      if (detail.byteLength > 0xffff) throw new RangeError('status detail too long');
      w.u16(detail.byteLength);
      w.raw(detail);
      w.align(4);
      w.u32(frame.have);
      w.u32(frame.need);
      w.padTo4();
      return wrap(frame.opcode, header, w.finish());
    }
    case Axb1Opcode.SNAPSHOT_OHLCV:
      writeOhlcv(w, frame);
      return wrap(frame.opcode, header, w.finish());
    case Axb1Opcode.SNAPSHOT_PLOTS:
      writePlots(w, frame.count, frame.closedUpto, frame.times, frame.plots);
      return wrap(frame.opcode, header, w.finish());
    case Axb1Opcode.TIP_UPDATE:
      writeTip(w, frame, true);
      w.padTo4();
      return wrap(frame.opcode, header, w.finish());
    case Axb1Opcode.APPEND_BAR:
      assertPriceScale(frame.priceScale);
      w.u8(frame.priceScale);
      w.pad(3);
      w.u32(frame.closedIndex);
      w.i32(frame.closedTime);
      w.pad(4);
      w.i64(frame.open);
      w.i64(frame.high);
      w.i64(frame.low);
      w.i64(frame.close);
      w.f64(frame.volume);
      writeTip(w, frame.tip, false);
      w.padTo4();
      return wrap(frame.opcode, header, w.finish());
    case Axb1Opcode.PLOT_TIP:
      w.u32(frame.plots.length);
      w.u32(0);
      for (const p of frame.plots) {
        w.u32(p.keyHash >>> 0);
        w.u8(p.kind);
        w.pad(3);
        if (p.kind === ValueKind.PriceTicks) {
          if (p.ticks == null) throw new TypeError('PLOT_TIP ticks missing');
          w.i64(p.ticks);
        } else {
          if (p.value == null || !Number.isFinite(p.value)) throw new TypeError('PLOT_TIP value missing');
          w.f64(p.value);
        }
      }
      w.padTo4();
      return wrap(frame.opcode, header, w.finish());
    case Axb1Opcode.CLOSE_VERIFY:
      w.u32(frame.index);
      w.i32(frame.timeS);
      w.i64(frame.open);
      w.i64(frame.high);
      w.i64(frame.low);
      w.i64(frame.close);
      w.f64(frame.volume);
      w.padTo4();
      return wrap(frame.opcode, header, w.finish());
    case Axb1Opcode.ERROR: {
      const code = new TextEncoder().encode(frame.code);
      const message = new TextEncoder().encode(frame.message);
      if (code.byteLength > 0xffff || message.byteLength > 0xffff) {
        throw new RangeError('ERROR strings too long');
      }
      w.u16(code.byteLength);
      w.u16(message.byteLength);
      w.u8(frame.retryable ? 1 : 0);
      w.pad(3);
      w.raw(code);
      w.raw(message);
      w.padTo4();
      return wrap(frame.opcode, header, w.finish());
    }
    case Axb1Opcode.JSON_BLOB: {
      const json = new TextEncoder().encode(frame.json);
      w.u32(json.byteLength);
      w.raw(json);
      w.padTo4();
      return wrap(frame.opcode, header, w.finish());
    }
    default:
      throw new RangeError('unknown AXB1 opcode');
  }
}
