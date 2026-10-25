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
 * Outbound socket pressure (concept §4.4).
 *
 * `bufferedAmount` is bytes waiting to leave the browser. Past 1 MB the
 * socket is kept, forming tips are not applied, and a drain asks for a
 * snapshot. Closes and snapshots are never dropped.
 *
 * @module engine/v1/backpressure
 */

/** Bytes of unsent socket data before forming tips are held. */
export const SEND_BUFFER_STALE_BYTES = 1_048_576;

export function sendBufferHeld(bufferedAmount: number | null | undefined): boolean {
  return (bufferedAmount ?? 0) > SEND_BUFFER_STALE_BYTES;
}

/** A forming delta. Snapshots, closes, and non-forming deltas stay. */
export function isFormingTipFrame(frame: {
  type?: string;
  id?: string;
  payload?: unknown;
}): boolean {
  if (frame.type !== 'delta' || !frame.id) return false;
  const payload = frame.payload;
  if (!payload || typeof payload !== 'object') return false;
  return (payload as { forming?: unknown }).forming === true;
}
