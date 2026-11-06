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
 * Live-relay telemetry (F-15 instrumentation).
 *
 * The `/api/ws/live` proxy is a long-lived, per-tick byte pump, so logging
 * every frame would flood Workers Logs for no signal. Instead we emit two
 * structured lines per connection — one when the upstream opens (carrying the
 * edge→origin connect latency) and one when it closes (carrying the full
 * session counters) — plus an optional frame sample. Everything is JSON
 * through `console.warn`, matching the Worker's existing structured-log
 * convention (see `tenant.ts`), so Cloudflare observability picks it up.
 *
 * @module worker/live-metrics
 */

export interface LiveMetric {
  type: string;
  [key: string]: unknown;
}

/** Emit one structured metric line. Never throws — telemetry must not break the relay. */
export function emitLiveMetric(metric: LiveMetric): void {
  try {
    console.warn(JSON.stringify(metric));
  } catch {
    /* ignore */
  }
}

/** Byte size of one relayed WS frame payload, or 0 when not measurable. */
export function frameBytes(data: unknown): number {
  if (typeof data === 'string') return data.length;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return 0;
}

export type RelayClosedBy = 'client' | 'upstream';

/**
 * Per-connection counters for the live relay. Accumulate on the hot path
 * (cheap integer bumps only), then `finalize()` emits the one summary line.
 */
export class RelayStats {
  readonly startedAt = Date.now();

  toUpstream = 0;
  toClient = 0;
  bytesUp = 0;
  bytesDown = 0;
  binaryFrames = 0;
  textFrames = 0;

  maxPendingToUpstream = 0;
  maxLanePending = 0;
  droppedToUpstream = 0;

  upstreamConnectMs: number | null = null;
  upstreamHost: string | null = null;
  closedBy: RelayClosedBy | null = null;

  private finalized = false;

  /** One relayed frame (either direction). `dir` is the relay direction. */
  noteFrame(dir: 'up' | 'down', data: unknown): void {
    if (dir === 'up') {
      this.toUpstream += 1;
      this.bytesUp += frameBytes(data);
    } else {
      this.toClient += 1;
      this.bytesDown += frameBytes(data);
    }
    if (typeof data === 'string') this.textFrames += 1;
    else this.binaryFrames += 1;
  }

  /** Depth of the pre-upstream-open buffer (backpressure before connect). */
  notePendingToUpstream(depth: number): void {
    if (depth > this.maxPendingToUpstream) this.maxPendingToUpstream = depth;
  }

  /** Depth of the in-order send lane (backpressure under load). */
  noteLanePending(depth: number): void {
    if (depth > this.maxLanePending) this.maxLanePending = depth;
  }

  /** Emit the `live_relay_close` summary once; later close paths are no-ops. */
  finalize(closedBy: RelayClosedBy): void {
    if (this.finalized) return;
    this.finalized = true;
    this.closedBy = closedBy;
    emitLiveMetric({
      type: 'live_relay_close',
      duration_ms: Date.now() - this.startedAt,
      closed_by: closedBy,
      upstream_connect_ms: this.upstreamConnectMs,
      upstream_host: this.upstreamHost,
      to_upstream: this.toUpstream,
      to_client: this.toClient,
      bytes_up: this.bytesUp,
      bytes_down: this.bytesDown,
      binary_frames: this.binaryFrames,
      text_frames: this.textFrames,
      max_pending_to_upstream: this.maxPendingToUpstream,
      max_lane_pending: this.maxLanePending,
      dropped_to_upstream: this.droppedToUpstream,
    });
  }
}
