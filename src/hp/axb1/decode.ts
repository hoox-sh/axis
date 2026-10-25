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
 * AXB1 decoder (ingest worker).
 *
 * @module hp/axb1/decode
 */

import { assertI64Aligned, BinReader } from './binary';
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
import type { Axb1Frame, Axb1HeaderFields, Axb1TipFields, Axb1Unknown } from './types';

export interface Axb1Envelope {
  magic: number;
  version: number;
  opcode: Axb1Opcode;
  hdrFlags: number;
  subIdHash: number;
  seq: number;
  sessionHash: number;
  payloadBytes: number;
  tsMs: bigint;
  payload: Uint8Array;
}

function asBytes(raw: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
}

/** True when the buffer starts with little-endian `'AXB1'`. */
export function looksLikeAxb1(raw: ArrayBuffer | ArrayBufferView): boolean {
  const bytes = asBytes(raw);
  if (bytes.byteLength < 4) return false;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) === AXB1_MAGIC;
}

export function decodeEnvelope(raw: ArrayBuffer | ArrayBufferView): Axb1Envelope {
  const bytes = asBytes(raw);
  if (bytes.byteLength < AXB1_HEADER_BYTES) throw new RangeError('AXB1 envelope truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== AXB1_MAGIC) throw new RangeError('AXB1 magic mismatch');
  const version = view.getUint8(4);
  if (version !== AXB1_VERSION) throw new RangeError(`AXB1 version ${version} unsupported`);
  const opcode = view.getUint8(5) as Axb1Opcode;
  const hdrFlags = view.getUint16(6, true);
  if (hdrFlags & AXB1_HDR_COMPRESSED) throw new RangeError('AXB1 compressed flag forbidden in v1');
  const payloadBytes = view.getUint32(20, true);
  if (payloadBytes > AXB1_MAX_PAYLOAD) throw new RangeError('AXB1 payload too large');
  if (payloadBytes % 4 !== 0) throw new RangeError('AXB1 payload_bytes must be a multiple of 4');
  const extra = bytes.byteLength - AXB1_HEADER_BYTES - payloadBytes;
  if (extra < 0 || extra > 3) {
    throw new RangeError('AXB1 envelope length mismatch');
  }
  const payload = bytes.subarray(AXB1_HEADER_BYTES, AXB1_HEADER_BYTES + payloadBytes);
  return {
    magic,
    version,
    opcode,
    hdrFlags,
    subIdHash: view.getUint32(8, true),
    seq: view.getUint32(12, true),
    sessionHash: view.getUint32(16, true),
    payloadBytes,
    tsMs: view.getBigUint64(24, true),
    payload,
  };
}

function headerFrom(env: Axb1Envelope): Axb1HeaderFields {
  const header: Axb1HeaderFields = {
    seq: env.seq,
    subIdHash: env.subIdHash,
    sessionHash: env.sessionHash,
    tsMs: env.tsMs,
  };
  if (env.hdrFlags) header.hdrFlags = env.hdrFlags;
  return header;
}

function readTip(r: BinReader, requireTime: boolean): Axb1TipFields {
  const mask = r.u32();
  const flags = r.u32();
  const tip: Axb1TipFields = { mask, flags };
  if (mask & TipMask.OPEN) tip.open = r.i64();
  if (mask & TipMask.HIGH) tip.high = r.i64();
  if (mask & TipMask.LOW) tip.low = r.i64();
  if (mask & TipMask.CLOSE) tip.close = r.i64();
  if (mask & TipMask.VOLUME) tip.volume = r.f64();
  if (mask & TipMask.TIME) {
    tip.timeS = r.i32();
    r.pad(4);
  } else if (requireTime) {
    throw new RangeError('TIP_UPDATE requires TIME');
  }
  return tip;
}

function readN<T>(n: number, read: () => T): T[] {
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(read());
  return out;
}

export function decodeFrame(raw: ArrayBuffer | ArrayBufferView): Axb1Frame | Axb1Unknown {
  const env = decodeEnvelope(raw);
  const h = headerFrom(env);
  const r = new BinReader(env.payload);
  switch (env.opcode) {
    case Axb1Opcode.HEARTBEAT:
      return { opcode: Axb1Opcode.HEARTBEAT, ...h };
    case Axb1Opcode.UNCHANGED:
      return { opcode: Axb1Opcode.UNCHANGED, ...h };
    case Axb1Opcode.STATUS: {
      const codeByte = r.u8();
      r.u8();
      const detailLen = r.u16();
      const detail = r.utf8(detailLen);
      r.align(4);
      const have = r.u32();
      const need = r.u32();
      const statusCode = AXB1_STATUS_CODES[codeByte] ?? `code:${codeByte}`;
      return { opcode: Axb1Opcode.STATUS, ...h, statusCode, detail, have, need };
    }
    case Axb1Opcode.SNAPSHOT_OHLCV: {
      const priceScale = r.u8();
      r.pad(3);
      assertPriceScale(priceScale);
      const count = r.u32();
      const closedUpto = r.u32();
      const hotFromIndex = r.u32();
      const timeS = readN(count, () => r.i32());
      r.align(8);
      const payloadAbs = env.payload.byteOffset + r.off;
      assertI64Aligned(payloadAbs);
      const open = readN(count, () => r.i64());
      const high = readN(count, () => r.i64());
      const low = readN(count, () => r.i64());
      const close = readN(count, () => r.i64());
      const volume = readN(count, () => r.f64());
      const flags = readN(count, () => r.u8());
      return {
        opcode: Axb1Opcode.SNAPSHOT_OHLCV,
        ...h,
        priceScale,
        count,
        closedUpto,
        hotFromIndex,
        timeS,
        open,
        high,
        low,
        close,
        volume,
        flags,
      };
    }
    case Axb1Opcode.SNAPSHOT_PLOTS: {
      const count = r.u32();
      const closedUpto = r.u32();
      const nPlots = r.u32();
      const hasTimes = r.u32() === 1;
      let times: number[] | null = null;
      if (hasTimes) {
        times = readN(count, () => r.i32());
        r.align(8);
      }
      const plots = [];
      for (let i = 0; i < nPlots; i++) {
        const kind = r.u8() as ValueKind;
        r.u8();
        const keyLen = r.u16();
        const key = r.utf8(keyLen);
        r.align(8);
        if (kind === ValueKind.PriceTicks) {
          plots.push({ key, kind, ticks: readN(count, () => r.i64()) });
        } else {
          plots.push({ key, kind, values: readN(count, () => r.f64()) });
        }
      }
      return { opcode: Axb1Opcode.SNAPSHOT_PLOTS, ...h, count, closedUpto, times, plots };
    }
    case Axb1Opcode.TIP_UPDATE:
      return { opcode: Axb1Opcode.TIP_UPDATE, ...h, ...readTip(r, true) };
    case Axb1Opcode.APPEND_BAR: {
      const priceScale = r.u8();
      r.pad(3);
      assertPriceScale(priceScale);
      const closedIndex = r.u32();
      const closedTime = r.i32();
      r.pad(4);
      const open = r.i64();
      const high = r.i64();
      const low = r.i64();
      const close = r.i64();
      const volume = r.f64();
      const tip = readTip(r, false);
      return {
        opcode: Axb1Opcode.APPEND_BAR,
        ...h,
        priceScale,
        closedIndex,
        closedTime,
        open,
        high,
        low,
        close,
        volume,
        tip,
      };
    }
    case Axb1Opcode.PLOT_TIP: {
      const n = r.u32();
      r.u32();
      const plots = [];
      for (let i = 0; i < n; i++) {
        const keyHash = r.u32();
        const kind = r.u8() as ValueKind;
        r.pad(3);
        if (kind === ValueKind.PriceTicks) {
          plots.push({ keyHash, kind, ticks: r.i64() });
        } else {
          plots.push({ keyHash, kind, value: r.f64() });
        }
      }
      return { opcode: Axb1Opcode.PLOT_TIP, ...h, plots };
    }
    case Axb1Opcode.CLOSE_VERIFY: {
      const index = r.u32();
      const timeS = r.i32();
      const open = r.i64();
      const high = r.i64();
      const low = r.i64();
      const close = r.i64();
      const volume = r.f64();
      return {
        opcode: Axb1Opcode.CLOSE_VERIFY,
        ...h,
        index,
        timeS,
        open,
        high,
        low,
        close,
        volume,
      };
    }
    case Axb1Opcode.ERROR: {
      const codeLen = r.u16();
      const messageLen = r.u16();
      const retryable = r.u8() !== 0;
      r.pad(3);
      const code = r.utf8(codeLen);
      const message = r.utf8(messageLen);
      return { opcode: Axb1Opcode.ERROR, ...h, code, message, retryable };
    }
    case Axb1Opcode.JSON_BLOB: {
      const n = r.u32();
      const json = r.utf8(n);
      return { opcode: Axb1Opcode.JSON_BLOB, ...h, json };
    }
    default:
      return { ...h, opcode: env.opcode, unknown: true };
  }
}

/** Hex dump of an envelope (golden vectors). */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    out += (bytes[i] as number).toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/\s+/g, '');
  if (clean.length % 2 !== 0) throw new RangeError('hex length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
