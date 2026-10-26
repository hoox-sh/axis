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
 * snapshot. Hold clears only after the buffer drains below
 * {@link SEND_BUFFER_CLEAR_BYTES} so a jitter around 1 MB cannot resume
 * every live sub in a loop. Closes, snapshots, and UNCHANGED keepalives
 * are never dropped.
 *
 * @module engine/v1/backpressure
 */

/** Bytes of unsent socket data before forming tips are held. */
export const SEND_BUFFER_STALE_BYTES = 1_048_576;

/**
 * Exit hold only after unsent bytes fall to this watermark. Without the
 * gap, a buffer that oscillates around 1 MB would flip held→clear→resume
 * on every heartbeat and flood the main thread with snapshots.
 */
export const SEND_BUFFER_CLEAR_BYTES = 262_144;

/** Latched hold so one-arg callers get hysteresis without a signature change. */
let heldLatch = false;

/**
 * Whether forming tips should be held.
 *
 * Pass `wasHeld` when the caller tracks its own latch (preferred). Omit it
 * to use the module latch shared by the single active transport.
 */
export function sendBufferHeld(
  bufferedAmount: number | null | undefined,
  wasHeld?: boolean,
): boolean {
  const n = bufferedAmount ?? 0;
  const prev = wasHeld ?? heldLatch;
  const next = prev ? n > SEND_BUFFER_CLEAR_BYTES : n > SEND_BUFFER_STALE_BYTES;
  heldLatch = next;
  return next;
}

/** Tests: clear the module hysteresis latch. */
export function _resetSendBufferHeldForTests(): void {
  heldLatch = false;
}

/**
 * A forming delta with real tip data. Snapshots, closes, confirmed
 * deltas, and UNCHANGED keepalives stay — keepalives must reach the tip
 * coalescer so their seq can be acked while the send buffer is held.
 */
export function isFormingTipFrame(frame: {
  type?: string;
  id?: string;
  payload?: unknown;
}): boolean {
  if (frame.type !== 'delta' || !frame.id) return false;
  const payload = frame.payload;
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as {
    forming?: unknown;
    unchanged?: unknown;
    bars?: unknown;
    series?: unknown;
    plots?: unknown;
  };
  if (p.unchanged === true && p.bars == null && p.series == null && p.plots == null) {
    return false;
  }
  return p.forming === true;
}
