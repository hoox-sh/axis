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
 * Thin engine frames module.
 *
 * Frame contract for thin Delta Envelope binary frames over WebSocket per
 * thin/concept.md. Compatible with src/hp/ imports.
 *
 * @module engine/frames
 */

export interface SeriesMeta {
  symbol: string;
  interval: string;
  timezone: string;
}

/** Thin Delta Envelope frame types. */
export type DeltaFrameType = 'tick' | 'close_append' | 'resync';

/** Base thin Delta Envelope frame with SequenceID. */
export interface ThinFrame {
  type: DeltaFrameType;
  /** Sequence ID for continuity checking. */
  seqId: number;
  /** Session identifier. */
  sessionId?: string;
  /** Timestamp (ms since epoch). */
  ts?: number;
  /** Payload (type-specific). */
  payload?: unknown;
}

/** All thin frame types. */
export type Redesign2Frame = ThinFrame;

/** Normalize a raw frame into a ThinFrame. */
export function normalizeRedesign2Frame(raw: unknown): Redesign2Frame | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as Redesign2Frame;
}

/** Validate a thin Delta Envelope frame. */
export function validateRedesign2Frame(frame: Redesign2Frame): boolean {
  if (!frame || typeof frame.type !== 'string') return false;
  const validTypes: DeltaFrameType[] = ['tick', 'close_append', 'resync'];
  return validTypes.includes(frame.type);
}
