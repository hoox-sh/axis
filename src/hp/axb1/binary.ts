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
 * Little-endian growable writer / bounds-checked reader for AXB1 payloads.
 *
 * @module hp/axb1/binary
 */

const utf8enc = new TextEncoder();
const utf8dec = new TextDecoder();

/** Throw when a BigInt64Array/Float64Array view would be misaligned. */
export function assertI64Aligned(byteOffset: number): void {
  if (byteOffset % 8 !== 0) {
    throw new RangeError(`i64/f64 view misaligned at byteOffset ${byteOffset}`);
  }
}

export class BinWriter {
  private buf: ArrayBuffer;
  private view: DataView;
  private bytes: Uint8Array;
  off = 0;

  constructor(capacity = 256) {
    this.buf = new ArrayBuffer(Math.max(32, capacity));
    this.view = new DataView(this.buf);
    this.bytes = new Uint8Array(this.buf);
  }

  get offset(): number {
    return this.off;
  }

  private grow(need: number): void {
    if (this.off + need <= this.buf.byteLength) return;
    let cap = this.buf.byteLength;
    const want = this.off + need;
    while (cap < want) cap *= 2;
    const next = new ArrayBuffer(cap);
    new Uint8Array(next).set(this.bytes);
    this.buf = next;
    this.view = new DataView(next);
    this.bytes = new Uint8Array(next);
  }

  pad(n: number): void {
    if (n <= 0) return;
    this.grow(n);
    this.off += n;
  }

  align(n: number): void {
    const rem = this.off % n;
    if (rem) this.pad(n - rem);
  }

  u8(v: number): void {
    this.grow(1);
    this.view.setUint8(this.off, v);
    this.off += 1;
  }

  u16(v: number): void {
    this.grow(2);
    this.view.setUint16(this.off, v, true);
    this.off += 2;
  }

  u32(v: number): void {
    this.grow(4);
    this.view.setUint32(this.off, v >>> 0, true);
    this.off += 4;
  }

  i32(v: number): void {
    this.grow(4);
    this.view.setInt32(this.off, v, true);
    this.off += 4;
  }

  i64(v: bigint): void {
    this.align(8);
    this.grow(8);
    this.view.setBigInt64(this.off, v, true);
    this.off += 8;
  }

  f64(v: number): void {
    this.align(8);
    this.grow(8);
    this.view.setFloat64(this.off, v, true);
    this.off += 8;
  }

  raw(src: Uint8Array): void {
    this.grow(src.byteLength);
    this.bytes.set(src, this.off);
    this.off += src.byteLength;
  }

  utf8(s: string): number {
    const encoded = utf8enc.encode(s);
    this.raw(encoded);
    return encoded.byteLength;
  }

  /** Pad so payload_bytes is a multiple of 4. */
  padTo4(): void {
    this.align(4);
  }

  finish(): Uint8Array {
    return this.bytes.slice(0, this.off);
  }
}

export class BinReader {
  readonly view: DataView;
  readonly start: number;
  readonly end: number;
  off: number;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.start = 0;
    this.end = bytes.byteLength;
    this.off = 0;
  }

  remaining(): number {
    return this.end - this.off;
  }

  private need(n: number): void {
    if (this.off + n > this.end) throw new RangeError('AXB1 payload truncated');
  }

  pad(n: number): void {
    this.need(n);
    this.off += n;
  }

  align(n: number): void {
    const rem = this.off % n;
    if (rem) this.pad(n - rem);
  }

  u8(): number {
    this.need(1);
    const v = this.view.getUint8(this.off);
    this.off += 1;
    return v;
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.off, true);
    this.off += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.off, true);
    this.off += 4;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.off, true);
    this.off += 4;
    return v;
  }

  i64(): bigint {
    this.align(8);
    this.need(8);
    assertI64Aligned(this.view.byteOffset + this.off);
    const v = this.view.getBigInt64(this.off, true);
    this.off += 8;
    return v;
  }

  f64(): number {
    this.align(8);
    this.need(8);
    assertI64Aligned(this.view.byteOffset + this.off);
    const v = this.view.getFloat64(this.off, true);
    this.off += 8;
    return v;
  }

  bytes(n: number): Uint8Array {
    this.need(n);
    const slice = new Uint8Array(this.view.buffer, this.view.byteOffset + this.off, n);
    this.off += n;
    return slice;
  }

  utf8(n: number): string {
    return utf8dec.decode(this.bytes(n));
  }
}
