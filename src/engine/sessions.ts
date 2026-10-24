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
 * AXB1-HP engine sessions.
 *
 * Sessions are managed via WebSocket using the AXB1 binary protocol.
 * Continuity is maintained through SequenceID on frames. Gap recovery uses
 * SequenceID jumps to trigger a REST fetch for missing bars.
 *
 * @module engine/sessions
 */

/** Session state received from the backend via WS. */
export interface SessionState {
  /** Number of bars the session holds. */
  count: number;
  /** Last evaluated bar time (ms since epoch). */
  lastTime: number;
  /** Last SequenceID received. */
  seqId: number;
  /** Forming tip time (ms since epoch). */
  tipTime: number;
  /** Whether the forming bar is final. */
  final: boolean;
  /** Session mode. */
  mode: 'interpret' | 'compile';
}

/** Create a new session via WS. */
export interface CreateSessionInput {
  /** API key for authentication. */
  apiKey: string;
  /** Pine script source code. */
  script: string;
  /** Symbol ticker. */
  symbol: string;
  /** Timeframe (e.g. '1m', '5m', '1H'). */
  timeframe: string;
  /** Mode: 'interpret' or 'compile'. */
  mode: 'interpret' | 'compile';
  /** Inputs to resolve (optional). */
  inputs?: Record<string, unknown>;
  /** Libraries to use (optional). */
  libraries?: Record<string, unknown>;
}

/** Tick a session via WS (send a new bar). */
export interface TickSessionInput {
  /** Session ID. */
  sessionId: string;
  /** New bar OHLCV data. */
  bar: {
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
  };
}

/** Append newer bars to a session via WS. */
export interface AppendSessionInput {
  /** Session ID. */
  sessionId: string;
  /** New bars to append. */
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

/** Release a session via WS. */
export interface ReleaseSessionInput {
  /** Session ID. */
  sessionId: string;
}

/** Session error classification. */
export enum SessionError {
  /** Session not found on backend. */
  NOT_FOUND = 'NO_SESSION',
  /** Session answer was unusable. */
  INVALID = 'INVALID',
  /** Transport error or timeout. */
  MISS = 'MISS',
  /** Sequence gap detected, recovery needed. */
  GAP = 'GAP',
}
