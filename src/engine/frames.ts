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
 * AXB1-HP engine frames module.
 *
 * Frame contract for AXB1 binary frames over WebSocket per concept-ws.md.
 * Every frame carries a SequenceID for continuity checking; seq > last + 1
 * triggers gap recovery.
 *
 * @module engine/frames
 */

export interface SeriesMeta {
  symbol: string;
  interval: string;
  timezone: string;
}

/** AXB1 frame types. */
export type Axb1FrameType =
  | 'heartbeat'
  | 'status'
  | 'snapshot_ohlcv'
  | 'snapshot_plots'
  | 'tip_update'
  | 'append_bar'
  | 'plot_tip'
  | 'close_verify'
  | 'error'
  | 'unchanged'
  | 'json_blob';

/** Base AXB1 frame with SequenceID. */
export interface Axb1Frame {
  type: Axb1FrameType;
  /** Sequence ID for continuity checking. */
  seqId: number;
  /** Session identifier. */
  sessionId?: string;
  /** Timestamp (ms since epoch). */
  ts?: number;
  /** Payload (type-specific). */
  payload?: unknown;
}

/** All AXB1 frame types. */
export type Redesign2Frame = Axb1Frame;

/** Normalize a raw frame into an Axb1Frame. */
export function normalizeRedesign2Frame(raw: unknown): Redesign2Frame | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as Redesign2Frame;
}

/** Validate an AXB1 frame. */
export function validateRedesign2Frame(frame: Redesign2Frame): boolean {
  if (!frame || typeof frame.type !== 'string') return false;
  const validTypes: Axb1FrameType[] = [
    'heartbeat',
    'status',
    'snapshot_ohlcv',
    'snapshot_plots',
    'tip_update',
    'append_bar',
    'plot_tip',
    'close_verify',
    'error',
    'unchanged',
    'json_blob',
  ];
  return validTypes.includes(frame.type);
}
