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
 * Messages between the main-thread ingest host and the ingest worker.
 *
 * The auth token travels only on `connect`. Worker replies never echo it.
 *
 * @module hp/workers/protocol
 */

import type { Redesign2Frame } from '../../engine/frames';
import type { WireFrame } from '../../engine/live-wire';

export const INGEST_CONNECT_TIMEOUT_MS = 5_000;
export const INGEST_HEARTBEAT_MS = 15_000;
export const INGEST_PONG_TIMEOUT_MS = 5_000;
export const INGEST_TIP_COALESCE_MS = 16;

export type HostToIngest =
  /** `authToken` rides once on connect and is never echoed back. */
  | {
      type: 'connect';
      url: string;
      authToken?: string;
    }
  | { type: 'send'; frame: WireFrame }
  | { type: 'disconnect' };

export type IngestToHost =
  | { type: 'status'; status: 'connecting' | 'open' | 'closed' | 'error' }
  | { type: 'open'; first: boolean }
  | { type: 'frames'; frames: Redesign2Frame[]; publishedAt?: number }
  | { type: 'pong' }
  | { type: 'malformed'; reason: string }
  /** Unknown AXB1 opcode. The socket stays open; the host asks that sub for JSON. */
  | { type: 'unknown-opcode'; opcode: number; id: string; seq: number }
  /**
   * Outbound buffer crossed 1 MB (`held`) or drained (`held: false`).
   * The socket stays open. The host skips nothing itself — the worker
   * already dropped forming tips — and resumes subs when the buffer drains.
   */
  | { type: 'backpressure'; held: boolean };
