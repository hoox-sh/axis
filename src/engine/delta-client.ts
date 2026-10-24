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
 * Thin Delta Envelope WS client.
 *
 * Implements the thin Delta Envelope protocol over WebSocket per thin/concept.md:
 * - OpCode (uint8): 0x01 Live Tick, 0x02 Bar Close/Append, 0x03 Resync
 * - Sequence ID (uint32): monotonic counter for gap detection
 * - Timestamp (int64): Unix ms
 * - Mask (uint16): bitmask of present fields
 * - Payload (float32[]): packed values per mask bits
 *
 * @module engine/delta-client
 */

/** Delta Envelope OpCodes. */
export type DeltaOpCode =
  0x01 /** Live Tick Update */ | 0x02 /** Bar Close / Append */ | 0x03; /** Resync */

/** Bitmask bits for payload fields. */
export const DeltaMask = {
  /** Open/High/Low */
  OHLC: 1 << 0,
  /** Close Price */
  CLOSE: 1 << 1,
  /** Volume */
  VOLUME: 1 << 2,
  /** Indicator 0 (e.g. EMA 20) */
  INDICATOR_0: 1 << 3,
  /** Indicator 1 (e.g. Upper Bollinger Band) */
  INDICATOR_1: 1 << 4,
  /** Indicator 2 (e.g. Lower Bollinger Band) */
  INDICATOR_2: 1 << 5,
} as const;

/** Decoded Delta Envelope frame. */
export interface DeltaFrame {
  /** OpCode: 0x01 tick, 0x02 close/append, 0x03 resync. */
  opCode: DeltaOpCode;
  /** Monotonic sequence counter for gap detection. */
  seqId: number;
  /** Unix timestamp in ms. */
  timestamp: number;
  /** Bitmask of present payload fields. */
  mask: number;
  /** Packed float32 values per mask bits. */
  payload: Float32Array;
}

/** Options for the Delta WS client. */
export interface DeltaWsClientOptions {
  /** Backend WS endpoint URL. */
  endpoint: string;
  /** API key for authentication. */
  apiKey: string;
  /** Initial connect timeout in ms (default 5000). */
  connectTimeoutMs?: number;
  /** Delay before first reconnect attempt in ms (default 500). */
  initialReconnectDelayMs?: number;
  /** Maximum reconnect delay in ms (default 30000). */
  maxReconnectDelayMs?: number;
  /** Heartbeat interval in ms (default 15000). */
  heartbeatIntervalMs?: number;
  /** Pong timeout in ms (default 5000). */
  pongTimeoutMs?: number;
}

/** Transferable buffer recycling pool (thin concept). */
export class BufferPool {
  private pool: ArrayBuffer[] = [];
  private readonly size: number;

  constructor(size = 8) {
    this.size = size;
    for (let i = 0; i < size; i++) {
      this.pool.push(new ArrayBuffer(64));
    }
  }

  /** Acquire a buffer from the pool, allocating if empty. */
  acquire(): ArrayBuffer {
    return this.pool.pop() || new ArrayBuffer(64);
  }

  /** Return a buffer to the pool for reuse. */
  release(buffer: ArrayBuffer): void {
    if (this.pool.length < this.size) {
      this.pool.push(buffer);
    }
  }

  /** Current pool size. */
  get available(): number {
    return this.pool.length;
  }
}

/** Default path constants for thin protocol (REST fallback). */
export const THIN_PATHS = {
  /** Create a new session. */
  CREATE_SESSION: '/session',
  /** Tick the forming bar. */
  TICK_SESSION: '/session/:sessionId/tick',
  /** Append newer bars to a session. */
  APPEND_SESSION: '/session/:sessionId/append',
  /** Release/close a session. */
  RELEASE_SESSION: '/session/:sessionId',
  /** Gap recovery: fetch missing bars. */
  GAP_FETCH: '/data/series',
} as const;
