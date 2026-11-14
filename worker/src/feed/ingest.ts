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
 * User-fed feed support (`POST /api/feed/bars`) and the delta ring buffer
 * backing `GET /api/feed/delta`.
 *
 * Pure functions and small types only — the Durable Object in
 * `durable-objects/feed.ts` owns the mutable state and the WebSocket fan-out.
 * Anything that can be unit-tested without a DO lives here.
 *
 * @module worker/feed/ingest
 */

import { partitionIdFromKey } from '../hash';
import type { FeedBar } from './frames';

/** Max deltas retained for the `/api/feed/delta` resync window. */
export const DELTA_RING_CAP = 256;

/** Max bars accepted in one `POST /api/feed/bars` batch. */
export const MAX_INGEST_BARS = 500;

/** One retained delta: its seq and the whole parsed delta object. */
export interface DeltaRingEntry {
  seq: number;
  delta: Record<string, unknown>;
}

/** Append a delta to the ring, evicting the oldest beyond {@link DELTA_RING_CAP}. */
export function pushDelta(ring: DeltaRingEntry[], entry: DeltaRingEntry): void {
  ring.push(entry);
  if (ring.length > DELTA_RING_CAP) {
    ring.splice(0, ring.length - DELTA_RING_CAP);
  }
}

/** Result of a delta-since query against the ring. */
export type DeltasSince =
  { ok: true; deltas: Record<string, unknown>[] } | { ok: false; reason: 'delta_gone' };

/**
 * Deltas with `seq > after`, oldest first.
 *
 * Fails with `delta_gone` when `after` is older than the oldest retained
 * delta (i.e. at least one delta the caller needs has been evicted).
 * `after` equal to `oldest - 1` is still fully served.
 */
export function deltasSince(ring: readonly DeltaRingEntry[], after: number): DeltasSince {
  const oldest = ring.length > 0 ? (ring[0] as DeltaRingEntry).seq : null;
  if (oldest !== null && after < oldest - 1) {
    return { ok: false, reason: 'delta_gone' };
  }
  const deltas: Record<string, unknown>[] = [];
  for (const entry of ring) {
    if (entry.seq > after) deltas.push(entry.delta);
  }
  return { ok: true, deltas };
}

/** The `user:<hash>` scope a raw API key maps to (same fingerprint as auth). */
export async function userScopeForApiKey(apiKey: string): Promise<string> {
  return `user:${await partitionIdFromKey(apiKey)}`;
}

/** Outcome of validating a `POST /api/feed/bars` bar array. */
export type ValidateBarsResult = { ok: true; bars: FeedBar[] } | { ok: false; reason: string };

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validate the `bars` array of a `POST /api/feed/bars` body.
 *
 * Rules: non-empty array, at most {@link MAX_INGEST_BARS} entries, each bar a
 * plain object with a unix-seconds integer `time`, finite OHLC values with
 * `low <= open/close <= high` and `high >= low`, `volume >= 0`, and times
 * strictly increasing across the batch. Returned bars carry `closed: true`
 * (the whole batch is treated as closed bars).
 */
export function validateIngestBars(input: unknown): ValidateBarsResult {
  if (!Array.isArray(input)) return { ok: false, reason: 'bars must be an array' };
  if (input.length === 0) return { ok: false, reason: 'bars must not be empty' };
  if (input.length > MAX_INGEST_BARS) {
    return { ok: false, reason: `too many bars (max ${MAX_INGEST_BARS})` };
  }
  const out: FeedBar[] = [];
  let prevTime = -Infinity;
  for (let i = 0; i < input.length; i += 1) {
    const raw = input[i];
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, reason: `bars[${i}] must be an object` };
    }
    const bar = raw as Record<string, unknown>;
    const { time, open, high, low, close, volume } = bar;
    if (!isFiniteNumber(time) || !Number.isInteger(time) || time <= 0) {
      return { ok: false, reason: `bars[${i}].time must be a positive integer (unix seconds)` };
    }
    if (time <= prevTime) {
      return { ok: false, reason: `bars[${i}].time must be strictly increasing` };
    }
    if (
      !isFiniteNumber(open) ||
      !isFiniteNumber(high) ||
      !isFiniteNumber(low) ||
      !isFiniteNumber(close) ||
      !isFiniteNumber(volume)
    ) {
      return { ok: false, reason: `bars[${i}] OHLCV values must be finite numbers` };
    }
    if (high < low) {
      return { ok: false, reason: `bars[${i}] high is below low` };
    }
    if (open > high || close > high) {
      return { ok: false, reason: `bars[${i}] open/close above high` };
    }
    if (open < low || close < low) {
      return { ok: false, reason: `bars[${i}] open/close below low` };
    }
    if (volume < 0) {
      return { ok: false, reason: `bars[${i}].volume must be >= 0` };
    }
    prevTime = time;
    out.push({ time, open, high, low, close, volume, closed: true });
  }
  return { ok: true, bars: out };
}
