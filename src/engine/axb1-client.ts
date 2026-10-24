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
 * AXB1 WS client for the AXB1-HP engine.
 *
 * Implements the AXB1 binary protocol over WebSocket per concept-ws.md:
 * - WebSocket in background worker (binaryType = 'arraybuffer')
 * - AXB1 Frame Parser (zero allocation)
 * - Transferable Buffer Recycling Pool
 * - SequenceID gap recovery
 * - Heartbeat every 15s, pong timeout 5s
 * - Zero-SAB mode: no COOP/COEP required
 *
 * @module engine/axb1-client
 */

/** AXB1 message types over WS. */
export type Axb1WsMessageType =
  | 'TIP'
  | 'APPEND'
  | 'STATUS'
  | 'ERROR'
  | 'DELTA'
  | 'PING'
  | 'PONG'
  | 'AUTH'
  | 'AUTH_OK'
  | 'SUBSCRIBE'
  | 'RESUME'
  | 'REPAIR'
  | 'UNSUBSCRIBE';

/** TIP message — signals a new forming bar or bar update. */
export interface Axb1WsTip {
  type: 'TIP';
  /** Session identifier. */
  sessionId: string;
  /** Sequence ID for continuity checking. */
  seqId: number;
  /** Bar index within the window. */
  barIndex: number;
  /** Timestamp of the tick (ns since epoch). */
  timestamp: bigint;
  /** Close price of the bar. */
  close: number;
  /** Whether this is the final bar. */
  final: boolean;
}

/** APPEND message — appends bars to the forming bar. */
export interface Axb1WsAppend {
  type: 'APPEND';
  /** Session identifier. */
  sessionId: string;
  /** Sequence ID for continuity checking. */
  seqId: number;
  /** Bars being appended. */
  bars: Array<{
    /** Open price. */
    open: number;
    /** High price. */
    high: number;
    /** Low price. */
    low: number;
    /** Close price. */
    close: number;
    /** Volume. */
    volume: number;
    /** Timestamp in milliseconds. */
    time: number;
  }>;
}

/** STATUS message — session status response. */
export interface Axb1WsStatus {
  type: 'STATUS';
  /** Session identifier. */
  sessionId: string;
  /** Session state. */
  state: {
    /** Number of bars held. */
    count: number;
    /** Whether the forming bar is final. */
    final: boolean;
    /** Current sequence ID. */
    seqId: number;
  };
}

/** ERROR message from the backend. */
export interface Axb1WsError {
  type: 'ERROR';
  /** Error code. */
  code: number;
  /** Error message. */
  message: string;
}

/** DELTA message — delta bars since last tick. */
export interface Axb1WsDelta {
  type: 'DELTA';
  /** Sequence ID. */
  seqId: number;
  /** Delta bars. */
  bars: Array<{
    /** Open price. */
    open: number;
    /** High price. */
    high: number;
    /** Low price. */
    low: number;
    /** Close price. */
    close: number;
    /** Volume. */
    volume: number;
    /** Timestamp in milliseconds. */
    time: number;
  }>;
}

/** All AXB1 WS message types. */
export type Axb1WsMessage = Axb1WsTip | Axb1WsAppend | Axb1WsStatus | Axb1WsError | Axb1WsDelta;

/** Options for the AXB1 WS client. */
export interface Axb1WsClientOptions {
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
  /** Enable SAB hot ring (default false = zero-SAB mode). */
  useSab?: boolean;
}

/** Buffer recycling pool entry. */
export interface RecycledBuffer {
  buffer: ArrayBuffer;
  view: DataView;
}

/** Transferable buffer recycling pool (concept-ws.md). */
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

/** Default path constants for AXB1 protocol (REST fallback). */
export const AXB1_PATHS = {
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
