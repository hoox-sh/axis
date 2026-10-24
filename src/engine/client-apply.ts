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
 * Client apply state for Redesign2.
 *
 * Tracks whether a useful session has applied its full result so that later
 * deltas can be applied incrementally.
 *
 * @module engine/client-apply
 */

import {
  executionContextFromDelta,
  type ExecutionContext,
} from '../hp/calc/execution-context';
import { resolveSessionPayload } from '../engines/session-delta';
import { classifySeqGap } from './frames';

export type ApplyState = 'idle' | 'requesting' | 'full-applied' | 'delta-only';

export class Redesign2ApplyStateManager {
  private state: ApplyState = 'idle';
  private fullAppliedCount = 0;

  get currentState(): ApplyState {
    return this.state;
  }

  requestFull(): void {
    this.state = 'requesting';
  }

  markFullApplied(): void {
    this.state = 'full-applied';
    this.fullAppliedCount += 1;
  }

  markDeltaApplied(): void {
    if (this.state !== 'full-applied' && this.state !== 'delta-only') {
      throw new Error('delta applied before full result');
    }
    this.state = 'delta-only';
  }

  shouldApplyFull(): boolean {
    return this.fullAppliedCount === 0;
  }

  reset(): void {
    this.state = 'idle';
    this.fullAppliedCount = 0;
  }
}

export interface DeltaApplierFull {
  plots?: Record<string, unknown[]>;
  series?: Record<string, unknown[]>;
  count: number;
  [key: string]: unknown;
}

export interface DeltaApplierDelta {
  seq: number;
  base_index: number;
  count: number;
  tail_len: number;
  plots?: Record<string, unknown[]>;
  series?: Record<string, unknown[]>;
  unchanged?: boolean;
  /** JSON `forming: true` → tip scratch; `false` → commit append. */
  forming?: boolean;
  [key: string]: unknown;
}

/**
 * Time axis for one script delta tail.
 *
 * The live socket sends `bar_times` on the snapshot and only the new plot
 * values on a delta. Without an axis the apply path zips those values onto
 * the chart by index, and a candle that slides the window moves every closed
 * %B onto the next bar. The tail returned here is what the positional splice
 * (`cached[:base_index] + tail`) expects: the bars the delta replaces, then
 * one stamp per bar the delta appends.
 */
export function scriptDeltaTimeTail(
  cachedTimes: readonly number[] | null,
  delta: { base_index: number; count: number; tail_len: number },
  knownTimes: readonly number[],
): number[] | null {
  if (!cachedTimes?.length) return null;
  const { base_index, count, tail_len } = delta;
  if (tail_len <= 0 || count < tail_len || base_index < 0) return null;
  const growth = count - cachedTimes.length;
  if (growth < 0) return null;
  const overlap = tail_len - growth;
  if (overlap < 0 || base_index !== cachedTimes.length - overlap) return null;
  const kept = cachedTimes.slice(base_index, base_index + overlap);
  if (kept.length !== overlap) return null;
  if (growth === 0) return kept;
  const last = cachedTimes[cachedTimes.length - 1]!;
  const newer = [...new Set(knownTimes.filter((t) => Number.isFinite(t) && t > last))].sort(
    (a, b) => a - b,
  );
  const step =
    cachedTimes.length >= 2
      ? cachedTimes[cachedTimes.length - 1]! - cachedTimes[cachedTimes.length - 2]!
      : 0;
  const added: number[] = [];
  let cursor = last;
  for (let i = 0; i < growth; i++) {
    const known = newer.find((t) => t > cursor);
    if (known != null) {
      added.push(known);
      cursor = known;
      continue;
    }
    if (!(step > 0)) return null;
    cursor += step;
    added.push(cursor);
  }
  return [...kept, ...added];
}

/** Finite unix-second list, or null when the field is missing or unusable. */
export function readTimeList(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: number[] = [];
  for (const item of value) {
    const n = typeof item === 'number' ? item : Number(item);
    if (!Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

export type DeltaApplyOutcome =
  | { ok: true; full: Record<string, unknown>; replayed: boolean; executionContext: ExecutionContext }
  | { ok: false; reason: 'needs-full' | 'delta-before-full' };

/**
 * Per-subscription delta applier (F-06).
 *
 * Holds the cached full payload and merges `delta` frames through
 * `resolveSessionPayload` — the same positional splice the session clients
 * use (`cached[:base_index] + tail`, exact-length enforced). `seq` gaps and
 * unmergeable deltas report `needs-full` so the caller re-requests a full
 * snapshot instead of applying partial data; duplicate `seq` replays the
 * cache without touching state.
 */
export class Redesign2DeltaApplier {
  private readonly states = new Redesign2ApplyStateManager();
  private cache: Record<string, unknown> | null = null;
  private appliedSeq = 0;

  applyFull(full: DeltaApplierFull & { seq?: number }): Record<string, unknown> {
    this.states.requestFull();
    const stored = { ...full, executionContext: 'snapshot' as const };
    this.cache = stored;
    if (typeof full.seq === 'number') this.appliedSeq = full.seq;
    this.states.markFullApplied();
    return stored;
  }

  applyDelta(delta: DeltaApplierDelta): DeltaApplyOutcome {
    if (!this.cache) return { ok: false, reason: 'delta-before-full' };
    const gap = classifySeqGap(this.appliedSeq, delta.seq);
    const cachedContext = this.cache.executionContext;
    if (gap.kind === 'duplicate') {
      const executionContext: ExecutionContext =
        cachedContext === 'snapshot' || cachedContext === 'tip' || cachedContext === 'append'
          ? cachedContext
          : 'snapshot';
      return { ok: true, full: { ...this.cache }, replayed: true, executionContext };
    }
    if (gap.kind !== 'continuous') return { ok: false, reason: 'needs-full' };
    const cachedCount = typeof this.cache.count === 'number' ? this.cache.count : undefined;
    const { seq: _seq, base_index, count, tail_len, forming, ...rest } = delta;
    void _seq;
    const executionContext = executionContextFromDelta({ forming, count }, cachedCount);
    const update = {
      ...rest,
      count,
      delta: { base_index, count, tail_len },
    };
    const merged = resolveSessionPayload(this.cache, update);
    if (!merged) return { ok: false, reason: 'needs-full' };
    const stored = { ...merged, executionContext, forming: forming === true };
    this.cache = stored;
    this.appliedSeq = delta.seq;
    this.states.markDeltaApplied();
    return { ok: true, full: { ...stored }, replayed: false, executionContext };
  }

  get cached(): Record<string, unknown> | null {
    return this.cache ? { ...this.cache } : null;
  }

  /** Last applied `seq` — lets callers tell a missed-frames gap (resubscribe)
   * from a continuous-seq axis splice (values-only salvage is safe). */
  get lastSeq(): number {
    return this.appliedSeq;
  }

  get state(): ApplyState {
    return this.states.currentState;
  }

  reset(): void {
    this.states.reset();
    this.cache = null;
    this.appliedSeq = 0;
  }
}